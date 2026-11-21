use crate::db::pool::{ConnectionPoolManager, DbHandle};

#[test]
fn hypertables_query_targets_timescale_information_schema() {
    let q = crate::db::introspection::pg_hypertables_query("public");
    assert!(q.contains("timescaledb_information.hypertables"));
    assert!(q.contains("hypertable_schema = $1"));
    assert!(q.contains("timescaledb_information.chunks"));
}

#[test]
fn timescale_detect_query_checks_pg_extension() {
    let q = crate::db::introspection::pg_timescale_detect_query();
    assert!(q.contains("pg_extension"));
    assert!(q.contains("'timescaledb'"));
}

#[test]
fn hypertable_response_degrades_gracefully() {
    let resp = crate::models::db_viewer::HypertableListResponse {
        available: false,
        reason: Some("TimescaleDB extension is not installed".into()),
        items: vec![],
    };
    let json = serde_json::to_string(&resp).expect("serializes");
    assert!(json.contains("\"available\":false"));
}

/// Live test. On a plain PostgreSQL connection (no TimescaleDB) the detection
/// helper must report `available: false`, never an error. Follows the exact
/// env-var + client-construction convention used by the live PG tests in
/// `commands/objects.test.rs`.
#[tokio::test]
#[ignore]
async fn hypertables_unavailable_on_plain_pg() {
    let h = std::env::var("GRIDLINE_TEST_PG_HOST").expect("set GRIDLINE_TEST_PG_HOST");
    let p: u16 = std::env::var("GRIDLINE_TEST_PG_PORT")
        .unwrap_or_else(|_| "5432".into())
        .parse()
        .unwrap();
    let u = std::env::var("GRIDLINE_TEST_PG_USER").expect("set GRIDLINE_TEST_PG_USER");
    let d = std::env::var("GRIDLINE_TEST_PG_DB").expect("set GRIDLINE_TEST_PG_DB");
    let pw = std::env::var("GRIDLINE_TEST_PG_PASSWORD").unwrap_or_default();
    let (client, conn) = tokio_postgres::connect(
        &format!("host={h} port={p} user={u} dbname={d} password={pw}"),
        tokio_postgres::NoTls,
    )
    .await
    .expect("connect to test PG");
    let handle = tokio::spawn(async move {
        let _ = conn.await;
    });
    let mut pm = ConnectionPoolManager::new();
    let id = "test-pg".to_string();
    pm.register(&id, DbHandle::Postgresql(client, handle));
    let pm = tokio::sync::Mutex::new(pm);

    // Exercise the detection helper directly (the command needs `State`, which
    // is not constructible in tests).
    let detected = {
        let mut g = pm.lock().await;
        match g.get(&id) {
            Some(DbHandle::Postgresql(c, _)) => {
                c.query_one(&crate::db::introspection::pg_timescale_detect_query(), &[])
                    .await
            }
            _ => panic!("expected a postgresql handle"),
        }
    };
    assert!(detected.is_ok(), "detection query must run on plain PG");
    let available: bool = detected.unwrap().get(0);
    assert!(!available, "plain PG must report available=false");
}

// ---------------------------------------------------------------------------
// Change-application seam: Row Identity addressing
//
// The viewer seam catches how identity is built while staging; these tests
// catch what the queued change actually addresses when it is applied. They run
// the real `execute_change_inner` path against a real (temporary) SQLite
// database, and — env-gated — against a live PostgreSQL server.
// ---------------------------------------------------------------------------

use crate::commands::db_viewer::{execute_change_inner, get_table_data_inner};
use crate::models::db_viewer::Change;
use rusqlite::types::Value;

/// The demo `order_items` shape: a composite primary key whose rows share
/// `order_id` and differ only by `product_id`, plus a second order.
const COMPOSITE_PK_FIXTURE: &str = r#"
CREATE TABLE order_items (
    order_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price REAL NOT NULL,
    PRIMARY KEY (order_id, product_id)
);
INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
    (1, 1, 2, 10.0),
    (1, 3, 1, 5.0),
    (2, 1, 4, 7.5);
"#;

