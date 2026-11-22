//! Cross-connection concurrency regressions (ticket 25).
//!
//! The bug these catch is application-wide head-of-line blocking: every
//! DB-viewer command used to take the one process-wide pool registry mutex and
//! hold it for the *whole* operation (`client.query(..).await`, a streaming
//! export, a schema read). A slow query or export on one connection therefore
//! stalled every other connection and tab, and nothing else could even start
//! until it finished.
//!
//! Every test here pins the timing deterministically instead of racing a
//! wall-clock budget: the "slow" operation calls a SQLite scalar function
//! registered by the test that blocks inside SQLite until the test releases it.
//! A gated query is long for exactly as long as the test says, on any machine.
//!
//! Under the old design each of these fails by never being able to start the
//! second connection's command; the generous `TIMEOUT` only turns that hang
//! into a clear assertion failure.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex as StdMutex};
use std::time::Duration;

use crate::db::pool::{ConnectionPoolManager, DbHandle};

/// Upper bound for anything that must NOT wait for the slow operation. It is
/// deliberately far larger than the work involved (a handful of in-memory
/// statements), so a loaded machine cannot make a correct implementation fail.
const TIMEOUT: Duration = Duration::from_secs(20);

/// How long a correct implementation is allowed to take to *start* the gated
/// query before the test gives up.
const STARTUP: Duration = Duration::from_secs(20);

// ---------------------------------------------------------------------------
// Deterministic gating: a SQL function that blocks inside SQLite
// ---------------------------------------------------------------------------

/// One-way gate shared with the `block_until_released()` SQL function.
#[derive(Default)]
struct Gate {
    opened: StdMutex<bool>,
    released: Condvar,
    /// Set by the SQL function as it starts waiting, so the test knows the
    /// query is really executing (not merely queued behind a lock).
    entered: AtomicBool,
}

impl Gate {
    /// Called from inside SQLite: block here until the test releases the gate.
    fn wait(&self) {
        self.entered.store(true, Ordering::SeqCst);
        let mut opened = self.opened.lock().unwrap();
        while !*opened {
            let (guard, _) = self
                .released
                .wait_timeout(opened, Duration::from_secs(60))
                .unwrap();
            opened = guard;
        }
    }

    fn release(&self) {
        *self.opened.lock().unwrap() = true;
        self.released.notify_all();
    }

    fn has_entered(&self) -> bool {
        self.entered.load(Ordering::SeqCst)
    }
}

/// Wait until the gated query is executing, so "connection B ran while A was
/// blocked" is a fact rather than a hope.
async fn await_entered(gate: &Gate) {
    let deadline = std::time::Instant::now() + STARTUP;
    while !gate.has_entered() {
        assert!(
            std::time::Instant::now() < deadline,
            "the gated query never started; the connection was not reachable"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

/// A SQLite connection with the `block()` gate function registered.
fn gated_sqlite(gate: Arc<Gate>, seed: &str) -> DbHandle {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.create_scalar_function(
        "block",
        0,
        rusqlite::functions::FunctionFlags::default(),
        move |_ctx| {
            gate.wait();
            Ok(1i64)
        },
    )
    .expect("register block()");
    conn.execute_batch(seed).expect("seed fixture");
    DbHandle::Sqlite(conn)
}

/// Two independent SQLite connections in one pool, each with its own gate.
fn two_connection_pool(seed: &str) -> (tokio::sync::Mutex<ConnectionPoolManager>, Vec<Arc<Gate>>) {
    let gates: Vec<Arc<Gate>> = vec![Arc::default(), Arc::default()];
    let mut manager = ConnectionPoolManager::new();
    manager.register("conn-a", gated_sqlite(gates[0].clone(), seed));
    manager.register("conn-b", gated_sqlite(gates[1].clone(), seed));
    (tokio::sync::Mutex::new(manager), gates)
}

/// A store with just enough schema for query history writes.
fn test_store() -> StdMutex<crate::store::Store> {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory store");
    crate::store::migrations::run_migrations(&conn).expect("migrate");
    for id in ["conn-a", "conn-b"] {
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at)
             VALUES (?1, ?1, 'sqlite', ':memory:', NULL, datetime('now'), datetime('now'))",
            [id],
        )
        .expect("placeholder connection");
    }
    StdMutex::new(crate::store::Store::from_connection(conn))
}

const ORDERS: &str = "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER NOT NULL);
     INSERT INTO orders (id, qty) VALUES (1, 10), (2, 20), (3, 30);";

// ---------------------------------------------------------------------------
// Criterion: a slow query on one connection does not block another
// connection's commands
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_query_on_one_connection_does_not_block_another_connections_edit() {
    use crate::commands::query::execute_query_inner;
    use crate::models::db_viewer::Change;

    let (pool, gates) = two_connection_pool(ORDERS);
    let pool = Arc::new(pool);
    let store = Arc::new(test_store());
    let registry = Arc::new(crate::cancel::CancelRegistry::new());
    let a_running = Arc::new(AtomicBool::new(true));

    // Connection A: a query that blocks inside SQLite until the gate opens.
    let a = {
        let pool = pool.clone();
        let store = store.clone();
        let registry = registry.clone();
        let running = a_running.clone();
        tokio::spawn(async move {
            // Today's command layer: take the process-wide registry lock and
            // hold it for the whole query.
            let mut pm = pool.lock().await;
            let result =
                execute_query_inner(&mut pm, &store, &registry, "conn-a", "SELECT block()", 1, 50)
                    .await;
            running.store(false, Ordering::SeqCst);
            result
        })
    };

    await_entered(&gates[0]).await;

    // Connection B: an ordinary row edit, while A is still inside its query.
    let change = Change::Update {
        id: "ch-1".into(),
        schema: "main".into(),
        table: "orders".into(),
        primary_key: r#"{"id":2}"#.into(),
        old_data: r#"{"qty":20}"#.into(),
        new_data: r#"{"qty":99}"#.into(),
    };
    let edit = tokio::time::timeout(
        TIMEOUT,
        crate::commands::db_viewer::execute_change_inner(&pool, "conn-b", change),
    )
    .await;
    let a_was_running = a_running.load(Ordering::SeqCst);

    gates[0].release();
    let a_result = a.await.expect("connection A task");
    gates[1].release();

    assert!(
        a_was_running,
        "connection B's edit must not wait for connection A's slow query"
    );
    assert!(
        edit.is_ok(),
        "connection B's edit must complete while connection A is blocked"
    );
    edit.unwrap().expect("connection B's edit applies");

    let a_result = a_result.expect("connection A's query completes once released");
    assert_eq!(a_result.columns.len(), 1, "A returned its own result");

    // The edit really landed on B (and A's transaction was untouched).
    let rows = {
        let mut pm = pool.lock().await;
        execute_query_inner(
            &mut pm,
            &store,
            &registry,
            "conn-b",
            "SELECT qty FROM orders WHERE id = 2",
            1,
            50,
        )
        .await
        .expect("read back on B succeeds")
    };
    assert_eq!(rows.rows[0][0], serde_json::json!(99));
}
