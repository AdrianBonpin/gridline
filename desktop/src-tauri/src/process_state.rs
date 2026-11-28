//! Test-only support for **Process Liveness**: whether a given process is
//! running, distinguishing a process that has exited but has not yet been
//! reaped from one still executing.
//!
//! # Where the predicate is defined
//!
//! [`process_is_running`] is the one definition in this repository, and it
//! lives here, in `desktop/src-tauri/src/process_state.rs`. Every caller
//! (`job.test.rs`, `commands/backup.test.rs`) reaches it through
//! `crate::process_state::…`; there is no second copy and no per-module
//! wrapper. A fix therefore applies everywhere by existing once.
//!
//! # Why it is not `kill(pid, 0)`
//!
//! Issue #156's flake was a liveness probe that treats an **exited but
//! unreaped** process as running. `kill(pid, 0)` answers "does this pid still
//! resolve to a process and may I signal it", and a zombie — exited, waiting
//! for its parent (or a container's reaper) to collect it — still resolves
//! and still accepts a signal, so `kill(pid, 0)` returns success for it. A
//! cancellation test that polls that probe therefore waits for an init
//! process to reap the orphan rather than observing the exit itself. This
//! module answers the actual question by asking the operating system for the
//! process's **state**.
//!
//! The distinction drawn here is deliberately *exited-but-unreaped* versus
//! *running*, never *unreaped* versus *dead*: a process that is alive but not
//! exiting (sleeping, stopped, or genuinely hung) reads as running. Reporting
//! a hang as a successful termination would be a worse failure than the flake
//! this replaces.
//!
//! # What this module is not: Port Reachability
//!
//! `db/lifecycle.test.rs` has `reachable(port)` — whether something accepts a
//! TCP connection on a loopback port. That is **Port Reachability**: it
//! involves no child process and says nothing about process state. Those
//! tests bind in-process listeners and spawn nothing, so they cannot exhibit a
//! zombie symptom at all; `reachable` is unrelated to this predicate, shares
//! no code with it, and is deliberately left untouched. The issue's original
//! body blamed that helper because "liveness probe" was used for both
//! concepts; see `GLOSSARY.md` (Process Liveness, Port Reachability, and the
//! resolved ambiguity between them).
//!
//! # Platform behaviour
//!
//! * **Linux / Android** — reads the state character from
//!   `/proc/<pid>/stat`; `Z` (zombie) and `X`/`x` (dead) are not running,
//!   every other state (running, sleeping, disk-sleep, stopped, idle) is.
//! * **macOS** — `sysctl(KERN_PROC_PID)` and the `p_stat` field of the
//!   returned `struct kinfo_proc`; `SZOMBIE` is not running, the process
//!   having vanished is not running, every other state is.
//! * **Windows** — `OpenProcess` + `GetExitCodeProcess`/`WaitForSingleObject`
//!   on the process handle. Windows has no zombie in the Unix sense: a
//!   terminated process stays in the process table only while a handle to it
//!   is open, and its exit code is already available, so a terminated process
//!   whose handle the test still holds reads as not running. A pid that
//!   cannot be opened because it does not exist reads as not running; any
//!   other open failure leaves the process unobserved, and an unobserved
//!   process is never reported as terminated.
//! * **Other Unix** (iOS, the BSDs) — no state source is wired up, so only
//!   existence is observed (the conservative fallback below).
//!
//! When a platform cannot answer, the predicate falls back to an existence
//! check (`kill(pid, 0)` on Unix): an unobservable process is reported as
//! running rather than as terminated, because claiming an exit that was never
//! observed is the failure mode this module exists to avoid.

use std::path::Path;
use std::time::{Duration, Instant};

/// Whether `pid` names a process that is still executing.
///
/// `false` means the process has exited (whether or not its parent has
/// collected it yet) or that no such process exists. A running, sleeping or
/// stopped process is `true`.
#[cfg(unix)]
pub(crate) fn process_is_running(pid: u32) -> bool {
    match observed_running(pid) {
        Some(running) => running,
        // The platform could not answer — which is not the same as "it has
        // exited", so fall back to existence and never claim a termination
        // that was not observed.
        None => pid_exists(pid),
    }
}

/// Whether `pid` names a process that is still executing.
///
/// `false` means the process has terminated (whether or not whatever holds a
/// handle to it has released that handle) or that no such process exists. A
/// running, suspended or terminated-but-uncollected process is handled
/// according to the platform notes on this module.
#[cfg(windows)]
pub(crate) fn process_is_running(pid: u32) -> bool {
    use std::ffi::c_void;

    type Handle = *mut c_void;

    /// `PROCESS_QUERY_LIMITED_INFORMATION`: read the exit code.
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    /// `SYNCHRONIZE`: wait on the process object.
    const SYNCHRONIZE: u32 = 0x0010_0000;
    /// `WAIT_TIMEOUT`: the object was not signalled, i.e. still running.
    const WAIT_TIMEOUT: u32 = 258;
    /// `ERROR_INVALID_PARAMETER`: the pid does not name a process.
    const ERROR_INVALID_PARAMETER: u32 = 87;
    /// `STILL_ACTIVE`: the exit code reported while the process runs.
    const STILL_ACTIVE: u32 = 259;

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> Handle;
        fn GetExitCodeProcess(process: Handle, exit_code: *mut u32) -> i32;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn CloseHandle(object: Handle) -> i32;
        fn GetLastError() -> u32;
    }

    // SAFETY: every call below passes a handle this function opened, and
    // closes it exactly once before returning; no pointer outlives the call.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, 0, pid);
        if handle.is_null() {
            // `ERROR_INVALID_PARAMETER` means the pid names no process at all.
            // Any other failure (access denied) leaves the process
            // unobserved, and an unobserved process is not reported as
            // terminated.
            return GetLastError() != ERROR_INVALID_PARAMETER;
        }

        let mut exit_code = 0u32;
        let code_ok = GetExitCodeProcess(handle, &mut exit_code);
        let wait = WaitForSingleObject(handle, 0);
        CloseHandle(handle);

        if code_ok == 0 {
            return true;
        }
        if exit_code != STILL_ACTIVE {
            return false;
        }
        // `STILL_ACTIVE` is `259`, so a process that genuinely exited with
        // code 259 is indistinguishable from a running one by exit code
        // alone; the wait settles which it is.
        wait == WAIT_TIMEOUT
    }
}