/// The demo `page_views` shape: deliberately no primary key, so the only way to
/// address a row is the backend's `rowid` locator.
const NO_PK_FIXTURE: &str = r#"
CREATE TABLE page_views (
    url        TEXT NOT NULL,
    session_id TEXT NOT NULL,
    user_agent TEXT
);
INSERT INTO page_views (url, session_id, user_agent) VALUES
    ('/products', 'sess-001', 'agent-a'),
    ('/cart',     'sess-002', 'agent-b'),
    ('/orders',   'sess-003', 'agent-c');
"#;

fn sqlite_pool(setup_sql: &str) -> (tokio::sync::Mutex<ConnectionPoolManager>, String) {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch(setup_sql).expect("fixture schema + seed");
    let mut pm = ConnectionPoolManager::new();
    pm.register("sqlite-change", DbHandle::Sqlite(conn));
    (tokio::sync::Mutex::new(pm), "sqlite-change".to_string())
}

fn sqlite_query(pm: &mut ConnectionPoolManager, id: &str, sql: &str) -> Vec<Vec<Value>> {
    match pm.get(id) {
        Some(DbHandle::Sqlite(conn)) => {
            let mut stmt = conn.prepare(sql).expect("prepare");
            let width = stmt.column_count();
            let mut rows = stmt.query([]).expect("query");
            let mut out = Vec::new();
            while let Some(row) = rows.next().expect("next row") {
                out.push(
                    (0..width)
                        .map(|i| row.get::<_, Value>(i).expect("cell"))
                        .collect(),
                );
            }
            out
        }
        _ => panic!("expected a sqlite handle"),
    }
}

fn int(v: i64) -> Value {
    Value::Integer(v)
}

#[tokio::test]
async fn composite_key_update_changes_exactly_one_row() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    // Row Identity = every primary-key column of the row: (order_id, product_id).
    let change = Change::Update {
        id: "ch-1".into(),
        schema: "main".into(),
        table: "order_items".into(),
        primary_key: r#"{"order_id":1,"product_id":3}"#.into(),
        old_data: r#"{"quantity":1}"#.into(),
        new_data: r#"{"quantity":9}"#.into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("update applies");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(
        &mut guard,
        &id,
        "SELECT order_id, product_id, quantity FROM order_items ORDER BY order_id, product_id",
    );
    // The sibling row that shares order_id=1 is untouched; so is order 2.
    assert_eq!(
        rows,
        vec![
            vec![int(1), int(1), int(2)],
            vec![int(1), int(3), int(9)],
            vec![int(2), int(1), int(4)],
        ]
    );
}

#[tokio::test]
async fn composite_key_delete_removes_exactly_one_row() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    let change = Change::Delete {
        id: "ch-2".into(),
        schema: "main".into(),
        table: "order_items".into(),
        primary_key: r#"{"order_id":1,"product_id":1}"#.into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("delete applies");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(
        &mut guard,
        &id,
        "SELECT order_id, product_id FROM order_items ORDER BY order_id, product_id",
    );
    // Exactly one row removed: the sibling (1,3) survives.
    assert_eq!(rows, vec![vec![int(1), int(3)], vec![int(2), int(1)]]);
}

#[tokio::test]
async fn partial_composite_key_is_rejected_as_ambiguous() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    // A single-key predicate would address both order_id=1 rows. The engine must
    // never silently treat that as success.
    let change = Change::Delete {
        id: "ch-3".into(),
        schema: "main".into(),
        table: "order_items".into(),
        primary_key: r#"{"order_id":1}"#.into(),
    };
    let err = execute_change_inner(&pm, &id, change)
        .await
        .expect_err("an ambiguous match must fail");
    assert!(
        err.contains("ambiguous row match"),
        "expected an ambiguous-match error, got: {err}"
    );
}

#[tokio::test]
async fn no_pk_update_by_rowid_changes_only_that_row() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    let change = Change::Update {
        id: "ch-4".into(),
        schema: "main".into(),
        table: "page_views".into(),
        primary_key: r#"{"rowid":2}"#.into(),
        old_data: r#"{"session_id":"sess-002"}"#.into(),
        new_data: r#"{"session_id":"sess-b-2"}"#.into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("update applies");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(
        &mut guard,
        &id,
        "SELECT url, session_id FROM page_views ORDER BY rowid",
    );
    assert_eq!(
        rows,
        vec![
            vec![
                Value::Text("/products".into()),
                Value::Text("sess-001".into())
            ],
            vec![Value::Text("/cart".into()), Value::Text("sess-b-2".into())],
            vec![
                Value::Text("/orders".into()),
                Value::Text("sess-003".into())
            ],
        ]
    );
}

