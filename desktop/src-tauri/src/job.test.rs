//! Behavioural tests for managed external-tool jobs: ownership, cancellation,
//! process-tree termination, idle bounds, bounded probes and registry cleanup.
//!
//! Every process here is a real shell script, so the process-tree assertions
//! are observations of the operating system rather than of our own bookkeeping.

use super::*;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "gridline_job_{tag}_{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(unix)]
fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt as _;
    let path = dir.join(name);
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(body.as_bytes()).unwrap();
    file.flush().unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();
    path
}

/// Whether a pid still exists. `kill(pid, 0)` succeeds for a live process and
/// for a zombie, which is why callers poll with [`wait_until_dead`].
#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // SAFETY: signal 0 performs the existence/permission check only.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
fn wait_for_pid(path: &Path, timeout: Duration) -> Option<u32> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(pid) = text.trim().parse::<u32>() {
                return Some(pid);
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

#[cfg(unix)]
fn wait_until_dead(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !pid_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !pid_alive(pid)
}

fn cmd(program: &Path) -> Command {
    let mut c = Command::new(program);
    c.stdin(Stdio::null());
    c
}

// ---------------------------------------------------------------------------
// Process-tree termination
// ---------------------------------------------------------------------------

/// The acceptance criterion: cancelling must leave no orphan behind. The fake
/// tool spawns a grandchild of its own, exactly like a dump/client helper would.
#[cfg(unix)]
#[test]
fn cancel_terminates_the_child_process_tree() {
    let dir = temp_dir("tree");
    let pid_file = dir.join("grandchild.pid");
    let script = write_script(
        &dir,
        "forking-tool",
        &format!(
            "#!/bin/sh\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            pid_file.display()
        ),
    );

    let job = JobControl::detached();
    let runner_job = job.clone();
    let handle = std::thread::spawn(move || run_managed(&runner_job, cmd(&script), None));

    let grandchild = wait_for_pid(&pid_file, Duration::from_secs(5)).expect("grandchild pid");
    assert!(pid_alive(grandchild), "the grandchild should be running");

    job.cancel();
    let outcome = handle.join().unwrap();

    assert!(
        matches!(outcome, Err(JobError::Cancelled)),
        "cancel must be reported as a cancellation, got {outcome:?}"
    );
    assert!(
        wait_until_dead(grandchild, Duration::from_secs(5)),
        "the grandchild process {grandchild} survived cancellation"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Cancellation must be prompt, not "whenever the tool finishes".
#[cfg(unix)]
#[test]
fn cancel_stops_the_job_promptly() {
    let dir = temp_dir("prompt");
    let script = write_script(&dir, "sleeper", "#!/bin/sh\nsleep 30\n");
    let job = JobControl::detached();
    let runner_job = job.clone();

    let handle = std::thread::spawn(move || run_managed(&runner_job, cmd(&script), None));
    std::thread::sleep(Duration::from_millis(250));

    let started = Instant::now();
    job.cancel();
    let outcome = handle.join().unwrap();
    let elapsed = started.elapsed();

    assert!(matches!(outcome, Err(JobError::Cancelled)), "{outcome:?}");
    assert!(
        elapsed < Duration::from_secs(3),
        "cancellation took {elapsed:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A cancelled job reports its cancellation, never a fabricated tool error.
#[cfg(unix)]
#[test]
fn a_cancelled_job_is_not_reported_as_a_tool_failure() {
    let dir = temp_dir("cancelled_kind");
    let script = write_script(&dir, "sleeper", "#!/bin/sh\nsleep 30\n");
    let job = JobControl::detached();
    let runner_job = job.clone();
    let handle = std::thread::spawn(move || run_managed(&runner_job, cmd(&script), None));
    std::thread::sleep(Duration::from_millis(150));
    job.cancel();
    let outcome = handle.join().unwrap();
    match outcome {
        Err(e) => {
            assert!(e.is_cancelled());
            assert!(!e.message().to_lowercase().contains("signal"));
        }
        Ok(_) => panic!("expected a cancellation"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Idle bounds (never a total-duration cap)
// ---------------------------------------------------------------------------

/// A job that stops producing any observable progress is terminated instead of
/// waiting forever.
#[cfg(unix)]
#[test]
fn a_stalled_job_is_stopped_by_the_idle_bound() {
    let dir = temp_dir("idle");
    let script = write_script(&dir, "stalled", "#!/bin/sh\nsleep 30\n");
    let job = JobControl::detached();
    job.set_idle_timeout(Duration::from_millis(300));

    let started = Instant::now();
    // An activity probe that never advances: the tool is producing nothing.
    let outcome = run_managed(&job, cmd(&script), Some(Arc::new(|| 0u64)));
    let elapsed = started.elapsed();

    assert!(
        matches!(outcome, Err(JobError::Idle(_))),
        "a stalled job must hit the idle bound, got {outcome:?}"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "idle bound took {elapsed:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The reason the bound is an *idle* bound: a big backup that keeps writing must
/// outlive it. The tool runs for well over the idle window while its output file
/// keeps growing, and is expected to finish normally.
#[cfg(unix)]
#[test]
fn a_continuously_progressing_job_is_not_killed_by_the_idle_bound() {
    let dir = temp_dir("progress");
    let output = dir.join("dump.out");
    let script = write_script(
        &dir,
        "slow-but-progressing",
        &format!(
            "#!/bin/sh\nfor i in $(seq 1 30); do echo \"row $i\" >> '{}'; sleep 0.05; done\nexit 0\n",
            output.display()
        ),
    );
    let probe_path = output.clone();
    let job = JobControl::detached();
    // Half the write interval is far too tight: a loaded machine (the whole
    // test suite runs in parallel) can delay both processes by more than that
    // and make a healthy job look stalled.
    let idle = Duration::from_millis(800);
    job.set_idle_timeout(idle);

    let started = Instant::now();
    let outcome = run_managed(
        &job,
        cmd(&script),
        Some(Arc::new(move || {
            std::fs::metadata(&probe_path).map(|m| m.len()).unwrap_or(0)
        })),
    );
    let elapsed = started.elapsed();

    assert!(
        matches!(outcome, Ok(ref o) if o.status.success()),
        "a progressing job must not be killed, got {outcome:?}"
    );
    assert!(
        elapsed > idle,
        "the fixture must outlive the idle window (ran {elapsed:?})"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Bounded probes
// ---------------------------------------------------------------------------

/// The probe bug: a binary that ignores `--version` used to hang the caller
/// forever. It must now return within its deadline and report the timeout.
#[cfg(unix)]
#[test]
fn a_hanging_probe_is_bounded_and_fails_visibly() {
    let dir = temp_dir("probe_hang");
    let program = write_script(&dir, "hanging-tool", "#!/bin/sh\nsleep 30\n");

    let started = Instant::now();
    let outcome = capture_bounded(
        program.to_str().unwrap(),
        &["--version"],
        Duration::from_millis(250),
    );
    let elapsed = started.elapsed();

    assert!(
        matches!(outcome, Err(JobError::Timeout(_))),
        "expected a bounded timeout, got {outcome:?}"
    );
    assert!(elapsed < Duration::from_secs(4), "probe took {elapsed:?}");
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_cooperating_probe_returns_its_version_output() {
    let dir = temp_dir("probe_ok");
    let program = write_script(
        &dir,
        "versioned-tool",
        "#!/bin/sh\necho 'pg_dump (PostgreSQL) 16.3'\nexit 0\n",
    );
    let out = capture_bounded(
        program.to_str().unwrap(),
        &["--version"],
        Duration::from_secs(5),
    )
    .expect("probe should succeed");
    assert!(out.status.success());
    assert!(out.stdout.contains("PostgreSQL"));
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Diagnostics capture
// ---------------------------------------------------------------------------

/// A noisy tool must not deadlock on its pipe (the drain is what prevents it),
/// and diagnostics stay bounded rather than growing without limit.
#[cfg(unix)]
#[test]
fn a_noisy_tool_is_drained_without_deadlock_and_its_diagnostics_are_bounded() {
    let dir = temp_dir("noisy");
    let script = write_script(
        &dir,
        "noisy",
        "#!/bin/sh\ni=0\nwhile [ $i -lt 400 ]; do\n  printf '%s\\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' >&2\n  i=$((i+1))\ndone\nexit 0\n",
    );
    let job = JobControl::detached();
    let out = run_managed(&job, cmd(&script), None).expect("noisy tool should finish");
    assert!(out.status.success());
    assert!(
        out.stderr.len() <= MAX_DIAGNOSTIC_BYTES + 64,
        "diagnostics were not capped: {} bytes",
        out.stderr.len()
    );
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Pipelines (dump -> restore)
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[test]
fn a_pipeline_reports_both_exit_statuses_and_pipes_bytes_through() {
    let dir = temp_dir("pipeline_ok");
    let dump = write_script(&dir, "dump", "#!/bin/sh\necho 'CREATE TABLE t (id INT);'\n");
    let sink = write_script(&dir, "sink", "#!/bin/sh\ncat >/dev/null\n");
    let job = JobControl::detached();

    let out = run_managed_pipe(&job, cmd(&dump), cmd(&sink)).expect("pipeline should run");
    assert!(out.source_status.success());
    assert!(out.sink_status.success());
    assert!(out.copied_bytes > 0, "bytes must flow through the pipe");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Cancelling a sync must kill both ends, not just the one the supervisor
/// happens to be waiting on.
#[cfg(unix)]
#[test]
fn cancelling_a_pipeline_kills_both_processes() {
    let dir = temp_dir("pipeline_cancel");
    let dump_pid = dir.join("dump.pid");
    let sink_pid = dir.join("sink.pid");
    let dump = write_script(
        &dir,
        "dump",
        &format!(
            "#!/bin/sh\necho $$ > '{}'\nwhile :; do echo x; sleep 0.05; done\n",
            dump_pid.display()
        ),
    );
    let sink = write_script(
        &dir,
        "sink",
        &format!(
            "#!/bin/sh\necho $$ > '{}'\nwhile :; do sleep 0.05; done\n",
            sink_pid.display()
        ),
    );
    let job = JobControl::detached();
    let runner_job = job.clone();
    let d = dump.clone();
    let s = sink.clone();
    let handle = std::thread::spawn(move || run_managed_pipe(&runner_job, cmd(&d), cmd(&s)));

    let dp = wait_for_pid(&dump_pid, Duration::from_secs(5)).expect("dump pid");
    let sp = wait_for_pid(&sink_pid, Duration::from_secs(5)).expect("sink pid");

    job.cancel();
    let outcome = handle.join().unwrap();
    assert!(matches!(outcome, Err(JobError::Cancelled)), "{outcome:?}");
    assert!(wait_until_dead(dp, Duration::from_secs(5)), "dump survived");
    assert!(wait_until_dead(sp, Duration::from_secs(5)), "sink survived");
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// Registry ownership
// ---------------------------------------------------------------------------

#[test]
fn the_registry_tracks_begin_finish_and_unknown_jobs() {
    let registry = JobRegistry::new();
    let job = registry.begin("job-1");
    assert!(registry.get("job-1").is_some());
    assert!(Arc::ptr_eq(&registry.get("job-1").unwrap(), &job));
    assert!(!registry.cancel("missing"), "unknown jobs cannot be cancelled");

    registry.finish("job-1");
    assert!(registry.get("job-1").is_none());
    assert!(registry.active().is_empty());
}

#[cfg(unix)]
#[test]
fn cancelling_one_job_leaves_another_running() {
    let dir = temp_dir("registry_isolation");
    let script = write_script(&dir, "sleeper", "#!/bin/sh\nsleep 30\n");
    let registry = JobRegistry::new();

    let first = registry.begin("j1");
    let second = registry.begin("j2");

    let f = first.clone();
    let s = second.clone();
    let p = script.clone();
    let h1 = std::thread::spawn(move || run_managed(&f, cmd(&p), None));
    let p2 = script.clone();
    let h2 = std::thread::spawn(move || run_managed(&s, cmd(&p2), None));
    std::thread::sleep(Duration::from_millis(250));

    assert!(registry.cancel("j1"));
    assert!(matches!(h1.join().unwrap(), Err(JobError::Cancelled)));
    assert!(!second.is_cancelled(), "sibling job must keep running");
    assert!(second.child_pids().iter().any(|p| pid_alive(*p)));

    second.cancel();
    assert!(matches!(h2.join().unwrap(), Err(JobError::Cancelled)));
    let _ = std::fs::remove_dir_all(&dir);
}

/// App exit path: everything in flight is terminated.
#[cfg(unix)]
#[test]
fn cancel_all_terminates_every_running_job() {
    let dir = temp_dir("registry_all");
    let pid_a = dir.join("a.pid");
    let pid_b = dir.join("b.pid");
    let a = write_script(
        &dir,
        "a",
        &format!(
            "#!/bin/sh\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            pid_a.display()
        ),
    );
    let b = write_script(
        &dir,
        "b",
        &format!(
            "#!/bin/sh\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            pid_b.display()
        ),
    );
    let registry = JobRegistry::new();
    let job_a = registry.begin("a");
    let job_b = registry.begin("b");
    let ja = job_a.clone();
    let jb = job_b.clone();
    let ha = std::thread::spawn(move || run_managed(&ja, cmd(&a), None));
    let hb = std::thread::spawn(move || run_managed(&jb, cmd(&b), None));

    let ga = wait_for_pid(&pid_a, Duration::from_secs(5)).expect("a grandchild");
    let gb = wait_for_pid(&pid_b, Duration::from_secs(5)).expect("b grandchild");

    assert_eq!(registry.cancel_all(), 2);
    assert!(matches!(ha.join().unwrap(), Err(JobError::Cancelled)));
    assert!(matches!(hb.join().unwrap(), Err(JobError::Cancelled)));
    assert!(wait_until_dead(ga, Duration::from_secs(5)), "a orphaned");
    assert!(wait_until_dead(gb, Duration::from_secs(5)), "b orphaned");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_default_idle_bound_is_generous_enough_for_a_large_backup() {
    // A guard against reintroducing a short total-duration cap by accident.
    assert!(
        DEFAULT_IDLE_TIMEOUT >= Duration::from_secs(300),
        "the default idle bound must not be a de-facto total runtime cap"
    );
    assert!(DEFAULT_PROBE_TIMEOUT <= Duration::from_secs(5));
}

#[test]
fn job_errors_map_to_actionable_messages() {
    assert_eq!(JobError::Cancelled.message(), "Job cancelled");
    let idle = JobError::Idle(Duration::from_secs(600)).message();
    assert!(idle.contains("no progress"), "got {idle}");
    let timeout = JobError::Timeout(Duration::from_secs(2)).message();
    assert!(timeout.contains("did not respond"), "got {timeout}");
    assert!(JobError::Cancelled.is_cancelled());
    assert!(!JobError::Timeout(Duration::from_secs(1)).is_cancelled());
}