#[cfg(not(any(unix, windows)))]
compile_error!(
    "Process Liveness has no definition on this platform; see \
     desktop/src-tauri/src/process_state.rs"
);

/// Whether `pid` still resolves to a process at all.
///
/// This is the probe that cannot answer the question this module exists to
/// answer — `kill(pid, 0)` succeeds for a zombie — so it is used only as the
/// fallback when the process state cannot be observed.
#[cfg(unix)]
fn pid_exists(pid: u32) -> bool {
    // SAFETY: signal 0 performs the existence/permission check only.
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    if rc == 0 {
        return true;
    }
    // `EPERM` = the process exists but is not ours to signal; `ESRCH` = gone.
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// The process state the platform reports, or `None` when it cannot answer.
///
/// `Some(false)` means the process has exited (reaped or not) or does not
/// exist; `Some(true)` means it is executing, sleeping or stopped.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn observed_running(pid: u32) -> Option<bool> {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => linux_proc_state(&stat),
        // No such process: the entry disappears with the process, so this is
        // an observation, not a failure to observe.
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Some(false),
        Err(_) => None,
    }
}

/// Reads the state out of a `/proc/<pid>/stat` line.
///
/// `Z` is a zombie and `X`/`x` is dead; every other state (running, sleeping,
/// disk-sleep, stopped, idle) is a process that still exists and can proceed.
/// Kept free of platform code so the parsing — where the `comm` field may
/// itself contain spaces and parentheses — is testable off Linux.
#[cfg_attr(not(any(target_os = "linux", target_os = "android")), allow(dead_code))]
fn linux_proc_state(stat: &str) -> Option<bool> {
    // `comm` is parenthesised, so the state is the first field after the last
    // ')' — searching from the right is what makes a `comm` containing ')' or
    // spaces harmless.
    let after = &stat[stat.rfind(')')? + 1..];
    let state = after.trim_start().chars().next()?;
    Some(!matches!(state, 'Z' | 'X' | 'x'))
}

/// The process state the platform reports, or `None` when it cannot answer.
///
/// macOS: `sysctl(KERN_PROC_PID)` and the `p_stat` field of the returned
/// `struct kinfo_proc`. A zombie is `SZOMBIE`; a pid that names no process
/// produces no data at all (`len == 0`).
#[cfg(target_os = "macos")]
fn observed_running(pid: u32) -> Option<bool> {
    /// The leading fields of `struct kinfo_proc`, up to `p_stat`: on 64-bit
    /// Darwin `struct extern_proc` begins with a 16-byte union (two pointers,
    /// or a `timeval`), then two pointers, then `p_flag` and `p_stat`.
    #[repr(C)]
    struct KinfoProcHead {
        _p_un: [u8; 16],
        _p_vmspace: *mut u8,
        _p_sigacts: *mut u8,
        _p_flag: i32,
        p_stat: i8,
    }

    /// `SZOMBIE` from `sys/proc.h`: exited, waiting to be reaped.
    const SZOMBIE: i8 = 5;
    const CTL_KERN: i32 = 1;
    const KERN_PROC: i32 = 14;
    const KERN_PROC_PID: i32 = 1;

    let mut mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid as i32];
    // Larger than `sizeof(struct kinfo_proc)` (648 bytes on the machines this
    // runs on); the kernel writes the size it produced back into `len`.
    let mut buf = [0u8; 1024];
    let mut len = buf.len();
    // SAFETY: `mib` is a valid array of four ints, `buf`/`len` are a matching
    // output pair, and no new value is supplied (`newp` null, `newlen` 0).
    let rc = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as libc::c_uint,
            buf.as_mut_ptr() as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if rc != 0 {
        return None;
    }
    let p_stat_offset = std::mem::offset_of!(KinfoProcHead, p_stat);
    if len < p_stat_offset + 1 {
        // Nothing was written: no such process.
        return Some(false);
    }
    // Read the single byte through the byte buffer, so the buffer's alignment
    // never has to match the struct's.
    Some(buf[p_stat_offset] as i8 != SZOMBIE)
}

/// No state source is wired up for this Unix; existence is all that is
/// observed, and the caller's fallback applies.
#[cfg(all(
    unix,
    not(any(target_os = "linux", target_os = "android", target_os = "macos"))
))]
fn observed_running(_pid: u32) -> Option<bool> {
    None
}

/// Waits for `path` to contain a pid, which is how a shell-script fixture
/// publishes the pid of the process it spawned.
pub(crate) fn wait_for_pid(path: &Path, timeout: Duration) -> Option<u32> {
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

/// Waits until `pid` is no longer running, or `timeout` elapses.
///
/// Returns `true` when the process was observed not running. Because
/// [`process_is_running`] reads the process's state rather than its pid's
/// resolvability, this returns as soon as the process exits — it does not wait
/// for an init process to reap an orphan.
pub(crate) fn wait_until_dead(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !process_is_running(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    !process_is_running(pid)
}

#[cfg(test)]
#[path = "process_state.test.rs"]
mod tests;
