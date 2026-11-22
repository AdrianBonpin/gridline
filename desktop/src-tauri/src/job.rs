//! Managed external-tool jobs.
//!
//! Backup, restore and sync runs shell out to `pg_dump` / `pg_restore` / `psql`
//! / `mariadb-dump` / `mariadb`. Those children can spawn children of their own,
//! outlive the UI that started them, or wedge forever waiting on a lock, a
//! network peer, or a `--version` probe. This module is the single place that
//! owns them:
//!
//! * **Ownership** — a [`JobControl`] holds every child it spawned; the
//!   [`JobRegistry`] maps job ids to their control so a cancel (or app exit) can
//!   reach a job that is running on another thread.
//! * **Process-tree termination** — children are spawned as their own process
//!   group and terminated as a group (SIGTERM, grace, SIGKILL on Unix;
//!   `taskkill /T` on Windows), so helper processes die with their parent.
//! * **Cancellation** — cooperative via [`JobControl::is_cancelled`], and
//!   enforced by the supervisor loop that kills the tree as soon as the flag is
//!   set.
//! * **Idle deadlines, never total-duration caps** — a job that shows no
//!   observable progress (drained output, growing output file, bytes crossing a
//!   sync pipe) for [`JobControl::idle_timeout`] is stopped. A large backup that
//!   keeps making progress runs as long as it needs to.
//! * **Lock deadlines where output cannot prove liveness** — a restore can sit in
//!   one large `COPY` silently, so it is exempt from the idle bound and bounded
//!   on the *lock wait* instead ([`crate::db::restore_watch`]).
//! * **Honest cancellation** — the registry answers "was there a job", not "did it
//!   own a child process", so an in-process job (SQLite dump/restore/sync, MySQL
//!   restore) can be reported and cancelled like any other.
//! * **Bounded diagnostics** — child output is drained on its own thread (so a
//!   chatty tool cannot deadlock on a full pipe) and capped at
//!   [`MAX_DIAGNOSTIC_BYTES`].
//! * **Bounded probes** — [`capture_bounded`] is what tool availability and
//!   version detection use; a binary that never answers is killed and reported
//!   instead of hanging the caller.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Supervisor wake-up interval: how quickly a cancel is noticed.
pub const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// Default inactivity bound. Deliberately generous: it exists to catch a hung
/// tool, not to cap how long a legitimate large job may run.
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Default deadline for a `--version`-style probe.
pub const DEFAULT_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
/// How long a terminated tree gets to exit before it is killed outright.
pub const TERMINATE_GRACE: Duration = Duration::from_millis(1500);
/// Cap on captured child output (stderr, or stdout when it is diagnostics).
pub const MAX_DIAGNOSTIC_BYTES: usize = 1024 * 1024;

/// A monotonic progress signal: any change resets the idle clock.
pub type Activity = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Why a managed job did not complete normally.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobError {
    /// The user (or app exit) cancelled the job.
    Cancelled,
    /// No observable progress within the job's idle window.
    Idle(Duration),
    /// A bounded operation exceeded its deadline (probe, version detection).
    Timeout(Duration),
    /// The program could not be started at all.
    Spawn(String),
    /// An I/O failure while supervising the child.
    Io(String),
}

impl JobError {
    pub fn is_cancelled(&self) -> bool {
        matches!(self, JobError::Cancelled)
    }

    /// User-facing text. Sanitized upstream like every other IPC error.
    pub fn message(&self) -> String {
        match self {
            JobError::Cancelled => "Job cancelled".to_string(),
            JobError::Idle(d) => format!(
                "Stopped after no progress for {}s — the tool stopped responding",
                d.as_secs().max(1)
            ),
            JobError::Timeout(d) => format!(
                "The tool did not respond within {}s and was stopped",
                d.as_secs().max(1)
            ),
            JobError::Spawn(e) => format!("Failed to start the tool: {e}"),
            JobError::Io(e) => e.clone(),
        }
    }
}

impl std::fmt::Display for JobError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message())
    }
}

// ---------------------------------------------------------------------------
// Job control (ownership + cancellation)
// ---------------------------------------------------------------------------

