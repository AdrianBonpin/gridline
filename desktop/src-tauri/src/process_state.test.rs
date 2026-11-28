//! Tests for the shared Process Liveness predicate.
//!
//! Every process here is real: a test spawns an actual child, kills it without
//! collecting it, and asks the operating system what became of it. Nothing is
//! mocked, and the "exited" state is produced deliberately rather than waited
//! for.

use super::*;
use std::process::{Child, Command, Stdio};

/// A child that stays alive until it is killed. Unix gets a real `sleep`;
/// Windows gets `ping`, which is present on every installation and blocks for
/// the requested number of echoes.
#[cfg(unix)]
fn long_lived_child() -> Child {
    Command::new("sleep")
        .arg("30")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn a long-lived child")
}

#[cfg(windows)]
fn long_lived_child() -> Child {
    Command::new("cmd")
        .args(["/C", "ping", "-n", "30", "127.0.0.1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn a long-lived child")
}

/// The state the operating system itself reports for `pid`, read from a source
/// the predicate does not use on that platform: `ps` on macOS, `/proc` on
/// Linux. This is the independent oracle that keeps the zombie test from
/// passing vacuously.
#[cfg(unix)]
fn os_reported_state(pid: u32) -> Option<char> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("ps")
            .args(["-o", "state=", "-p", &pid.to_string()])
            .stdin(Stdio::null())
            .output()
            .ok()?;
        return String::from_utf8_lossy(&out.stdout)
            .chars()
            .find(|c| c.is_ascii_alphabetic());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        // `comm` is parenthesised and may itself contain spaces and
        // parentheses, so the state is the first field after the last ')'.
        let after = &stat[stat.rfind(')')? + 1..];
        after.trim_start().chars().next()
    }
}

/// A running process must read as running — including one that is alive and
/// not exiting, so a genuine hang is never reported as a successful
/// termination.
#[test]
fn a_running_process_reads_as_running() {
    let mut child = long_lived_child();
    let pid = child.id();

    assert!(
        process_is_running(pid),
        "a freshly spawned child must read as running"
    );
    // Not merely spawn-time optimism: it is still running a moment later,
    // having done nothing but sleep.
    std::thread::sleep(Duration::from_millis(250));
    assert!(
        process_is_running(pid),
        "a child that is alive and not exiting must keep reading as running"
    );

    let _ = child.kill();
    let _ = child.wait();
}

/// The defect from issue #119: a process that has exited but has not been
/// reaped must read as not running. `kill(pid, 0)` succeeds for exactly this
/// state, which is why a cancellation test using it waited for an init process
/// to collect the orphan.
#[cfg(unix)]
#[test]
fn a_deliberately_created_zombie_reads_as_not_running() {
    let mut child = long_lived_child();
    let pid = child.id();
    assert!(
        process_is_running(pid),
        "precondition: the child must start out running"
    );

    // Kill it and never reap it: `Child::kill` delivers SIGKILL and does not
    // collect the child, and dropping a `Child` does not wait, so the process
    // becomes a zombie and stays one.
    child.kill().expect("kill the child");
    let deadline = Instant::now() + Duration::from_secs(5);
    while os_reported_state(pid) != Some('Z') && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }

    // The premise, from the operating system rather than from the predicate:
    // this pid is a zombie right now.
    assert_eq!(
        os_reported_state(pid),
        Some('Z'),
        "the child must be a zombie for this test to mean anything"
    );
    // ... and the pid still resolves, which is what the old probe measured.
    // SAFETY: signal 0 performs the existence/permission check only.
    assert_eq!(
        unsafe { libc::kill(pid as libc::pid_t, 0) },
        0,
        "an unreaped zombie still resolves to a process"
    );

    assert!(
        !process_is_running(pid),
        "a process that has exited must not read as running, even unreaped"
    );
    assert!(
        wait_until_dead(pid, Duration::from_secs(5)),
        "waiting for the exit must succeed without an init process reaping it"
    );
}

/// The same requirement stated for every platform, including Windows, where a
/// terminated process stays in the process table only while a handle to it is
/// held. The child is killed and never waited on, so the pid is still
/// allocated here on both Unix and Windows.
#[test]
fn an_exited_process_reads_as_not_running() {
    let mut child = long_lived_child();
    let pid = child.id();
    assert!(
        process_is_running(pid),
        "precondition: the child must start out running"
    );

    child.kill().expect("kill the child");

    assert!(
        wait_until_dead(pid, Duration::from_secs(10)),
        "a killed process must read as not running without being reaped"
    );
    assert!(
        !process_is_running(pid),
        "an exited process must not read as running"
    );
}

/// A pid that never named a process cannot be running.
#[test]
fn an_unused_pid_reads_as_not_running() {
    // Above every platform's default `pid_max`-style ceiling, so it cannot
    // name a live process on the machines this runs on.
    assert!(!process_is_running(4_000_000));
}

/// `/proc/<pid>/stat` reports an exited process as `Z` (zombie) or `X`/`x`
/// (dead); both mean it is not running. The `comm` field is parenthesised and
/// may itself contain spaces and parentheses, which is the part worth testing
/// on a machine that is not Linux.
#[test]
fn a_proc_stat_zombie_or_dead_state_is_not_running() {
    assert_eq!(
        linux_proc_state("4321 (sleeper) Z 1 4321 4321 0 -1"),
        Some(false)
    );
    assert_eq!(
        linux_proc_state("4321 (a (tricky) comm) Z 1 4321 4321 0 -1"),
        Some(false)
    );
    assert_eq!(
        linux_proc_state("4321 (sleeper) X 1 4321 0 -1"),
        Some(false)
    );
    assert_eq!(
        linux_proc_state("4321 (sleeper) x 1 4321 0 -1"),
        Some(false)
    );
}

/// Every other `/proc/<pid>/stat` state is a process that still exists and can
/// make progress, so it must read as running — including a stopped process,
/// which is blocked rather than finished.
#[test]
fn an_executing_or_blocked_proc_stat_state_is_running() {
    for state in ["R", "S", "D", "T", "t", "I"] {
        let stat = format!("4321 (sleeper) {state} 1 4321 4321 0 -1");
        assert_eq!(
            linux_proc_state(&stat),
            Some(true),
            "state {state} must read as running"
        );
    }
}
