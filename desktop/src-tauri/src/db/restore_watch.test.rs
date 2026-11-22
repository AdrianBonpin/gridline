use super::*;

fn at(ms: u64) -> Instant {
    // One shared origin: the tests only compare instants they created.
    static ORIGIN: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    *ORIGIN.get_or_init(Instant::now) + Duration::from_millis(ms)
}

const PID: i32 = 4242;

/// The case the ticketed fix is about: a restore blocked behind another
/// session's lock waits forever, so the wait itself has to be bounded.
#[test]
fn a_continuous_lock_wait_is_stopped_at_the_deadline() {
    let mut watch = LockWatch::new(Duration::from_secs(60));

    assert_eq!(
        watch.observe(at(0), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Continue,
        "the first blocked sample only starts the clock"
    );
    assert_eq!(
        watch.observe(at(59_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Continue,
        "still inside the deadline"
    );
    assert_eq!(
        watch.observe(at(60_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Stop {
            pid: PID,
            waited: Duration::from_secs(60)
        }
    );
}

/// The guarantee the ticket adds on top: a legitimately SLOW restore is never
/// killed, because it is not waiting on a lock. A 2 GB `COPY` takes far longer
/// than the deadline and must keep running.
#[test]
fn a_slow_but_working_restore_is_never_stopped() {
    let mut watch = LockWatch::new(Duration::from_secs(60));
    // Two hours of samples, all "running, not waiting on a lock".
    for second in 0..(2 * 60 * 60) {
        assert_eq!(
            watch.observe(at(second * 1_000), LockSample::Running { pid: PID }),
            WatchDecision::Continue,
            "a progressing restore must never be stopped (at {second}s)"
        );
    }
}

/// A wait that is interrupted by progress is not a stall: the clock restarts.
#[test]
fn progress_between_waits_resets_the_clock() {
    let mut watch = LockWatch::new(Duration::from_secs(60));
    watch.observe(at(0), LockSample::WaitingForLock { pid: PID });
    watch.observe(at(50_000), LockSample::WaitingForLock { pid: PID });
    // It got the lock, did work, and queued for the next one.
    assert_eq!(
        watch.observe(at(55_000), LockSample::Running { pid: PID }),
        WatchDecision::Continue
    );
    assert_eq!(
        watch.observe(at(60_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Continue,
        "the wait restarted at 60s, so it is not 60s old yet"
    );
    assert_eq!(
        watch.observe(at(119_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Continue
    );
    assert_eq!(
        watch.observe(at(120_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Stop {
            pid: PID,
            waited: Duration::from_secs(60)
        }
    );
}

/// A blind sample (the backend is not visible yet, or the sampling query failed)
/// must not be read as a stall — that would let a transient connection problem
/// kill a healthy restore.
#[test]
fn a_blind_sample_never_stops_a_restore() {
    let mut watch = LockWatch::new(Duration::from_secs(5));
    watch.observe(at(0), LockSample::WaitingForLock { pid: PID });
    assert_eq!(
        watch.observe(at(500_000), LockSample::NotSeen),
        WatchDecision::Continue
    );
    // And a later wait starts a fresh clock rather than inheriting the old one.
    assert_eq!(
        watch.observe(at(501_000), LockSample::WaitingForLock { pid: PID }),
        WatchDecision::Continue
    );
}

/// Two backends (a reconnect, or another restore) must not be accumulated: only
/// the same pid's continuous wait counts.
#[test]
fn a_different_backend_starts_a_new_clock() {
    let mut watch = LockWatch::new(Duration::from_secs(10));
    watch.observe(at(0), LockSample::WaitingForLock { pid: 1 });
    assert_eq!(
        watch.observe(at(9_000), LockSample::WaitingForLock { pid: 2 }),
        WatchDecision::Continue,
        "a different pid must not inherit the first one's wait"
    );
    assert_eq!(
        watch.observe(at(19_000), LockSample::WaitingForLock { pid: 2 }),
        WatchDecision::Stop {
            pid: 2,
            waited: Duration::from_secs(10)
        }
    );
}

#[test]
fn the_default_deadline_bounds_a_wait_without_being_a_duration_cap() {
    assert!(
        DEFAULT_LOCK_WAIT_DEADLINE >= Duration::from_secs(30),
        "a busy database may legitimately hold a lock for tens of seconds"
    );
    assert!(
        DEFAULT_LOCK_WAIT_DEADLINE <= Duration::from_secs(300),
        "a lock wait must not be allowed to look like an indefinite hang"
    );
    assert!(
        SAMPLE_INTERVAL < DEFAULT_LOCK_WAIT_DEADLINE,
        "the sampling interval must be finer than the deadline it enforces"
    );
}

#[test]
fn the_application_name_is_per_job_and_unambiguous() {
    let name = restore_application_name("8f1c2");
    assert_eq!(name, "gridline-restore-8f1c2");
    assert!(name.starts_with(RESTORE_APP_PREFIX));
    assert_ne!(name, restore_application_name("8f1c2-other"));
}

#[test]
fn the_watch_queries_are_parameterised_and_terminate_rather_than_cancel() {
    // The pid and the application name travel as bind parameters: no value a job
    // id could contain ever becomes SQL.
    assert!(RESTORE_BACKEND_SQL.contains("$1"));
    assert!(RESTORE_BACKEND_SQL.contains("pg_stat_activity"));
    assert!(RESTORE_BACKEND_SQL.contains("wait_event_type = 'Lock'"));
    assert!(TERMINATE_BACKEND_SQL.contains("pg_terminate_backend($1)"));
    assert!(
        !TERMINATE_BACKEND_SQL.contains("pg_cancel_backend"),
        "cancelling one statement would let the restore retry the same lock"
    );
}

#[test]
fn the_stop_message_names_the_wait_and_the_recovery() {
    let message = lock_wait_stop_message(Duration::from_secs(60));
    assert!(message.contains("60s"), "got: {message}");
    assert!(message.to_lowercase().contains("lock"), "got: {message}");
    assert!(
        message.to_lowercase().contains("restore again"),
        "the user must know what to do next: {message}"
    );
}
