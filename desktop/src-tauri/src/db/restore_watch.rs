//! Lock-wait watchdog for a PostgreSQL restore.
//!
//! A restore is the one managed job whose *useful* work can be silent for a long
//! time: `pg_restore` prints nothing outside `--verbose`, and a single large
//! `COPY` can take an hour without a word. That is why the restore is exempt from
//! the idle bound in [`crate::job`] — a quiet restore is indistinguishable from a
//! hung one by output alone, and the ticket forbids an arbitrary total-duration
//! cap (a healthy large restore must never be killed).
//!
//! The one wait that genuinely has no end is a **lock wait**: a restore blocked
//! behind another session's open transaction waits until that session commits,
//! which can be never. A server-side `lock_timeout` would bound it, but a dump
//! cannot be talked out of the session it sets up: both `pg_dump`'s plain format
//! and its archives carry
//!
//! ```sql
//! SET statement_timeout = 0;
//! SET lock_timeout = 0;
//! SET idle_in_transaction_session_timeout = 0;
//! ```
//!
//! and `pg_restore` executes those items before any object, so `PGOPTIONS` is
//! overridden (verified: a dump restoring into a lock-blocked table ignores
//! `PGOPTIONS="-c lock_timeout=3000"` and waits for the lock to be released).
//!
//! So the bound is applied from outside instead: the restore child connects with
//! a recognizable `application_name`, and this watchdog samples the server for
//! that backend. **Only** a backend that has been *continuously* waiting on a
//! heavyweight lock for [`DEFAULT_LOCK_WAIT_DEADLINE`] is terminated — a slow
//! `COPY`, a long `ALTER TABLE` or a slow client never is, because they are not
//! waiting on a lock at all. It bounds the wait, never the work.
//!
//! The decision logic here is pure and unit-tested; the SQL plumbing lives in
//! `commands::backup`.

use std::time::{Duration, Instant};

/// How long a restore may sit in a lock wait before it is stopped.
///
/// Deliberately generous: a restore legitimately waits for the locks another
/// session holds, and a busy database can hold one for tens of seconds. It is a
/// bound on *waiting*, so a value this size can only be reached by a session that
/// is not going to finish on its own — and the failure names the wait, so the
/// user can end the blocking session and retry.
pub const DEFAULT_LOCK_WAIT_DEADLINE: Duration = Duration::from_secs(60);

/// How often the watchdog samples the restore's backend.
pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

/// Prefix of the `application_name` a restore child connects with.
pub const RESTORE_APP_PREFIX: &str = "gridline-restore-";

/// The `application_name` for a restore job's connection.
///
/// Set on the child as `PGAPPNAME`, so the watchdog can find *its* backend in
/// `pg_stat_activity` without guessing: the app may hold several connections to
/// the same database, and terminating the wrong one would kill a user query.
pub fn restore_application_name(job_id: &str) -> String {
    format!("{RESTORE_APP_PREFIX}{job_id}")
}

/// One sample of the restore's backend, as read from `pg_stat_activity`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockSample {
    /// The backend is not visible — not connected yet, already finished, or the
    /// sample itself failed. Never treats a blind sample as progress *or* as a
    /// stall.
    NotSeen,
    /// Visible and working: running a statement that is not waiting for a lock
    /// (a `COPY`, an `ALTER TABLE`, …).
    Running { pid: i32 },
    /// Visible and blocked on a heavyweight lock.
    WaitingForLock { pid: i32 },
}

/// What the watchdog should do after a sample.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchDecision {
    /// Nothing to do.
    Continue,
    /// Terminate this backend: it has been continuously blocked for the deadline.
    Stop { pid: i32, waited: Duration },
}

/// Tracks how long one backend has been continuously blocked on a lock.
///
/// Any other sample — progress, a different pid, or a blind sample — resets the
/// clock, so only an *uninterrupted* lock wait can reach the deadline. A restore
/// that makes progress between waits is never accumulated into a false stall.
#[derive(Debug)]
pub struct LockWatch {
    deadline: Duration,
    blocked: Option<(i32, Instant)>,
}

impl LockWatch {
    pub fn new(deadline: Duration) -> Self {
        Self {
            deadline,
            blocked: None,
        }
    }

    pub fn deadline(&self) -> Duration {
        self.deadline
    }

    pub fn observe(&mut self, now: Instant, sample: LockSample) -> WatchDecision {
        match sample {
            LockSample::WaitingForLock { pid } => match self.blocked {
                Some((tracked, since)) if tracked == pid => {
                    let waited = now.saturating_duration_since(since);
                    if waited >= self.deadline {
                        WatchDecision::Stop { pid, waited }
                    } else {
                        WatchDecision::Continue
                    }
                }
                // First sample of a wait: start the clock.
                _ => {
                    self.blocked = Some((pid, now));
                    WatchDecision::Continue
                }
            },
            LockSample::Running { .. } | LockSample::NotSeen => {
                self.blocked = None;
                WatchDecision::Continue
            }
        }
    }
}

/// The failure a stopped restore reports, so the user is told *why* it stopped
/// instead of seeing a raw "terminating connection due to administrator command".
pub fn lock_wait_stop_message(waited: Duration) -> String {
    format!(
        "Restore stopped after waiting {}s for a database lock — another session is holding it. \
         End the blocking session (or wait for it to finish) and restore again.",
        waited.as_secs().max(1)
    )
}

/// Find the restore backend's pid and whether it is waiting on a lock.
///
/// `application_name` is a parameter (never interpolated), so a job id can never
/// become SQL.
pub const RESTORE_BACKEND_SQL: &str = "SELECT pid, (wait_event_type = 'Lock') AS waiting_on_lock \
     FROM pg_stat_activity WHERE application_name = $1 ORDER BY pid";

/// Terminate the backend that has been blocked for the deadline.
///
/// `pg_terminate_backend` (not `pg_cancel_backend`): cancelling the current
/// statement would let `pg_restore` continue to the next object, which would
/// immediately queue for the same lock. Terminating ends the restore with a
/// visible failure instead of a loop of cancellations.
pub const TERMINATE_BACKEND_SQL: &str = "SELECT pg_terminate_backend($1)";

#[cfg(test)]
#[path = "restore_watch.test.rs"]
mod restore_watch_tests;