/// One running job's ownership record.
///
/// Shared between the thread supervising the child processes and any thread that
/// may cancel them (the command handler, or the app-exit hook).
pub struct JobControl {
    id: String,
    connection_id: Mutex<Option<String>>,
    cancelled: AtomicBool,
    idle_ms: AtomicU64,
    /// Why an external watchdog stopped this job, when it was not the job's own
    /// tool that failed (e.g. a restore terminated for sitting in a lock wait).
    /// Reported instead of the raw consequence ("server closed the connection
    /// unexpectedly"), so the failure explains itself.
    stop_reason: Mutex<Option<String>>,
    /// Children currently owned by this job, in spawn order.
    children: Mutex<Vec<Arc<ManagedChild>>>,
}

impl JobControl {
    fn build(id: impl Into<String>) -> Arc<Self> {
        Arc::new(Self {
            id: id.into(),
            connection_id: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            idle_ms: AtomicU64::new(DEFAULT_IDLE_TIMEOUT.as_millis() as u64),
            stop_reason: Mutex::new(None),
            children: Mutex::new(Vec::new()),
        })
    }

    /// A control that belongs to no registry — for headless callers and tests.
    pub fn detached() -> Arc<Self> {
        Self::build("detached")
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn set_connection_id(&self, connection_id: Option<String>) {
        if let Ok(mut g) = self.connection_id.lock() {
            *g = connection_id;
        }
    }

    pub fn connection_id(&self) -> Option<String> {
        self.connection_id.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_idle_timeout(&self, timeout: Duration) {
        self.idle_ms
            .store(timeout.as_millis() as u64, Ordering::SeqCst);
    }

    pub fn idle_timeout(&self) -> Duration {
        Duration::from_millis(self.idle_ms.load(Ordering::SeqCst))
    }

    /// Request cancellation and terminate every owned process tree.
    ///
    /// The return value is only "did this job own a child process", which is
    /// NOT the same as "was there a job to cancel": the in-process engines
    /// (SQLite dump/restore/sync, MySQL restore) own no child at all. Callers
    /// that answer "is the job running" must use the registry's job id, never
    /// this flag — see [`JobRegistry::cancel`].
    pub fn cancel(&self) -> bool {
        self.cancelled.store(true, Ordering::SeqCst);
        let children = self.children();
        let had_child = !children.is_empty();
        for child in children {
            child.terminate_tree();
        }
        had_child
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Record a cancellation request without killing anything, for callers that
    /// poll between statements (e.g. the in-process MySQL restore engine).
    pub fn request_cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn clear_cancelled(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
    }

    /// Record why the job was stopped from outside (a watchdog, not the tool).
    pub fn note_stop_reason(&self, reason: impl Into<String>) {
        if let Ok(mut g) = self.stop_reason.lock() {
            *g = Some(reason.into());
        }
    }

    /// The recorded stop reason, if any.
    pub fn stop_reason(&self) -> Option<String> {
        self.stop_reason.lock().ok().and_then(|g| g.clone())
    }

    fn register(&self, child: Arc<ManagedChild>) {
        if let Ok(mut g) = self.children.lock() {
            g.push(child);
        }
    }

    /// Owned children that have not been reaped yet.
    fn children(&self) -> Vec<Arc<ManagedChild>> {
        self.children.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// Pids of the currently owned children (diagnostics and tests).
    pub fn child_pids(&self) -> Vec<u32> {
        self.children().iter().map(|c| c.pid()).collect()
    }

    fn is_idle(&self, last_progress: Instant) -> Option<Duration> {
        let idle = self.idle_timeout();
        if idle.is_zero() {
            return None;
        }
        let silent = last_progress.elapsed();
        if silent >= idle {
            Some(silent)
        } else {
            None
        }
    }
}

/// Process-lifetime map of running jobs, so a cancel or an app-exit hook can
/// reach a job it did not start.
#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, Arc<JobControl>>>,
}

impl JobRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a job before it starts running.
    pub fn begin(&self, id: &str) -> Arc<JobControl> {
        let control = JobControl::build(id);
        if let Ok(mut g) = self.jobs.lock() {
            g.insert(id.to_string(), control.clone());
        }
        control
    }

    /// Drop the job once its result has been reported.
    pub fn finish(&self, id: &str) {
        if let Ok(mut g) = self.jobs.lock() {
            g.remove(id);
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<JobControl>> {
        self.jobs.lock().ok().and_then(|g| g.get(id).cloned())
    }

    /// Cancel one job. `false` when the id is unknown (already finished).
    ///
    /// The answer is "a job was registered under this id", never "it owned a
    /// child process". An in-process job — the SQLite dump/restore/sync and the
    /// MySQL restore — has no child at all, and reporting it as *not running*
    /// made `cancel_tool_job` return false and the UI skip its cancellation
    /// state while the job kept going.
    pub fn cancel(&self, id: &str) -> bool {
        match self.get(id) {
            Some(control) => {
                control.cancel();
                true
            }
            None => false,
        }
    }

    /// Cancel every running job — the app-exit path.
    pub fn cancel_all(&self) -> usize {
        let all: Vec<Arc<JobControl>> = self
            .jobs
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default();
        for control in &all {
            control.cancel();
        }
        all.len()
    }

    pub fn active(&self) -> Vec<String> {
        self.jobs
            .lock()
            .map(|g| g.keys().cloned().collect())
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// Owned child process (tree-aware)
// ---------------------------------------------------------------------------

struct ChildState {
    child: Option<Child>,
    status: Option<ExitStatus>,
}

/// A child process owned by a [`JobControl`], spawned as its own process group
/// so the whole tree can be terminated.
pub struct ManagedChild {
    pid: u32,
    state: Mutex<ChildState>,
    stdout: Mutex<Option<ChildStdout>>,
    stderr: Mutex<Option<ChildStderr>>,
    stdin: Mutex<Option<ChildStdin>>,
}

impl ManagedChild {
    /// Spawn with `stdin` closed (the default for tools that read a file) and
    /// both output pipes captured.
    pub fn spawn(job: &JobControl, cmd: Command) -> Result<Arc<Self>, JobError> {
        Self::spawn_with(job, cmd, false)
    }

    /// Spawn a child whose `stdin` is a pipe we can write to (the sink of a
    /// dump → restore pipeline).
    pub fn spawn_sink(job: &JobControl, cmd: Command) -> Result<Arc<Self>, JobError> {
        Self::spawn_with(job, cmd, true)
    }

    fn spawn_with(
        job: &JobControl,
        mut cmd: Command,
        pipe_stdin: bool,
    ) -> Result<Arc<Self>, JobError> {
        cmd.stdin(if pipe_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
        configure_process_group(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| JobError::Spawn(e.to_string()))?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdin = child.stdin.take();
        let owned = Arc::new(Self {
            pid,
            state: Mutex::new(ChildState {
                child: Some(child),
                status: None,
            }),
            stdout: Mutex::new(stdout),
            stderr: Mutex::new(stderr),
            stdin: Mutex::new(stdin),
        });
        job.register(owned.clone());
        Ok(owned)
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn take_stdout(&self) -> Option<ChildStdout> {
        self.stdout.lock().ok().and_then(|mut g| g.take())
    }

    pub fn take_stderr(&self) -> Option<ChildStderr> {
        self.stderr.lock().ok().and_then(|mut g| g.take())
    }

    pub fn take_stdin(&self) -> Option<ChildStdin> {
        self.stdin.lock().ok().and_then(|mut g| g.take())
    }

    /// Exit status if the child has exited (remembered across calls).
    pub fn poll(&self) -> Option<ExitStatus> {
        let mut g = match self.state.lock() {
            Ok(g) => g,
            Err(_) => return None,
        };
        if g.status.is_some() {
            return g.status;
        }
        let child = g.child.as_mut()?;
        match child.try_wait() {
            Ok(Some(status)) => {
                g.status = Some(status);
                g.child = None;
                Some(status)
            }
            // Still running, or the wait itself failed (which we treat as exit
            // so the supervisor cannot spin forever).
            Ok(None) => None,
            Err(_) => {
                g.child = None;
                None
            }
        }
    }

    /// Block until the child exits, reaping it.
    pub fn wait(&self) -> Option<ExitStatus> {
        let mut g = match self.state.lock() {
            Ok(g) => g,
            Err(_) => return None,
        };
        if let Some(status) = g.status {
            return Some(status);
        }
        let status = g.child.as_mut().and_then(|c| c.wait().ok());
        g.status = status;
        g.child = None;
        status
    }

    /// Terminate the whole process tree: request a graceful stop, wait out the
    /// grace window, then kill whatever is left. Reaps the direct child.
    ///
    /// Safe to call more than once and from any thread; the lock guarantees the
    /// pid cannot be reaped (and therefore reused) while the group is signalled.
    pub fn terminate_tree(&self) {
        let mut g = match self.state.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        let Some(child) = g.child.as_mut() else {
            return; // already reaped
        };

        signal_tree(self.pid, SignalStrength::Graceful);

        let deadline = Instant::now() + TERMINATE_GRACE;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    g.status = Some(status);
                    g.child = None;
                    // Anything the dead child left behind in the group still
                    // needs the forced kill; the group id is only reusable
                    // after every member is gone.
                    signal_tree(self.pid, SignalStrength::Forced);
                    return;
                }
                Ok(None) => {
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }

        signal_tree(self.pid, SignalStrength::Forced);
        let status = child.wait().ok();
        g.status = status;
        g.child = None;
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SignalStrength {
    Graceful,
    Forced,
}

#[cfg(unix)]
fn configure_process_group(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    // A new process group/session makes the tree addressable as one unit.
    cmd.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    /// `CREATE_NEW_PROCESS_GROUP`
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn signal_tree(pid: u32, strength: SignalStrength) {
    let signal = match strength {
        SignalStrength::Graceful => libc::SIGTERM,
        SignalStrength::Forced => libc::SIGKILL,
    };
    // SAFETY: the child is its own process-group leader (`process_group(0)`),
    // so the negated pid addresses exactly that group and nothing else. The
    // caller holds the child lock, so the pid cannot have been reaped (and its
    // group id reused) before this call.
    unsafe {
        libc::kill(-(pid as libc::pid_t), signal);
    }
}

#[cfg(windows)]
fn signal_tree(pid: u32, strength: SignalStrength) {
    // Windows has no process-group signals; `taskkill /T` walks the tree.
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T"]);
    if strength == SignalStrength::Forced {
        cmd.arg("/F");
    }
    let _ = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

// ---------------------------------------------------------------------------
// Diagnostics capture
// ---------------------------------------------------------------------------

/// Drains one child pipe on its own thread, counting every byte (the progress
/// signal) and keeping at most [`MAX_DIAGNOSTIC_BYTES`] of it.
struct Drain {
    bytes: Arc<AtomicU64>,
    handle: Mutex<Option<std::thread::JoinHandle<Vec<u8>>>>,
}

impl Drain {
    fn start<R: Read + Send + 'static>(reader: Option<R>) -> Self {
        let bytes = Arc::new(AtomicU64::new(0));
        let counter = bytes.clone();
        let handle = reader.map(|mut reader| {
            std::thread::spawn(move || {
                let mut kept: Vec<u8> = Vec::new();
                let mut buf = vec![0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            counter.fetch_add(n as u64, Ordering::Relaxed);
                            if kept.len() < MAX_DIAGNOSTIC_BYTES {
                                let room = MAX_DIAGNOSTIC_BYTES - kept.len();
                                kept.extend_from_slice(&buf[..n.min(room)]);
                            }
                        }
                        Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    }
                }
                kept
            })
        });
        Self {
            bytes,
            handle: Mutex::new(handle),
        }
    }

    fn bytes(&self) -> u64 {
        self.bytes.load(Ordering::Relaxed)
    }

    /// Wait for the reader to finish and return what it kept.
    fn join(&self) -> String {
        let handle = self.handle.lock().ok().and_then(|mut g| g.take());
        match handle {
            Some(handle) => handle
                .join()
                .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
                .unwrap_or_default(),
            None => String::new(),
        }
    }
}

/// Result of one supervised child.
#[derive(Debug)]
pub struct ManagedOutput {
    pub status: ExitStatus,
    pub stdout: String,
    pub stderr: String,
}

/// Run one child to completion under `job`.
///
/// * `activity` supplies an extra progress signal (e.g. the size of the file the
///   tool is writing). Passing `None` means "no observable progress signal" —
///   such a job is cancellable but deliberately **not** subject to the idle
///   bound, because a quiet, long-running restore is indistinguishable from a
///   hung one and must not be killed.
pub fn run_managed(
    job: &JobControl,
    cmd: Command,
    activity: Option<Activity>,
) -> Result<ManagedOutput, JobError> {
    let child = ManagedChild::spawn(job, cmd)?;
    let stdout = Drain::start(child.take_stdout());
    let stderr = Drain::start(child.take_stderr());
    supervise(job, &[child.clone()], &[&stdout, &stderr], activity)?;

    let status = child
        .wait()
        .ok_or_else(|| JobError::Io("the tool exited without a status".to_string()))?;
    Ok(ManagedOutput {
        status,
        stdout: stdout.join(),
        stderr: stderr.join(),
    })
}

/// Run a dump → restore pipeline under `job`.
///
/// The dump's stdout is copied into the restore's stdin on a dedicated thread
/// (rather than handing the file descriptor across), so bytes crossing the pipe
/// are observable: a sync that moves no bytes and prints nothing is hung, while
/// one that is merely slow keeps resetting the idle clock.
pub fn run_managed_pipe(
    job: &JobControl,
    source: Command,
    sink: Command,
) -> Result<PipelineOutput, JobError> {
    let source_child = ManagedChild::spawn(job, source)?;
    let sink_child = ManagedChild::spawn_sink(job, sink)?;

    let source_stdout = source_child.take_stdout();
    let sink_stdin = sink_child.take_stdin();
    let source_err = Drain::start(source_child.take_stderr());
    let sink_err = Drain::start(sink_child.take_stderr());
    let sink_out = Drain::start(sink_child.take_stdout());

    let copied = Arc::new(AtomicU64::new(0));
    let copy_progress = copied.clone();
    let copier = std::thread::spawn(move || {
        let (Some(mut from), Some(mut to)) = (source_stdout, sink_stdin) else {
            return;
        };
        let mut buf = vec![0u8; 65536];
        loop {
            match from.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if to.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    copy_progress.fetch_add(n as u64, Ordering::Relaxed);
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        // Dropping `to` closes the sink's stdin so it sees EOF and exits.
    });

    let copy_counter = copied.clone();
    let activity: Activity = Arc::new(move || copy_counter.load(Ordering::Relaxed));
    let children = vec![source_child.clone(), sink_child.clone()];
    supervise(
        job,
        &children,
        &[&source_err, &sink_err, &sink_out],
        Some(activity),
    )?;

    let source_status = source_child.wait();
    let sink_status = sink_child.wait();
    let _ = copier.join();
    let out = PipelineOutput {
        source_status: source_status
            .ok_or_else(|| JobError::Io("the dump tool exited without a status".into()))?,
        sink_status: sink_status
            .ok_or_else(|| JobError::Io("the restore tool exited without a status".into()))?,
        source_stderr: source_err.join(),
        sink_stderr: sink_err.join(),
        copied_bytes: copied.load(Ordering::Relaxed),
    };
    let _ = sink_out.join();
    Ok(out)
}

/// Both ends of a pipe-based job.
#[derive(Debug)]
pub struct PipelineOutput {
    pub source_status: ExitStatus,
    pub sink_status: ExitStatus,
    pub source_stderr: String,
    pub sink_stderr: String,
    pub copied_bytes: u64,
}

/// Wait for `children` to finish, enforcing cancellation and (when a progress
/// signal exists) the idle bound.
fn supervise(
    job: &JobControl,
    children: &[Arc<ManagedChild>],
    drains: &[&Drain],
    activity: Option<Activity>,
) -> Result<(), JobError> {
    let idle_applies = activity.is_some();
    let mut last_seen = total_bytes(drains, activity.as_ref());
    let mut last_progress = Instant::now();

    loop {
        if job.is_cancelled() {
            terminate_all(job, children);
            return Err(JobError::Cancelled);
        }

        if children.iter().all(|c| c.poll().is_some()) {
            return Ok(());
        }

        // The idle bound only applies where progress is observable; see
        // `run_managed`'s contract.
        if idle_applies {
            let seen = total_bytes(drains, activity.as_ref());
            if seen != last_seen {
                last_seen = seen;
                last_progress = Instant::now();
            } else if job.is_idle(last_progress).is_some() {
                // A starved supervisor thread misses progress samples, which
                // would make a healthy backup on a busy machine look stalled.
                // Re-read, and require one more quiet poll interval before
                // condemning the job.
                if !confirm_silence(drains, activity.as_ref(), &mut last_seen) {
                    // The sample was simply late; the job is progressing.
                    last_progress = Instant::now();
                } else {
                    std::thread::sleep(POLL_INTERVAL);
                    if confirm_silence(drains, activity.as_ref(), &mut last_seen) {
                        terminate_all(job, children);
                        return Err(JobError::Idle(last_progress.elapsed()));
                    }
                    last_progress = Instant::now();
                }
            }
        }

        std::thread::sleep(POLL_INTERVAL);
    }
}

fn total_bytes(drains: &[&Drain], activity: Option<&Activity>) -> u64 {
    drains.iter().map(|d| d.bytes()).sum::<u64>() + activity.map(|a| a()).unwrap_or(0)
}

/// Whether the job produced nothing new since `last_seen` (which it updates
/// when it did). Used to double-check an apparently silent job before stopping
/// it.
fn confirm_silence(drains: &[&Drain], activity: Option<&Activity>, last_seen: &mut u64) -> bool {
    let seen = total_bytes(drains, activity);
    if seen == *last_seen {
        true
    } else {
        *last_seen = seen;
        false
    }
}

fn terminate_all(job: &JobControl, children: &[Arc<ManagedChild>]) {
    job.request_cancel();
    for child in children {
        child.terminate_tree();
    }
}

// ---------------------------------------------------------------------------
// Bounded capture (probes)
// ---------------------------------------------------------------------------

/// Run `program args` with a hard deadline, capturing bounded stdout/stderr.
///
/// Used by tool availability and version detection: a binary that never answers
/// `--version` must fail visibly instead of blocking detection forever.
pub fn capture_bounded(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<ManagedOutput, JobError> {
    let job = JobControl::detached();
    job.set_idle_timeout(timeout);

    let mut cmd = Command::new(program);
    cmd.args(args);
    let child = ManagedChild::spawn(&job, cmd)?;
    let stdout = Drain::start(child.take_stdout());
    let stderr = Drain::start(child.take_stderr());

    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.poll() {
            return Ok(ManagedOutput {
                status,
                stdout: stdout.join(),
                stderr: stderr.join(),
            });
        }
        if Instant::now() >= deadline {
            child.terminate_tree();
            let _ = stdout.join();
            let _ = stderr.join();
            return Err(JobError::Timeout(timeout));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

// ---------------------------------------------------------------------------
// Progress probes
// ---------------------------------------------------------------------------

/// Progress signal for a tool that writes to `path`: the file's length, or — for
/// a directory-format dump — the sum of its entries' lengths.
pub fn path_size_probe(path: impl AsRef<Path>) -> Activity {
    let path = path.as_ref().to_path_buf();
    Arc::new(move || path_size(&path))
}

fn path_size(path: &PathBuf) -> u64 {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta.len(),
        Ok(meta) if meta.is_dir() => sum_dir(path),
        _ => 0,
    }
}

fn sum_dir(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let path = e.path();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                sum_dir(&path)
            } else {
                std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
            }
        })
        .sum()
}

#[cfg(test)]
#[path = "job.test.rs"]
mod tests;