#[tokio::test]
async fn no_pk_delete_by_rowid_removes_only_that_row() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    let change = Change::Delete {
        id: "ch-5".into(),
        schema: "main".into(),
        table: "page_views".into(),
        primary_key: r#"{"rowid":2}"#.into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("delete applies");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(&mut guard, &id, "SELECT url FROM page_views ORDER BY rowid");
    assert_eq!(
        rows,
        vec![
            vec![Value::Text("/products".into())],
            vec![Value::Text("/orders".into())],
        ]
    );
}

// ---------------------------------------------------------------------------
// Live PostgreSQL: composite-key identity and the physical `ctid` locator
// ---------------------------------------------------------------------------

/// Connect to the opt-in live PostgreSQL server described by the
/// `GRIDLINE_TEST_PG_*` variables and register it in a pool manager.
async fn live_pg_pool() -> (tokio::sync::Mutex<ConnectionPoolManager>, String) {
    let h = std::env::var("GRIDLINE_TEST_PG_HOST").expect("set GRIDLINE_TEST_PG_HOST");
    let p: u16 = std::env::var("GRIDLINE_TEST_PG_PORT")
        .unwrap_or_else(|_| "5432".into())
        .parse()
        .unwrap();
    let u = std::env::var("GRIDLINE_TEST_PG_USER").expect("set GRIDLINE_TEST_PG_USER");
    let d = std::env::var("GRIDLINE_TEST_PG_DB").expect("set GRIDLINE_TEST_PG_DB");
    let pw = std::env::var("GRIDLINE_TEST_PG_PASSWORD").unwrap_or_default();
    // Built field by field: an empty `password=` inside a config string is a
    // parse error, and passwordless (trust/peer) servers are the common case.
    let mut config = tokio_postgres::Config::new();
    config.host(&h).port(p).user(&u).dbname(&d);
    if !pw.is_empty() {
        config.password(&pw);
    }
    let (client, conn) = config
        .connect(tokio_postgres::NoTls)
        .await
        .expect("connect to test PG");
    let handle = tokio::spawn(async move {
        let _ = conn.await;
    });
    let mut pm = ConnectionPoolManager::new();
    pm.register(
        "test-pg-row-identity",
        DbHandle::Postgresql(client, handle),
    );
    (
        tokio::sync::Mutex::new(pm),
        "test-pg-row-identity".to_string(),
    )
}

/// Run setup/cleanup SQL (possibly several statements) on the live handle.
async fn pg_execute(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    id: &str,
    sql: &str,
) -> Result<(), String> {
    let mut guard = pm.lock().await;
    match guard.get(id) {
        Some(DbHandle::Postgresql(c, _)) => c
            .batch_execute(sql)
            .await
            .map_err(|e| format!("{e:?}")),
        _ => panic!("expected a postgresql handle"),
    }
}

async fn pg_rows(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    id: &str,
    sql: &str,
) -> Vec<Vec<String>> {
    // Raw SQL kept simple by casting every cell to text: the assertions only
    // compare values, not PostgreSQL types.
    let mut guard = pm.lock().await;
    match guard.get(id) {
        Some(DbHandle::Postgresql(c, _)) => {
            let rows = c.query(sql, &[]).await.expect("query");
            rows.iter()
                .map(|r| {
                    (0..r.len())
                        .map(|i| {
                            r.try_get::<_, Option<String>>(i)
                                .ok()
                                .flatten()
                                .unwrap_or_else(|| "<non-text>".into())
                        })
                        .collect()
                })
                .collect()
        }
        _ => panic!("expected a postgresql handle"),
    }
}

