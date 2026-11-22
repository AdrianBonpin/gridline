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

use crate::cancel::CancelRegistry;
use crate::commands::query::{cancel_query_inner, execute_query_inner};
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

/// One-way gate shared with the `block()` SQL function.
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

const ORDERS: &str = "CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER NOT NULL);
     INSERT INTO orders (id, qty) VALUES (1, 10), (2, 20), (3, 30);";

/// Two independent SQLite connections in one pool, plus their cancellation
/// registry — the same shape `AppState` gives the commands.
struct Fixture {
    pool: tokio::sync::Mutex<ConnectionPoolManager>,
    gates: Vec<Arc<Gate>>,
    registry: CancelRegistry,
    store: StdMutex<crate::store::Store>,
}

impl Fixture {
    fn new(seed: &str) -> Self {
        let gates: Vec<Arc<Gate>> = vec![Arc::default(), Arc::default()];
        let registry = CancelRegistry::new();
        let mut manager = ConnectionPoolManager::new();
        for (id, gate) in [("conn-a", &gates[0]), ("conn-b", &gates[1])] {
            let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
            let interrupt = conn.get_interrupt_handle();
            let gate = gate.clone();
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
            manager.register(id, DbHandle::sqlite(conn));
            registry.set_sqlite(id, crate::cancel::SqliteCancel::new(interrupt));
        }
        Self {
            pool: tokio::sync::Mutex::new(manager),
            gates,
            registry,
            store: test_store(),
        }
    }
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

/// Spawn the gated query on connection `id`; returns the task and the flag it
/// clears when the query returns.
fn spawn_gated(
    pool: &Arc<tokio::sync::Mutex<ConnectionPoolManager>>,
    store: &Arc<StdMutex<crate::store::Store>>,
    registry: &Arc<CancelRegistry>,
    id: &str,
) -> (
    tokio::task::JoinHandle<Result<crate::models::db_viewer::QueryResult, String>>,
    Arc<AtomicBool>,
) {
    let pool = pool.clone();
    let store = store.clone();
    let registry = registry.clone();
    let id = id.to_string();
    let running = Arc::new(AtomicBool::new(true));
    let flag = running.clone();
    let task = tokio::spawn(async move {
        let result =
            execute_query_inner(&pool, &store, &registry, &id, "SELECT block()", 1, 50).await;
        running.store(false, Ordering::SeqCst);
        result
    });
    (task, flag)
}

// ---------------------------------------------------------------------------
// Criterion: a slow query on one connection does not block another
// connection's commands
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_query_on_one_connection_does_not_block_another_connections_edit() {
    use crate::models::db_viewer::Change;

    let fixture = Fixture::new(ORDERS);
    let pool = Arc::new(fixture.pool);
    let store = Arc::new(fixture.store);
    let registry = Arc::new(fixture.registry);

    let (a, a_running) = spawn_gated(&pool, &store, &registry, "conn-a");
    await_entered(&fixture.gates[0]).await;

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

    fixture.gates[0].release();
    let a_result = a.await.expect("connection A task");

    assert!(
        a_was_running,
        "connection B's edit must not wait for connection A's slow query"
    );
    assert!(
        edit.is_ok(),
        "connection B's edit must complete while connection A is blocked"
    );
    edit.unwrap().expect("connection B's edit applies");
    a_result
        .expect("connection A's query completes once released")
        .columns
        .len()
        .eq(&1)
        .then_some(())
        .expect("A returned its own result");

    // The edit really landed on B.
    let rows = execute_query_inner(
        &pool,
        &store,
        &registry,
        "conn-b",
        "SELECT qty FROM orders WHERE id = 2",
        1,
        50,
    )
    .await
    .expect("read back on B succeeds");
    assert_eq!(rows.rows[0][0], serde_json::json!(99));
}

// ---------------------------------------------------------------------------
// Criterion: a long-running export on one connection does not block browsing
// or editing on another
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn slow_export_on_one_connection_does_not_block_browsing_another() {
    use crate::commands::query_export::{export_query_inner, ExportFormat};

    let fixture = Fixture::new(ORDERS);
    let pool = Arc::new(fixture.pool);
    let registry = Arc::new(fixture.registry);

    let path =
        std::env::temp_dir().join(format!("gridline-t25-export-{}.csv", uuid::Uuid::new_v4()));
    let mut progress = |_rows: u64| {};

    // Connection A: a streaming export that blocks inside its first row.
    let running = Arc::new(AtomicBool::new(true));
    let a = {
        let pool = pool.clone();
        let registry = registry.clone();
        let path = path.clone();
        let running = running.clone();
        tokio::spawn(async move {
            let result = export_query_inner(
                &pool,
                &registry,
                "conn-a",
                "SELECT block() AS v FROM orders",
                ExportFormat::Csv,
                &path,
                &mut progress,
            )
            .await;
            running.store(false, Ordering::SeqCst);
            result
        })
    };
    await_entered(&fixture.gates[0]).await;

    // Connection B: browse a table, mid-export.
    let browse = tokio::time::timeout(
        TIMEOUT,
        crate::commands::db_viewer::get_table_data_inner(
            &pool, "conn-b", "main", "orders", None, None, None, None,
        ),
    )
    .await;
    let a_was_running = running.load(Ordering::SeqCst);

    fixture.gates[0].release();
    let exported = a.await.expect("export task");

    assert!(
        a_was_running,
        "browsing must not wait for another connection's export"
    );
    assert!(
        browse.is_ok(),
        "browsing connection B must complete while connection A exports"
    );
    let browsed = browse.unwrap().expect("browse succeeds");
    assert_eq!(browsed.rows.len(), 3, "connection B saw its own three rows");

    let summary = exported.expect("the export completes once released");
    assert_eq!(summary.rows_written, 3);
    let written = std::fs::read_to_string(&path).expect("export file exists");
    assert_eq!(
        written.lines().count(),
        4,
        "header plus three exported rows"
    );
    let _ = std::fs::remove_file(&path);
}

// ---------------------------------------------------------------------------
// Criterion: cancellation remains available while a long operation runs
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cancellation_remains_available_while_a_long_query_runs() {
    let fixture = Fixture::new(ORDERS);
    let pool = Arc::new(fixture.pool);
    let store = Arc::new(fixture.store);
    let registry = Arc::new(fixture.registry);

    // A query that cannot finish on its own: 2e9 rows, and the anchor term
    // signals "started" before the recursion begins.
    let long_query = "WITH RECURSIVE c(x) AS (SELECT block() UNION ALL SELECT x + 1 FROM c WHERE x < 2000000000) SELECT count(*) AS n FROM c";
    let a = {
        let pool = pool.clone();
        let store = store.clone();
        let registry = registry.clone();
        tokio::spawn(async move {
            execute_query_inner(&pool, &store, &registry, "conn-a", long_query, 1, 50).await
        })
    };
    await_entered(&fixture.gates[0]).await;
    // Let the query leave the anchor term and start stepping rows.
    fixture.gates[0].release();
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Cancel must be deliverable while the query holds the connection.
    let cancelled = tokio::time::timeout(TIMEOUT, cancel_query_inner(&registry, "conn-a")).await;
    assert!(
        cancelled.is_ok(),
        "cancellation must not wait for the running operation"
    );
    cancelled.unwrap().expect("the cancel request is delivered");

    let result = tokio::time::timeout(TIMEOUT, a)
        .await
        .expect("the cancelled query returns promptly")
        .expect("query task");
    let error = result.expect_err("a cancelled query reports an error");
    assert!(
        error.to_lowercase().contains("interrupt") || error.to_lowercase().contains("cancel"),
        "the error must say the query was cancelled, got: {error}"
    );

    // The connection is usable again afterwards.
    let after = execute_query_inner(&pool, &store, &registry, "conn-a", "SELECT 1 AS one", 1, 50)
        .await
        .expect("the connection still works after a cancel");
    assert_eq!(after.rows[0][0], serde_json::json!(1));
}

// ---------------------------------------------------------------------------
// Criterion: same-connection serialization is limited to what the driver
// requires (rusqlite's `Connection` is not `Sync`), and it queues rather than
// failing or blocking other connections
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn same_connection_work_queues_while_other_connections_stay_usable() {
    let fixture = Fixture::new(ORDERS);
    let pool = Arc::new(fixture.pool);
    let store = Arc::new(fixture.store);
    let registry = Arc::new(fixture.registry);

    let (a1, _a1_running) = spawn_gated(&pool, &store, &registry, "conn-a");
    await_entered(&fixture.gates[0]).await;

    // A second request on the SAME connection: it must queue on the SQLite
    // handle (the driver allows one statement at a time) instead of failing.
    let a2 = {
        let pool = pool.clone();
        let store = store.clone();
        let registry = registry.clone();
        tokio::spawn(async move {
            execute_query_inner(
                &pool,
                &store,
                &registry,
                "conn-a",
                "SELECT qty FROM orders WHERE id = 1",
                1,
                50,
            )
            .await
        })
    };

    // A different connection is unaffected by both.
    let b = tokio::time::timeout(
        TIMEOUT,
        execute_query_inner(&pool, &store, &registry, "conn-b", "SELECT 1 AS one", 1, 50),
    )
    .await;
    assert!(
        b.is_ok(),
        "another connection stays usable while one connection is busy"
    );
    b.unwrap().expect("connection B's query succeeds");

    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !a2.is_finished(),
        "the second request on a busy connection waits for it"
    );

    fixture.gates[0].release();
    a1.await
        .expect("first query task")
        .expect("first query succeeds");
    let queued = tokio::time::timeout(TIMEOUT, a2)
        .await
        .expect("the queued request runs once the connection is free")
        .expect("queued query task")
        .expect("the queued query runs instead of reporting a missing connection");
    assert_eq!(queued.rows[0][0], serde_json::json!(10));
}
