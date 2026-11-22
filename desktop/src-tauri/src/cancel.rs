//! Per-connection cancellation handles, stored independently of the pool
//! lock so `cancel_query` can dispatch while a long query holds the pool mutex.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::InterruptHandle;
use sqlx::mysql::MySqlConnectOptions;
use tokio_postgres::CancelToken;

use crate::db::tls::TlsDecision;

/// PostgreSQL cancel data. `cancel_token` stores the socket address (incl.
/// SSH tunnel endpoint) so `cancel_query` needs no host. `tls_config` is the
/// rustls config used to **build** the connection (or `None` for NoTls) so the
/// cancel connection reuses the exact same TLS decision.
#[derive(Clone)]
pub struct PgCancel {
    pub cancel_token: CancelToken,
    pub tls_decision: TlsDecision,
    pub tls_config: Option<std::sync::Arc<rustls::ClientConfig>>,
}

/// MySQL cancel data. `conn_id` is the `CONNECTION_ID()` of the dedicated
/// connection currently running a query (one active per connection because the
/// pool lock serializes queries). `connect_options` lets `cancel` open a
/// brand-new connection (bypassing the pool) to run `KILL QUERY ?`.
#[derive(Clone)]
pub struct MySqlCancel {
    pub conn_id: Option<i64>,
    pub connect_options: MySqlConnectOptions,
}

/// SQLite cancel data — a cloneable, thread-safe interrupt handle.
/// (`InterruptHandle` itself is not `Clone` in rusqlite 0.31, so it's kept
/// behind an `Arc`.)
#[derive(Clone)]
pub struct SqliteCancel {
    handle: Arc<InterruptHandle>,
}

impl SqliteCancel {
    pub fn new(handle: InterruptHandle) -> Self {
        Self {
            handle: Arc::new(handle),
        }
    }
    pub fn interrupt(&self) {
        self.handle.interrupt();
    }
}

#[derive(Clone)]
pub enum CancelHandle {
    Pg(PgCancel),
    MySql(MySqlCancel),
    Sqlite(SqliteCancel),
}