/// Live test (opt-in): a composite-key update addresses exactly one row, and a
/// no-PK row is addressed through the selected `ctid::text` locator.
///
/// This is the end-to-end proof that the locator actually survives decoding and
/// that PostgreSQL parses it back into a `tid` for the UPDATE/DELETE predicate.
#[tokio::test]
#[ignore]
async fn live_pg_row_identity_addresses_exactly_one_row() {
    let (pm, id) = live_pg_pool().await;
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let composite = format!("gridline_t02_composite_{suffix}");
    let no_pk = format!("gridline_t02_nopk_{suffix}");

    pg_execute(
        &pm,
        &id,
        &format!(
            "CREATE TABLE public.\"{composite}\" (order_id int NOT NULL, product_id int NOT NULL, \
             quantity int NOT NULL, PRIMARY KEY (order_id, product_id)); \
             INSERT INTO public.\"{composite}\" VALUES (1, 1, 2), (1, 3, 1); \
             CREATE TABLE public.\"{no_pk}\" (url text NOT NULL); \
             INSERT INTO public.\"{no_pk}\" VALUES ('/products'), ('/cart'), ('/orders')"
        ),
    )
    .await
    .expect("fixture tables");

    // ── composite key ───────────────────────────────────────────────────
    execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-pg-1".into(),
            schema: "public".into(),
            table: composite.clone(),
            primary_key: r#"{"order_id":1,"product_id":3}"#.into(),
            old_data: r#"{"quantity":1}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect("composite-key update applies");
    let rows = pg_rows(
        &pm,
        &id,
        &format!("SELECT order_id::text || ':' || product_id::text || ':' || quantity::text FROM public.\"{composite}\" ORDER BY order_id, product_id"),
    )
    .await;
    assert_eq!(rows, vec![vec!["1:1:2".to_string()], vec!["1:3:9".to_string()]]);

    // ── no primary key: the locator must be a real value, not NULL ───────
    let data = get_table_data_inner(&pm, &id, "public", &no_pk, None, None, None, None)
        .await
        .expect("no-PK data fetch");
    assert_eq!(data.columns.len(), 1, "only the declared column is a column");
    let locator = data.rows[1][data.columns.len()].clone();
    let locator = locator.as_str().expect("ctid must decode as text, not NULL");
    assert!(
        locator.starts_with('(') && locator.ends_with(')'),
        "expected a textual ctid, got: {locator}"
    );

    execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-pg-2".into(),
            schema: "public".into(),
            table: no_pk.clone(),
            primary_key: format!(r#"{{"ctid":"{}"}}"#, locator),
            old_data: r#"{"url":"/cart"}"#.into(),
            new_data: r#"{"url":"/cart-v2"}"#.into(),
        },
    )
    .await
    .expect("locator update applies");
    let rows = pg_rows(&pm, &id, &format!("SELECT url FROM public.\"{no_pk}\" ORDER BY url")).await;
    assert_eq!(
        rows,
        vec![
            vec!["/cart-v2".to_string()],
            vec!["/orders".to_string()],
            vec!["/products".to_string()],
        ]
    );

    // ── no primary key: delete addresses exactly the displayed row ───────
    // PostgreSQL rewrites an updated row at a new physical location, so the
    // displayed row's locator is re-read the way the grid would after a refresh
    // (keeping a stale locator honest is a separate safeguard).
    let data = get_table_data_inner(&pm, &id, "public", &no_pk, None, None, None, None)
        .await
        .expect("no-PK data refetch");
    let cart_index = data
        .rows
        .iter()
        .position(|row| row[0] == serde_json::Value::String("/cart-v2".into()))
        .expect("updated row is still present");
    let fresh_locator = data.rows[cart_index][data.columns.len()]
        .as_str()
        .expect("ctid must decode as text")
        .to_string();
    execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-pg-3".into(),
            schema: "public".into(),
            table: no_pk.clone(),
            primary_key: format!(r#"{{"ctid":"{}"}}"#, fresh_locator),
        },
    )
    .await
    .expect("locator delete applies");
    let rows = pg_rows(&pm, &id, &format!("SELECT url FROM public.\"{no_pk}\" ORDER BY url")).await;
    assert_eq!(
        rows,
        vec![vec!["/orders".to_string()], vec!["/products".to_string()]]
    );

    pg_execute(
        &pm,
        &id,
        &format!(
            "DROP TABLE public.\"{composite}\"; DROP TABLE public.\"{no_pk}\""
        ),
    )
    .await
    .expect("cleanup");
}