/// Send + Sync registry keyed by connection id. `cancel_query` takes only
/// this `Mutex` (NOT the pool lock).
#[derive(Default)]
pub struct CancelRegistry {
    map: Mutex<HashMap<String, CancelHandle>>,
    /// Live "cancel requested" flags, keyed by connection id. `cancel_query`
    /// sets one for MySQL; long-running in-process operations (currently the
    /// native restore engine) poll it between statements and clear it when
    /// they finish. Kept in a separate map from the handles so it needs no
    /// `Clone` on the registry and survives handle replacement.
    flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CancelRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Take the handle registry lock, tolerating a poisoned mutex.
    ///
    /// Panicking here would be strictly worse than proceeding: every mutation
    /// is a single `insert`/`remove`/`get_mut` of an owned value, so a panic on
    /// another thread cannot leave either map half-updated, and there is no
    /// repair to perform. `cancel_query` runs precisely when a query is stuck —
    /// refusing to hand out the cancel handle because an unrelated thread
    /// panicked is the one failure mode this registry exists to avoid.
    fn lock_handles(&self) -> std::sync::MutexGuard<'_, HashMap<String, CancelHandle>> {
        self.map.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Take the cancel-flag registry lock, tolerating a poisoned mutex (see
    /// [`Self::lock_handles`]). The flags are atomics, so they are never left
    /// half-written by a panic either.
    fn lock_flags(&self) -> std::sync::MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.flags.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Get (or create) the cancellation flag for a connection. Polling callers
    /// should clear it before starting and after finishing.
    pub fn cancel_flag(&self, id: &str) -> Arc<AtomicBool> {
        self.lock_flags().entry(id.to_string()).or_default().clone()
    }

    /// Mark a connection as cancel-requested. Called by `cancel_query` before
    /// it sends the driver-specific cancel so in-process consumers observe the
    /// request even when the driver surfaces it as an unrecognized error.
    pub fn mark_cancelled(&self, id: &str) {
        self.cancel_flag(id).store(true, Ordering::SeqCst);
    }

    /// Whether a cancel has been requested for this connection.
    pub fn is_cancelled(&self, id: &str) -> bool {
        self.lock_flags()
            .get(id)
            .map(|f| f.load(Ordering::SeqCst))
            .unwrap_or(false)
    }

    /// Clear the cancel-requested flag for this connection.
    pub fn clear_cancelled(&self, id: &str) {
        if let Some(f) = self.lock_flags().get(id) {
            f.store(false, Ordering::SeqCst);
        }
    }

    pub fn set_pg(&self, id: &str, c: PgCancel) {
        self.set(id, CancelHandle::Pg(c));
    }
    pub fn set_mysql(&self, id: &str, c: MySqlCancel) {
        self.set(id, CancelHandle::MySql(c));
    }
    pub fn set_sqlite(&self, id: &str, c: SqliteCancel) {
        self.set(id, CancelHandle::Sqlite(c));
    }
    pub fn set_mysql_conn_id(&self, id: &str, conn_id: Option<i64>) {
        let mut g = self.lock_handles();
        if let Some(CancelHandle::MySql(m)) = g.get_mut(id) {
            m.conn_id = conn_id;
        }
    }
    /// Install a cancellation handle under `id`, replacing any previous one.
    /// Used by the connection lifecycle when a verified session is published.
    pub(crate) fn set(&self, id: &str, h: CancelHandle) {
        self.lock_handles().insert(id.to_string(), h);
    }
    pub fn get(&self, id: &str) -> Option<CancelHandle> {
        self.lock_handles().get(id).cloned()
    }
    pub fn remove(&self, id: &str) {
        self.lock_handles().remove(id);
    }

    /// Drop a connection's cancellation handle and clear its cancel-requested
    /// flag.
    ///
    /// This is the teardown path (`db_disconnect`, connection deletion, demo
    /// regeneration): the handle must not outlive the session it aborts, and a
    /// stale `true` flag must not make the next session look pre-cancelled. The
    /// flag entry itself is kept rather than removed, because a standalone
    /// operation that is already running (e.g. a native restore) holds that
    /// `Arc` and has to keep observing cancel requests until it finishes.
    pub fn forget(&self, id: &str) {
        self.remove(id);
        self.clear_cancelled(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_insert_and_drain() {
        let reg = CancelRegistry::new();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let handle = conn.get_interrupt_handle();
        reg.set_sqlite("c1", SqliteCancel::new(handle));
        assert!(matches!(reg.get("c1"), Some(CancelHandle::Sqlite(_))));
        reg.remove("c1");
        assert!(reg.get("c1").is_none());
    }

    #[test]
    fn sqlite_interrupt_aborts_running_query() {
        use std::sync::{Arc, Mutex};
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t(n); INSERT INTO t VALUES (0);")
            .unwrap();
        let handle = conn.get_interrupt_handle();
        let conn2 = Arc::new(Mutex::new(conn));
        let c = conn2.clone();
        let done = Arc::new(Mutex::new(None::<Result<usize, String>>));
        let d = done.clone();
        let worker = std::thread::spawn(move || {
            let l = c.lock().unwrap();
            // `query()` binds params only — the first sqlite3_step (where the
            // interrupt lands) happens in `rs.next()`, so errors must be
            // propagated with `?` rather than swallowed by `is_ok()`.
            let r = l
                .prepare("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 200000000) SELECT count(*) FROM c")
                .unwrap()
                .query([])
                .and_then(|mut rs| {
                    let mut n = 0;
                    while rs.next()?.is_some() {
                        n += 1;
                    }
                    Ok(n)
                });
            *d.lock().unwrap() = Some(r.map_err(|e| e.to_string()));
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        handle.interrupt();
        worker.join().unwrap();
        let outcome = done.lock().unwrap().clone();
        assert!(
            matches!(&outcome, Some(Err(e)) if e.to_lowercase().contains("interrupted")),
            "cancelled query must report interrupted; got {outcome:?}"
        );
    }

    #[test]
    fn mysql_overwrites_single_active_slot() {
        let reg = CancelRegistry::new();
        reg.set_mysql(
            "c1",
            MySqlCancel {
                conn_id: Some(1),
                connect_options: fake_opts(),
            },
        );
        reg.set_mysql(
            "c1",
            MySqlCancel {
                conn_id: Some(2),
                connect_options: fake_opts(),
            },
        );
        match reg.get("c1") {
            Some(CancelHandle::MySql(m)) => assert_eq!(m.conn_id, Some(2)),
            _ => panic!("expected MySql"),
        }
    }

    #[test]
    fn cancel_flag_is_tracked_per_connection() {
        let reg = CancelRegistry::new();
        assert!(!reg.is_cancelled("c1"));
        reg.mark_cancelled("c1");
        assert!(reg.is_cancelled("c1"));
        assert!(
            !reg.is_cancelled("c2"),
            "flag must not leak across connections"
        );
        reg.clear_cancelled("c1");
        assert!(!reg.is_cancelled("c1"));
        // The same Arc is shared between getter and setter.
        let flag = reg.cancel_flag("c1");
        reg.mark_cancelled("c1");
        assert!(flag.load(Ordering::SeqCst));
    }

    fn fake_opts() -> sqlx::mysql::MySqlConnectOptions {
        sqlx::mysql::MySqlConnectOptions::new()
            .host("127.0.0.1")
            .port(1)
            .username("u")
            .password("p")
            .database("d")
    }

    #[test]
    fn forget_drops_the_handle_and_clears_the_flag() {
        let reg = CancelRegistry::new();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        reg.set_sqlite("c1", SqliteCancel::new(conn.get_interrupt_handle()));
        reg.mark_cancelled("c1");
        // A running operation may already hold this flag; teardown has to clear
        // the value it observes, not just drop the map entry.
        let observed = reg.cancel_flag("c1");

        reg.forget("c1");

        assert!(reg.get("c1").is_none(), "the handle is gone");
        assert!(
            !reg.is_cancelled("c1"),
            "a torn-down connection leaves no cancel-requested flag behind"
        );
        assert!(
            !observed.load(Ordering::SeqCst),
            "an operation already holding the flag sees it cleared, not stuck cancelled"
        );
        drop(conn);
    }
}
