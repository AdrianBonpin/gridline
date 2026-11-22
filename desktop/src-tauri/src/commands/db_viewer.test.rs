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
    pm.register(&id, DbHandle::postgresql(client, handle));
    let pm = tokio::sync::Mutex::new(pm);

    // Exercise the detection helper directly (the command needs `State`, which
    // is not constructible in tests).
    let detected = {
        let (client, _task) = match pm.lock().await.acquire(&id) {
            Some(DbHandle::Postgresql(c, t)) => (c, t),
            _ => panic!("expected a postgresql handle"),
        };
        let client = client.lock().await;
        client
            .query_one(&crate::db::introspection::pg_timescale_detect_query(), &[])
            .await
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

use crate::commands::db_viewer::{
    execute_change_for_origin, execute_change_inner, execute_staged_change, get_table_data_inner,
};
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
    conn.execute_batch(setup_sql)
        .expect("fixture schema + seed");
    let mut pm = ConnectionPoolManager::new();
    pm.register("sqlite-change", DbHandle::sqlite(conn));
    (tokio::sync::Mutex::new(pm), "sqlite-change".to_string())
}

fn sqlite_query(pm: &mut ConnectionPoolManager, id: &str, sql: &str) -> Vec<Vec<Value>> {
    match pm.get(id) {
        Some(DbHandle::Sqlite(conn)) => {
            let conn = conn.try_lock().expect("sqlite connection free");
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
        old_data: r#"{"order_id":1,"product_id":1,"quantity":2}"#.into(),
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
        old_data: String::new(),
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
        // The grid stages the displayed row's values with its locator, so a
        // reused locator can never delete a different row (ticket 03).
        old_data: r#"{"url":"/cart","session_id":"sess-002","user_agent":"agent-b"}"#.into(),
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
// The backend is authoritative for the Change Origin (F3)
// ---------------------------------------------------------------------------

fn stored_sqlite_connection(id: &str, path: &str) -> crate::models::Connection {
    crate::models::Connection {
        id: id.to_string(),
        name: "Demo".to_string(),
        db_type: "sqlite".to_string(),
        host: path.to_string(),
        port: None,
        username: None,
        database: Some("main".to_string()),
        folder_id: None,
        keychain_ref: None,
        environment: None,
        favorite: false,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        tag_ids: Vec::new(),
        use_keychain: false,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
    }
}

fn origin_for(conn: &crate::models::Connection) -> crate::db::change_target::ChangeOrigin {
    crate::db::change_target::ChangeOrigin {
        connection_id: conn.id.clone(),
        database: "main".to_string(),
        target: crate::db::change_target::connection_target_fingerprint(conn),
        target_label: crate::db::change_target::describe_connection_target(conn),
    }
}

/// A staged change whose target no longer matches the saved connection is
/// refused by the backend itself (not just the renderer), and nothing is written.
#[tokio::test]
async fn the_backend_refuses_a_change_staged_against_a_retargeted_connection() {
    let (pm, id) = sqlite_pool("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);");
    let staged = stored_sqlite_connection(&id, "/tmp/app.db");
    let origin = origin_for(&staged);
    // The saved connection now points somewhere else: same id, different file.
    let retargeted = stored_sqlite_connection(&id, "/tmp/other.db");

    let change = Change::Insert {
        id: "ch-origin".into(),
        schema: "main".into(),
        table: "notes".into(),
        data: r#"{"id":1,"body":"must not be written"}"#.into(),
    };
    let err = execute_change_for_origin(&pm, &retargeted, &id, &origin, change)
        .await
        .expect_err("a retargeted connection must refuse the staged change");
    assert!(
        err.contains(crate::db::change_target::CHANGE_ORIGIN_RETARGETED),
        "the refusal carries the stable code: {err}"
    );

    let mut guard = pm.lock().await;
    let rows = sqlite_query(&mut guard, &id, "SELECT COUNT(*) FROM notes");
    assert_eq!(rows, vec![vec![int(0)]], "nothing may be written");
}

/// The same change applies when the origin still matches, so the refusal is
/// specific to a moved target rather than a blanket block.
#[tokio::test]
async fn the_backend_applies_a_change_whose_origin_still_matches() {
    let (pm, id) = sqlite_pool("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);");
    let stored = stored_sqlite_connection(&id, "/tmp/app.db");
    let origin = origin_for(&stored);
    let change = Change::Insert {
        id: "ch-origin-ok".into(),
        schema: "main".into(),
        table: "notes".into(),
        data: r#"{"id":1,"body":"applied"}"#.into(),
    };
    execute_change_for_origin(&pm, &stored, &id, &origin, change)
        .await
        .expect("a matching origin applies");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(&mut guard, &id, "SELECT COUNT(*) FROM notes");
    assert_eq!(rows, vec![vec![int(1)]]);
}

// ---------------------------------------------------------------------------
// The command boundary: the SAVED connection is resolved in the backend and
// compared with the origin the change was STAGED against
// ---------------------------------------------------------------------------

fn test_store() -> std::sync::Mutex<crate::store::Store> {
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory store");
    crate::store::migrations::run_migrations(&conn).expect("migrations");
    std::sync::Mutex::new(crate::store::Store::from_connection(conn).expect("test store"))
}

fn sqlite_input(host: &str) -> crate::models::ConnectionInput {
    crate::models::ConnectionInput {
        name: "Demo".into(),
        db_type: "sqlite".into(),
        host: host.into(),
        port: None,
        username: None,
        folder_id: None,
        tag_ids: vec![],
        password: None,
        database: Some("main".into()),
        environment: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssh_password: None,
        ssh_passphrase: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        use_keychain: false,
    }
}

/// The full command path, with no UI in it: a change staged against target A,
/// then the SAVED connection retargeted to B, is refused by the backend — because
/// the backend reads the connection from the store itself and compares it with
/// the origin recorded at staging time.
///
/// This is the guarantee that a renderer cannot decide for itself: whatever it
/// passes as the staged origin is checked against what is actually stored, and a
/// mismatched target writes nothing.
#[tokio::test]
async fn a_change_staged_before_a_retarget_is_refused_by_the_command_boundary() {
    let store = test_store();
    let saved =
        crate::commands::connections::create_connection_inner(&store, sqlite_input("/tmp/app.db"))
            .expect("saved connection");
    let id = saved.id.clone();

    // A live session for that id (the handle is what a write would use).
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);")
        .expect("fixture");
    let mut manager = ConnectionPoolManager::new();
    manager.register(&id, DbHandle::sqlite(conn));
    let pm = tokio::sync::Mutex::new(manager);

    // Staged while the connection pointed at /tmp/app.db.
    let staged = origin_for(&saved);

    // The user edits the connection: same id, different file.
    crate::commands::connections::update_connection_inner(
        &store,
        id.clone(),
        sqlite_input("/tmp/other.db"),
    )
    .expect("retarget");

    let change = Change::Insert {
        id: "ch-boundary".into(),
        schema: "main".into(),
        table: "notes".into(),
        data: r#"{"id":1,"body":"must not be written"}"#.into(),
    };
    let err = execute_staged_change(&store, &pm, &id, &staged, change)
        .await
        .expect_err("the backend must refuse work staged against the old target");
    assert!(
        err.contains(crate::db::change_target::CHANGE_ORIGIN_RETARGETED),
        "the refusal carries the stable code: {err}"
    );
    assert!(err.contains("Nothing was written"), "{err}");

    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT COUNT(*) FROM notes"),
        vec![vec![int(0)]],
        "a refused change writes nothing"
    );
}

/// The same command path applies the change when the saved connection still
/// targets what the work was staged against — the refusal is specific.
#[tokio::test]
async fn a_change_staged_against_the_current_target_is_applied_by_the_command_boundary() {
    let store = test_store();
    let saved =
        crate::commands::connections::create_connection_inner(&store, sqlite_input("/tmp/app.db"))
            .expect("saved connection");
    let id = saved.id.clone();

    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);")
        .expect("fixture");
    let mut manager = ConnectionPoolManager::new();
    manager.register(&id, DbHandle::sqlite(conn));
    let pm = tokio::sync::Mutex::new(manager);

    let staged = origin_for(&saved);
    let change = Change::Insert {
        id: "ch-boundary-ok".into(),
        schema: "main".into(),
        table: "notes".into(),
        data: r#"{"id":1,"body":"applied"}"#.into(),
    };
    execute_staged_change(&store, &pm, &id, &staged, change)
        .await
        .expect("an unchanged target applies");

    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT body FROM notes"),
        vec![vec![Value::Text("applied".into())]]
    );
}

/// An origin for a connection that is not the one the change names is refused
/// before the store is even consulted for a target match.
#[tokio::test]
async fn a_change_whose_origin_names_another_connection_is_refused() {
    let store = test_store();
    let saved =
        crate::commands::connections::create_connection_inner(&store, sqlite_input("/tmp/app.db"))
            .expect("saved connection");
    let id = saved.id.clone();
    let mut manager = ConnectionPoolManager::new();
    let conn = rusqlite::Connection::open_in_memory().expect("in-memory sqlite");
    conn.execute_batch("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);")
        .expect("fixture");
    manager.register(&id, DbHandle::sqlite(conn));
    let pm = tokio::sync::Mutex::new(manager);

    let mut staged = origin_for(&saved);
    staged.connection_id = "another-connection".into();
    let change = Change::Insert {
        id: "ch-other".into(),
        schema: "main".into(),
        table: "notes".into(),
        data: r#"{"id":1,"body":"nope"}"#.into(),
    };
    let err = execute_staged_change(&store, &pm, &id, &staged, change)
        .await
        .expect_err("a foreign origin must be refused");
    assert!(
        err.contains(crate::db::change_target::CHANGE_ORIGIN_RETARGETED),
        "{err}"
    );
    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT COUNT(*) FROM notes"),
        vec![vec![int(0)]]
    );
}

// ---------------------------------------------------------------------------
// A reused physical locator can never modify a different row
// ---------------------------------------------------------------------------

/// A no-PK row is addressed by `rowid`, and SQLite reuses a `rowid` as soon as
/// the row that held it is gone. The whole-row guard is what stops that reused
/// locator from editing a row the user never saw.
#[tokio::test]
async fn a_reused_rowid_cannot_be_modified_into_the_wrong_row() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);

    // The user sees rowid 3 (`/orders`, `sess-003`) — the highest rowid, so
    // SQLite hands it to the next insert. Someone else deletes it and inserts a
    // different row, which takes that rowid.
    {
        let mut guard = pm.lock().await;
        sqlite_exec(&mut guard, &id, "DELETE FROM page_views WHERE rowid = 3");
        sqlite_exec(
            &mut guard,
            &id,
            "INSERT INTO page_views (url, session_id, user_agent) \
             VALUES ('/orders', 'sess-999', 'agent-impostor')",
        );
        drop(guard);
    }

    // The staged update carries the whole displayed row, which the impostor does
    // not match, so nothing is written.
    let change = Change::Update {
        id: "ch-reused-locator".into(),
        schema: "main".into(),
        table: "page_views".into(),
        primary_key: r#"{"rowid":3}"#.into(),
        old_data: r#"{"url":"/orders","session_id":"sess-003","user_agent":"agent-c"}"#.into(),
        new_data: r#"{"url":"/stolen"}"#.into(),
    };
    let err = execute_change_inner(&pm, &id, change)
        .await
        .expect_err("the reused locator addresses a different row");
    assert!(
        err.contains("nothing was written"),
        "the refusal must state that nothing was written: {err}"
    );

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
            vec![Value::Text("/cart".into()), Value::Text("sess-002".into())],
            vec![
                Value::Text("/orders".into()),
                Value::Text("sess-999".into())
            ],
        ],
        "the impostor row keeps its values; the other rows are untouched"
    );
}

/// Why the whole row is needed: this is the payload a locator update would carry
/// if the grid staged only the edited cell, and it matches the reused locator's
/// new occupant.
#[tokio::test]
async fn a_reused_rowid_would_match_an_edited_column_only_guard() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    {
        let mut guard = pm.lock().await;
        sqlite_exec(&mut guard, &id, "DELETE FROM page_views WHERE rowid = 3");
        sqlite_exec(
            &mut guard,
            &id,
            "INSERT INTO page_views (url, session_id, user_agent) \
             VALUES ('/orders', 'sess-999', 'agent-impostor')",
        );
        drop(guard);
    }

    // `url` is the edited column and the impostor shares its old value, so the
    // partial predicate matches exactly one row — the wrong one. The grid never
    // produces this payload any more (`updateGuardValues` stages the whole row
    // for a locator identity); this test pins down why that guard is mandatory.
    let change = Change::Update {
        id: "ch-partial-guard".into(),
        schema: "main".into(),
        table: "page_views".into(),
        primary_key: r#"{"rowid":3}"#.into(),
        old_data: r#"{"url":"/orders"}"#.into(),
        new_data: r#"{"url":"/elsewhere"}"#.into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("a one-row match is applied");

    let mut guard = pm.lock().await;
    let rows = sqlite_query(
        &mut guard,
        &id,
        "SELECT url, session_id FROM page_views ORDER BY rowid",
    );
    assert_eq!(
        rows[2],
        vec![
            Value::Text("/elsewhere".into()),
            Value::Text("sess-999".into())
        ],
        "the reused locator's occupant was modified — the hazard the full-row guard removes"
    );
}

// ---------------------------------------------------------------------------
// SQLite rebuild: one transaction, or a refusal before the first mutation (ticket 08)
//
// The change-application seam: what a queued `rebuild_table` change actually
// does to a real SQLite database. Each case asserts either the completed
// rebuild or the exact absence of any durable effect.
// ---------------------------------------------------------------------------

/// A plain table a rebuild can reproduce: no index, trigger, key, check,
/// unique, generated column, collation, expression default, or table option.
const REBUILD_FIXTURE: &str = r#"
CREATE TABLE t (
    id    INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    note  TEXT
);
INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');
"#;

/// The same table with a child pointing at it, and foreign-key enforcement on:
/// a rebuild that cascaded or leaked enforcement would be visible here.
const REBUILD_FIXTURE_WITH_CHILD: &str = r#"
PRAGMA foreign_keys = ON;
CREATE TABLE t (
    id    INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    note  TEXT
);
CREATE TABLE child (
    id   INTEGER PRIMARY KEY,
    t_id INTEGER REFERENCES t(id) ON DELETE CASCADE
);
INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');
INSERT INTO child (id, t_id) VALUES (10, 1), (11, 2);
"#;

/// A rebuild must not swallow a trigger the script was not written to recreate.
const REBUILD_FIXTURE_WITH_TRIGGER: &str = r#"
CREATE TABLE t (
    id    INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    note  TEXT
);
INSERT INTO t (id, label, note) VALUES (1, 'alpha', 'first'), (2, 'beta', 'second');
CREATE TRIGGER trg_t_late AFTER UPDATE ON t BEGIN SELECT 1; END;
"#;

#[tokio::test]
async fn sqlite_change_applies_a_rebuild_in_one_transaction() {
    let (pm, id) = sqlite_pool(REBUILD_FIXTURE);
    // Hand-written rebuild script: create the temp table, copy by Column
    // Identity (dropping `note`), drop, rename.
    let change = Change::RebuildTable {
        id: "rb-ok".into(),
        table: "t".into(),
        sql: "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER NOT NULL, \"label\" TEXT NOT NULL, PRIMARY KEY (\"id\"));\n\
              INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\";\n\
              DROP TABLE \"main\".\"t\";\n\
              ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\""
            .into(),
    };
    execute_change_inner(&pm, &id, change)
        .await
        .expect("a rebuild of a plain table applies");

    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT id, label FROM t ORDER BY id"),
        vec![
            vec![int(1), Value::Text("alpha".into())],
            vec![int(2), Value::Text("beta".into())],
        ],
        "every row survived and values stayed in their columns"
    );
    let cols: Vec<String> = sqlite_query(&mut guard, &id, "PRAGMA table_info(t)")
        .into_iter()
        .map(|row| match &row[1] {
            Value::Text(t) => t.clone(),
            other => panic!("column name must be text, got {other:?}"),
        })
        .collect();
    assert_eq!(
        cols,
        vec!["id", "label"],
        "the rebuilt schema is the staged one"
    );
    assert_eq!(
        sqlite_query(
            &mut guard,
            &id,
            "SELECT count(*) FROM sqlite_master WHERE name = '_gl_t_tmp'"
        ),
        vec![vec![int(0)]],
        "the temporary table is gone"
    );
}

#[tokio::test]
async fn sqlite_change_failure_mid_rebuild_changes_nothing() {
    let (pm, id) = sqlite_pool(REBUILD_FIXTURE_WITH_CHILD);
    let before = {
        let mut guard = pm.lock().await;
        (
            sqlite_query(&mut guard, &id, "SELECT id, label, note FROM t ORDER BY id"),
            sqlite_query(&mut guard, &id, "SELECT id, t_id FROM child ORDER BY id"),
            sqlite_query(
                &mut guard,
                &id,
                "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
            ),
        )
    };
    // The script gets all the way to the rebuilt table and then fails on a
    // primary-key collision: the failure is injected *after* the original table
    // was dropped and the temp table renamed into place.
    let change = Change::RebuildTable {
        id: "rb-fail".into(),
        table: "t".into(),
        sql: "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER NOT NULL, \"label\" TEXT NOT NULL, PRIMARY KEY (\"id\"));\n\
              INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\";\n\
              DROP TABLE \"main\".\"t\";\n\
              ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\";\n\
              INSERT INTO \"main\".\"t\" (\"id\", \"label\") VALUES (1, 'collision')"
            .into(),
    };
    let err = execute_change_inner(&pm, &id, change)
        .await
        .expect_err("the injected failure must be reported");
    assert!(
        err.to_uppercase().contains("UNIQUE") || err.to_uppercase().contains("PRIMARY KEY"),
        "the injected failure is a key collision: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT id, label, note FROM t ORDER BY id"),
        before.0,
        "every row of the original table survived"
    );
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT id, t_id FROM child ORDER BY id"),
        before.1,
        "dropping the original table did not cascade into child rows"
    );
    assert_eq!(
        sqlite_query(
            &mut guard,
            &id,
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
        ),
        before.2,
        "no temporary table, no dropped table, no partly rewritten schema"
    );
    // The rollback closed the transaction: an ordinary write still works and
    // foreign-key enforcement is back on for this shared connection.
    sqlite_exec(
        &mut guard,
        &id,
        "INSERT INTO t (id, label, note) VALUES (3, 'gamma', NULL)",
    );
    assert_eq!(
        sqlite_query(&mut guard, &id, "PRAGMA foreign_keys"),
        vec![vec![int(1)]],
        "the session's foreign key enforcement is restored"
    );
}

/// The editor form is built from this metadata, so a flag it cannot see is a
/// constraint a rebuild would silently drop.
#[tokio::test]
async fn sqlite_column_metadata_reports_what_a_rebuild_must_reproduce() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            email   TEXT NOT NULL UNIQUE,
            plain   TEXT,
            doubled INTEGER GENERATED ALWAYS AS (id * 2) STORED
        );",
    )
    .unwrap();
    let (columns, is_view) =
        crate::commands::db_viewer::sqlite_column_metadata(&conn, "t").unwrap();
    assert!(!is_view);
    let by_name = |name: &str| {
        columns
            .iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("{name} is missing from {columns:?}"))
    };
    assert!(
        by_name("id").is_auto_increment,
        "the rowid sequence is visible"
    );
    assert!(by_name("id").is_pk);
    assert!(by_name("email").is_unique, "the unique key is visible");
    assert!(!by_name("plain").is_unique);
    // A generated column is a real column of the table: it is listed, marked,
    // and not offered for editing.
    let doubled = by_name("doubled");
    assert!(doubled.is_generated);
    assert!(!doubled.editable);
    assert_eq!(doubled.data_type, "INTEGER");
}

#[tokio::test]
async fn sqlite_rebuild_change_refuses_a_script_that_drops_preserved_metadata_before_mutating() {
    let (pm, id) = sqlite_pool(REBUILD_FIXTURE_WITH_TRIGGER);
    let before = {
        let mut guard = pm.lock().await;
        sqlite_query(
            &mut guard,
            &id,
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
        )
    };
    let change = Change::RebuildTable {
        id: "rb-refused".into(),
        table: "t".into(),
        sql: "CREATE TABLE \"main\".\"_gl_t_tmp\" (\"id\" INTEGER NOT NULL, \"label\" TEXT NOT NULL, PRIMARY KEY (\"id\"));\n\
              INSERT INTO \"main\".\"_gl_t_tmp\" (\"id\", \"label\") SELECT \"id\", \"label\" FROM \"main\".\"t\";\n\
              DROP TABLE \"main\".\"t\";\n\
              ALTER TABLE \"main\".\"_gl_t_tmp\" RENAME TO \"t\""
            .into(),
    };
    // The round-trip check reads the script back and proves it reproduces the
    // live trigger. This one does not, so the rebuild is refused before its
    // first statement instead of dropping the trigger.
    let err = execute_change_inner(&pm, &id, change)
        .await
        .expect_err("a script that omits the trigger must be refused");
    assert!(
        err.contains("trg_t_late") && err.contains("Cannot rebuild"),
        "the refusal names the blocker: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(
            &mut guard,
            &id,
            "SELECT type, name, sql FROM sqlite_master ORDER BY type, name"
        ),
        before,
        "refused before the first mutating statement"
    );
}

#[tokio::test]
async fn sqlite_rebuild_change_without_a_table_name_is_refused() {
    let (pm, id) = sqlite_pool(REBUILD_FIXTURE);
    let change = Change::RebuildTable {
        id: "rb-unnamed".into(),
        table: String::new(),
        sql: "DROP TABLE \"main\".\"t\"".into(),
    };
    let err = execute_change_inner(&pm, &id, change)
        .await
        .expect_err("a rebuild that cannot name its table fails closed");
    assert!(err.contains("does not name its table"), "{err}");
    let mut guard = pm.lock().await;
    assert_eq!(
        sqlite_query(&mut guard, &id, "SELECT count(*) FROM t"),
        vec![vec![int(2)]],
        "nothing was applied"
    );
}

// ---------------------------------------------------------------------------
// Single-row writes are atomic and conflict-aware (ticket 03)
//
// The change-application seam: what a queued row write actually does to the
// database when it does not match exactly one intended row. Each case asserts
// both the reported failure AND the absence of a durable write.
// ---------------------------------------------------------------------------

/// Apply raw SQL on the SQLite handle — standing in for another session (or an
/// earlier app state) that changed the data after the grid read it.
fn sqlite_exec(pm: &mut ConnectionPoolManager, id: &str, sql: &str) {
    match pm.get(id) {
        Some(DbHandle::Sqlite(conn)) => {
            let conn = conn.try_lock().expect("sqlite connection free");
            conn.execute_batch(sql).expect("raw sql");
        }
        _ => panic!("expected a sqlite handle"),
    }
}

fn quantities(pm: &mut ConnectionPoolManager, id: &str) -> Vec<Vec<Value>> {
    sqlite_query(
        pm,
        id,
        "SELECT order_id, product_id, quantity FROM order_items ORDER BY order_id, product_id",
    )
}

fn page_view_urls(pm: &mut ConnectionPoolManager, id: &str) -> Vec<String> {
    sqlite_query(pm, id, "SELECT url FROM page_views ORDER BY rowid")
        .into_iter()
        .map(|row| match &row[0] {
            Value::Text(t) => t.clone(),
            other => panic!("url must be text, got {other:?}"),
        })
        .collect()
}

/// Criterion 1: a write matching zero rows commits nothing and reports a
/// stale-row error.
#[tokio::test]
async fn update_matching_zero_rows_reports_stale_and_writes_nothing() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    let before = {
        let mut guard = pm.lock().await;
        quantities(&mut guard, &id)
    };
    // (1, 99) is not in the table: another session removed it (or it was never
    // there). The edit must fail loudly and change nothing.
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-03-1".into(),
            schema: "main".into(),
            table: "order_items".into(),
            primary_key: r#"{"order_id":1,"product_id":99}"#.into(),
            old_data: r#"{"quantity":1}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("zero matches must fail");
    assert!(
        err.contains("row was modified or removed by another session"),
        "expected a stale-row error, got: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        quantities(&mut guard, &id),
        before,
        "nothing may be written"
    );
}

/// Criterion 1 for deletes: zero matches is a stale row, never a silent no-op.
#[tokio::test]
async fn delete_matching_zero_rows_reports_stale_and_removes_nothing() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    let before = {
        let mut guard = pm.lock().await;
        quantities(&mut guard, &id)
    };
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-03-2".into(),
            schema: "main".into(),
            table: "order_items".into(),
            primary_key: r#"{"order_id":7,"product_id":7}"#.into(),
            old_data: String::new(),
        },
    )
    .await
    .expect_err("zero matches must fail");
    assert!(
        err.contains("row was modified or removed by another session"),
        "expected a stale-row error, got: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        quantities(&mut guard, &id),
        before,
        "nothing may be deleted"
    );
}

/// Criterion 2: a write matching more than one row rolls back before reporting
/// an ambiguous match. A partial Row Identity addresses two rows; the earlier
/// behaviour reported the ambiguity *after* the rows were already changed.
#[tokio::test]
async fn ambiguous_update_rolls_back_before_reporting() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    let before = {
        let mut guard = pm.lock().await;
        quantities(&mut guard, &id)
    };
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-03-3".into(),
            schema: "main".into(),
            table: "order_items".into(),
            // Only `order_id`: both order 1 rows match.
            primary_key: r#"{"order_id":1}"#.into(),
            old_data: String::new(),
            new_data: r#"{"quantity":99}"#.into(),
        },
    )
    .await
    .expect_err("an ambiguous match must fail");
    assert!(
        err.contains("ambiguous row match"),
        "expected an ambiguous-match error, got: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        quantities(&mut guard, &id),
        before,
        "the ambiguous write must be rolled back, not left durable"
    );
}

/// Criterion 2 for deletes: both matching rows survive the rollback.
#[tokio::test]
async fn ambiguous_delete_rolls_back_before_reporting() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    let before = {
        let mut guard = pm.lock().await;
        quantities(&mut guard, &id)
    };
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-03-4".into(),
            schema: "main".into(),
            table: "order_items".into(),
            primary_key: r#"{"order_id":1}"#.into(),
            old_data: String::new(),
        },
    )
    .await
    .expect_err("an ambiguous match must fail");
    assert!(
        err.contains("ambiguous row match"),
        "expected an ambiguous-match error, got: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        quantities(&mut guard, &id),
        before,
        "both rows must survive"
    );
}

/// Criterion 3: changing a value another session has already changed reports a
/// conflict and writes nothing. The original value the user saw is the
/// predicate, so the newer value is never overwritten.
#[tokio::test]
async fn conflicting_update_reports_conflict_and_writes_nothing() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    // Another session bumped quantity 2 -> 5 after the grid read the row.
    {
        let mut guard = pm.lock().await;
        sqlite_exec(
            &mut guard,
            &id,
            "UPDATE order_items SET quantity = 5 WHERE order_id = 1 AND product_id = 1",
        );
    }
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-03-5".into(),
            schema: "main".into(),
            table: "order_items".into(),
            primary_key: r#"{"order_id":1,"product_id":1}"#.into(),
            // The value the user actually saw before editing.
            old_data: r#"{"quantity":2}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("a concurrent change must conflict");
    assert!(
        err.contains("conflict") && err.contains("quantity"),
        "expected a conflict naming the column, got: {err}"
    );

    let mut guard = pm.lock().await;
    let rows = quantities(&mut guard, &id);
    assert_eq!(
        rows[0][2],
        int(5),
        "the other session's value must survive; rows: {rows:?}"
    );
}

/// Criterion 4: a physical-locator write whose row has moved cannot modify a
/// different row. SQLite reuses a freed `rowid` for the next inserted row, so a
/// stale locator can point at a row the user never saw.
#[tokio::test]
async fn moved_locator_row_cannot_be_updated_through_a_reused_rowid() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    // Another session replaced rowid 3: the next insert takes the freed rowid.
    {
        let mut guard = pm.lock().await;
        sqlite_exec(
            &mut guard,
            &id,
            "DELETE FROM page_views WHERE rowid = 3;\
             INSERT INTO page_views (url, session_id, user_agent) \
             VALUES ('/evil', 'sess-evil', 'agent-x');",
        );
        assert_eq!(
            sqlite_query(
                &mut guard,
                &id,
                "SELECT rowid FROM page_views WHERE url = '/evil'"
            )[0][0],
            int(3),
            "the fixture must actually reuse rowid 3"
        );
    }

    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-03-6".into(),
            schema: "main".into(),
            table: "page_views".into(),
            primary_key: r#"{"rowid":3}"#.into(),
            // The user saw /orders in that row.
            old_data: r#"{"url":"/orders","session_id":"sess-003","user_agent":"agent-c"}"#.into(),
            new_data: r#"{"url":"/hijacked"}"#.into(),
        },
    )
    .await
    .expect_err("a moved locator must not write");
    assert!(
        err.contains("conflict"),
        "expected a locator conflict, got: {err}"
    );

    let mut guard = pm.lock().await;
    let urls = page_view_urls(&mut guard, &id);
    assert!(
        urls.contains(&"/evil".to_string()),
        "the different row must survive untouched: {urls:?}"
    );
    assert!(!urls.contains(&"/hijacked".to_string()));
}

/// Criterion 4 for deletes: a reused locator must never delete a different row.
#[tokio::test]
async fn moved_locator_row_cannot_be_deleted_through_a_reused_rowid() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    {
        let mut guard = pm.lock().await;
        sqlite_exec(
            &mut guard,
            &id,
            "DELETE FROM page_views WHERE rowid = 3;\
             INSERT INTO page_views (url, session_id, user_agent) \
             VALUES ('/evil', 'sess-evil', 'agent-x');",
        );
    }

    let err = execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-03-7".into(),
            schema: "main".into(),
            table: "page_views".into(),
            primary_key: r#"{"rowid":3}"#.into(),
            old_data: r#"{"url":"/orders","session_id":"sess-003","user_agent":"agent-c"}"#.into(),
        },
    )
    .await
    .expect_err("a moved locator must not delete");
    assert!(
        err.contains("conflict"),
        "expected a locator conflict, got: {err}"
    );

    let mut guard = pm.lock().await;
    let urls = page_view_urls(&mut guard, &id);
    assert!(
        urls.contains(&"/evil".to_string()),
        "the different row must survive untouched: {urls:?}"
    );
}

/// Fail closed: a physical-locator write with no original row values cannot be
/// proven to address the row the user saw, so it is refused before any write.
#[tokio::test]
async fn locator_write_without_original_values_is_refused() {
    let (pm, id) = sqlite_pool(NO_PK_FIXTURE);
    let before = {
        let mut guard = pm.lock().await;
        page_view_urls(&mut guard, &id)
    };
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-03-8".into(),
            schema: "main".into(),
            table: "page_views".into(),
            primary_key: r#"{"rowid":2}"#.into(),
            old_data: String::new(),
        },
    )
    .await
    .expect_err("an unguarded locator write must be refused");
    assert!(
        err.contains("physical locator") && err.contains("original"),
        "expected a fail-closed locator error, got: {err}"
    );

    let mut guard = pm.lock().await;
    assert_eq!(
        page_view_urls(&mut guard, &id),
        before,
        "nothing may change"
    );
}

/// A primary-key delete stays guarded by its complete Row Identity only: a
/// concurrent change to another column is not a conflict for a delete (no
/// full-row optimistic versioning is introduced).
#[tokio::test]
async fn pk_delete_is_not_blocked_by_an_unrelated_column_change() {
    let (pm, id) = sqlite_pool(COMPOSITE_PK_FIXTURE);
    {
        let mut guard = pm.lock().await;
        sqlite_exec(
            &mut guard,
            &id,
            "UPDATE order_items SET quantity = 5 WHERE order_id = 2 AND product_id = 1",
        );
    }
    execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-03-9".into(),
            schema: "main".into(),
            table: "order_items".into(),
            primary_key: r#"{"order_id":2,"product_id":1}"#.into(),
            // The full row as staged; only the identity decides a delete.
            old_data: r#"{"order_id":2,"product_id":1,"quantity":4,"unit_price":7.5}"#.into(),
        },
    )
    .await
    .expect("a primary-key delete addresses its row by identity");

    let mut guard = pm.lock().await;
    assert_eq!(
        quantities(&mut guard, &id)
            .iter()
            .map(|r| r[0].clone())
            .collect::<Vec<_>>(),
        vec![int(1), int(1)]
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
    pm.register("test-pg-row-identity", DbHandle::postgresql(client, handle));
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
    let (client, _task) = match pm.lock().await.acquire(id) {
        Some(DbHandle::Postgresql(c, t)) => (c, t),
        _ => panic!("expected a postgresql handle"),
    };
    let client = client.lock().await;
    client
        .batch_execute(sql)
        .await
        .map_err(|e| format!("{e:?}"))
}

async fn pg_rows(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    id: &str,
    sql: &str,
) -> Vec<Vec<String>> {
    // Raw SQL kept simple by casting every cell to text: the assertions only
    // compare values, not PostgreSQL types.
    let (client, _task) = match pm.lock().await.acquire(id) {
        Some(DbHandle::Postgresql(c, t)) => (c, t),
        _ => panic!("expected a postgresql handle"),
    };
    let client = client.lock().await;
    let rows = client.query(sql, &[]).await.expect("query");
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
    assert_eq!(
        rows,
        vec![vec!["1:1:2".to_string()], vec!["1:3:9".to_string()]]
    );

    // ── no primary key: the locator must be a real value, not NULL ───────
    let data = get_table_data_inner(&pm, &id, "public", &no_pk, None, None, None, None)
        .await
        .expect("no-PK data fetch");
    assert_eq!(
        data.columns.len(),
        1,
        "only the declared column is a column"
    );
    let locator = data.rows[1][data.columns.len()].clone();
    let locator = locator
        .as_str()
        .expect("ctid must decode as text, not NULL");
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
    let rows = pg_rows(
        &pm,
        &id,
        &format!("SELECT url FROM public.\"{no_pk}\" ORDER BY url"),
    )
    .await;
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
            // The row's values as displayed with that locator.
            old_data: r#"{"url":"/cart-v2"}"#.into(),
        },
    )
    .await
    .expect("locator delete applies");
    let rows = pg_rows(
        &pm,
        &id,
        &format!("SELECT url FROM public.\"{no_pk}\" ORDER BY url"),
    )
    .await;
    assert_eq!(
        rows,
        vec![vec!["/orders".to_string()], vec!["/products".to_string()]]
    );

    pg_execute(
        &pm,
        &id,
        &format!("DROP TABLE public.\"{composite}\"; DROP TABLE public.\"{no_pk}\""),
    )
    .await
    .expect("cleanup");
}

// ---------------------------------------------------------------------------
// Live PostgreSQL: single-row writes are atomic and conflict-aware (ticket 03)
// ---------------------------------------------------------------------------

/// Live test (opt-in). Every acceptance case of ticket 03 against a real
/// PostgreSQL server: zero and multiple matches roll back, a changed original
/// value conflicts, and a stale `ctid` can never modify a different row.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_PG_* env vars pointing at a scratch PostgreSQL"]
async fn live_pg_single_row_writes_are_atomic_and_conflict_aware() {
    let (pm, id) = live_pg_pool().await;
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let composite = format!("gridline_t03_composite_{suffix}");
    let no_pk = format!("gridline_t03_nopk_{suffix}");

    pg_execute(
        &pm,
        &id,
        &format!(
            "CREATE TABLE public.\"{composite}\" (order_id int NOT NULL, product_id int NOT NULL, \
             quantity int NOT NULL, PRIMARY KEY (order_id, product_id)); \
             INSERT INTO public.\"{composite}\" VALUES (1, 1, 2), (1, 3, 1), (2, 1, 4); \
             CREATE TABLE public.\"{no_pk}\" (url text NOT NULL); \
             INSERT INTO public.\"{no_pk}\" VALUES ('/products'), ('/cart'), ('/orders')"
        ),
    )
    .await
    .expect("fixture tables");

    let quantities_sql = format!(
        "SELECT order_id::text || ':' || product_id::text || ':' || quantity::text \
         FROM public.\"{composite}\" ORDER BY order_id, product_id"
    );

    // ── zero matches: stale row, nothing written ─────────────────────────
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-pg-t3-1".into(),
            schema: "public".into(),
            table: composite.clone(),
            primary_key: r#"{"order_id":1,"product_id":99}"#.into(),
            old_data: r#"{"quantity":1}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("zero matches must fail");
    assert!(
        err.contains("row was modified or removed by another session"),
        "expected a stale-row error, got: {err}"
    );
    assert_eq!(
        pg_rows(&pm, &id, &quantities_sql).await,
        vec![
            vec!["1:1:2".to_string()],
            vec!["1:3:1".to_string()],
            vec!["2:1:4".to_string()],
        ]
    );

    // ── multiple matches: ambiguous, rolled back ─────────────────────────
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-pg-t3-2".into(),
            schema: "public".into(),
            table: composite.clone(),
            primary_key: r#"{"order_id":1}"#.into(),
            old_data: String::new(),
            new_data: r#"{"quantity":99}"#.into(),
        },
    )
    .await
    .expect_err("multiple matches must fail");
    assert!(
        err.contains("ambiguous row match"),
        "expected an ambiguous-match error, got: {err}"
    );
    assert_eq!(
        pg_rows(&pm, &id, &quantities_sql).await,
        vec![
            vec!["1:1:2".to_string()],
            vec!["1:3:1".to_string()],
            vec!["2:1:4".to_string()],
        ],
        "the ambiguous write must be rolled back"
    );

    // ── concurrent change: conflict, nothing written ─────────────────────
    pg_execute(
        &pm,
        &id,
        &format!(
            "UPDATE public.\"{composite}\" SET quantity = 5 WHERE order_id = 1 AND product_id = 1"
        ),
    )
    .await
    .expect("simulate another session");
    let err = execute_change_inner(
        &pm,
        &id,
        Change::Update {
            id: "ch-pg-t3-3".into(),
            schema: "public".into(),
            table: composite.clone(),
            primary_key: r#"{"order_id":1,"product_id":1}"#.into(),
            old_data: r#"{"quantity":2}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("a concurrent change must conflict");
    assert!(
        err.contains("row conflict") && err.contains("quantity"),
        "expected a conflict naming the column, got: {err}"
    );
    assert_eq!(
        pg_rows(&pm, &id, &quantities_sql).await,
        vec![
            vec!["1:1:5".to_string()],
            vec!["1:3:1".to_string()],
            vec!["2:1:4".to_string()],
        ],
        "the other session's value must survive"
    );

    // ── a moved row: the stale locator cannot delete a different row ─────
    let data = get_table_data_inner(&pm, &id, "public", &no_pk, None, None, None, None)
        .await
        .expect("no-PK data fetch");
    let cart_index = data
        .rows
        .iter()
        .position(|row| row[0] == serde_json::Value::String("/cart".into()))
        .expect("the /cart row is displayed");
    let stale_locator = data.rows[cart_index][data.columns.len()]
        .as_str()
        .expect("ctid must decode as text")
        .to_string();
    // Another session updates that row: its ctid changes, so the displayed
    // locator no longer addresses it.
    pg_execute(
        &pm,
        &id,
        &format!("UPDATE public.\"{no_pk}\" SET url = '/cart-v2' WHERE url = '/cart'"),
    )
    .await
    .expect("simulate a moving row");

    let err = execute_change_inner(
        &pm,
        &id,
        Change::Delete {
            id: "ch-pg-t3-4".into(),
            schema: "public".into(),
            table: no_pk.clone(),
            primary_key: format!(r#"{{"ctid":"{stale_locator}"}}"#),
            old_data: r#"{"url":"/cart"}"#.into(),
        },
    )
    .await
    .expect_err("a stale locator must not write");
    assert!(
        err.contains("row was modified or removed by another session")
            || err.contains("row conflict"),
        "expected a stale/conflict error, got: {err}"
    );
    let urls = pg_rows(
        &pm,
        &id,
        &format!("SELECT url FROM public.\"{no_pk}\" ORDER BY url"),
    )
    .await;
    assert_eq!(
        urls,
        vec![
            vec!["/cart-v2".to_string()],
            vec!["/orders".to_string()],
            vec!["/products".to_string()],
        ],
        "no row may be deleted by a stale locator"
    );

    pg_execute(
        &pm,
        &id,
        &format!("DROP TABLE public.\"{composite}\"; DROP TABLE public.\"{no_pk}\""),
    )
    .await
    .expect("cleanup");
}

// ---------------------------------------------------------------------------
// Live MySQL: single-row writes are atomic and conflict-aware (ticket 03)
// ---------------------------------------------------------------------------

/// Live test (opt-in). MySQL has no physical locator, so the locator cases do
/// not apply; the transactional and conflict guarantees are identical and are
/// verified against a real server.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_MYSQL_URL pointing at a scratch MySQL/MariaDB"]
async fn live_mysql_single_row_writes_are_atomic_and_conflict_aware() {
    use sqlx::mysql::MySqlPoolOptions;

    let url = std::env::var("GRIDLINE_TEST_MYSQL_URL")
        .expect("GRIDLINE_TEST_MYSQL_URL (e.g. mysql://root:pw@127.0.0.1:3306/scratch)");
    let pool = MySqlPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("connect to test MySQL");
    let schema: String = sqlx::query_scalar("SELECT DATABASE()")
        .fetch_one(&pool)
        .await
        .expect("current database");
    let table = format!("gridline_t03_{}", uuid::Uuid::new_v4().simple());
    let q_table =
        crate::db::ident::qualified(crate::db::ident::Engine::MySql, &schema, &table).unwrap();

    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP TABLE IF EXISTS {q_table}"
    )))
    .execute(&pool)
    .await
    .expect("drop leftovers");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE TABLE {q_table} (
             `order_id` int NOT NULL,
             `product_id` int NOT NULL,
             `quantity` int NOT NULL,
             PRIMARY KEY (`order_id`, `product_id`)
         ) ENGINE = InnoDB"
    )))
    .execute(&pool)
    .await
    .expect("create fixture table");
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {q_table} (`order_id`, `product_id`, `quantity`) VALUES (1, 1, 2), (1, 3, 1), (2, 1, 4)"
    )))
    .execute(&pool)
    .await
    .expect("seed rows");

    let mut manager = ConnectionPoolManager::new();
    manager.register("mysql-t03", DbHandle::mysql(pool.clone()));
    let pm = tokio::sync::Mutex::new(manager);

    let snapshot = |rows: Vec<sqlx::mysql::MySqlRow>| -> Vec<String> {
        rows.iter()
            .map(|r| {
                format!(
                    "{}:{}:{}",
                    sqlx::Row::get::<i32, _>(r, 0),
                    sqlx::Row::get::<i32, _>(r, 1),
                    sqlx::Row::get::<i32, _>(r, 2)
                )
            })
            .collect()
    };
    let read = || {
        let pool = pool.clone();
        let q = format!(
            "SELECT `order_id`, `product_id`, `quantity` FROM {q_table} ORDER BY `order_id`, `product_id`"
        );
        async move {
            let rows = sqlx::query(sqlx::AssertSqlSafe(q.to_owned()))
                .fetch_all(&pool)
                .await
                .expect("read back rows");
            snapshot(rows)
        }
    };

    // ── zero matches: stale row, nothing written ─────────────────────────
    let err = execute_change_inner(
        &pm,
        &"mysql-t03".to_string(),
        Change::Update {
            id: "ch-my-t3-1".into(),
            schema: schema.clone(),
            table: table.clone(),
            primary_key: r#"{"order_id":1,"product_id":99}"#.into(),
            old_data: r#"{"quantity":1}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("zero matches must fail");
    assert!(
        err.contains("row was modified or removed by another session"),
        "expected a stale-row error, got: {err}"
    );
    assert_eq!(
        read().await,
        vec![
            "1:1:2".to_string(),
            "1:3:1".to_string(),
            "2:1:4".to_string()
        ]
    );

    // ── multiple matches: ambiguous, rolled back ─────────────────────────
    let err = execute_change_inner(
        &pm,
        &"mysql-t03".to_string(),
        Change::Delete {
            id: "ch-my-t3-2".into(),
            schema: schema.clone(),
            table: table.clone(),
            primary_key: r#"{"order_id":1}"#.into(),
            old_data: String::new(),
        },
    )
    .await
    .expect_err("multiple matches must fail");
    assert!(
        err.contains("ambiguous row match"),
        "expected an ambiguous-match error, got: {err}"
    );
    assert_eq!(
        read().await,
        vec![
            "1:1:2".to_string(),
            "1:3:1".to_string(),
            "2:1:4".to_string()
        ],
        "the ambiguous delete must be rolled back"
    );

    // ── concurrent change: conflict, nothing written ─────────────────────
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {q_table} SET `quantity` = 5 WHERE `order_id` = 1 AND `product_id` = 1"
    )))
    .execute(&pool)
    .await
    .expect("simulate another session");
    let err = execute_change_inner(
        &pm,
        &"mysql-t03".to_string(),
        Change::Update {
            id: "ch-my-t3-3".into(),
            schema: schema.clone(),
            table: table.clone(),
            primary_key: r#"{"order_id":1,"product_id":1}"#.into(),
            old_data: r#"{"quantity":2}"#.into(),
            new_data: r#"{"quantity":9}"#.into(),
        },
    )
    .await
    .expect_err("a concurrent change must conflict");
    assert!(
        err.contains("row conflict") && err.contains("quantity"),
        "expected a conflict naming the column, got: {err}"
    );
    assert_eq!(
        read().await,
        vec![
            "1:1:5".to_string(),
            "1:3:1".to_string(),
            "2:1:4".to_string()
        ],
        "the other session's value must survive"
    );

    // ── the guarded write still applies when nothing changed ─────────────
    execute_change_inner(
        &pm,
        &"mysql-t03".to_string(),
        Change::Update {
            id: "ch-my-t3-4".into(),
            schema: schema.clone(),
            table: table.clone(),
            primary_key: r#"{"order_id":2,"product_id":1}"#.into(),
            old_data: r#"{"quantity":4}"#.into(),
            new_data: r#"{"quantity":6}"#.into(),
        },
    )
    .await
    .expect("an unchanged original value applies");
    assert_eq!(
        read().await,
        vec![
            "1:1:5".to_string(),
            "1:3:1".to_string(),
            "2:1:6".to_string()
        ]
    );

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP TABLE {q_table}")))
        .execute(&pool)
        .await
        .expect("cleanup");
}

// ------------------------------------------------------------------
// Ticket 27: DDL copy is a tool job too.
// ------------------------------------------------------------------

/// Copying a table's DDL shells out to `pg_dump`, so a keychain-off connection
/// must authenticate with the session credential — which reaches the child
/// through `PGPASSWORD` only, never argv — while the copied DDL is returned
/// verbatim.
#[cfg(unix)]
#[test]
fn ddl_copy_sends_the_session_password_through_the_environment_only() {
    use std::os::unix::fs::PermissionsExt as _;

    let dir = std::env::temp_dir().join(format!(
        "gridline_ddl_copy_{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let argv_log = dir.join("argv.txt");
    let env_log = dir.join("env.txt");
    let pg_dump = dir.join("pg_dump");
    std::fs::write(
        &pg_dump,
        format!(
            "#!/bin/sh\n\
             if [ \"$1\" = \"--version\" ]; then echo 'pg_dump (PostgreSQL) 16.4'; exit 0; fi\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             printf '%s' \"$PGPASSWORD\" > '{}'\n\
             test \"$PGPASSWORD\" = session-secret || exit 79\n\
             echo 'CREATE TABLE public.t (id integer);'\n",
            argv_log.display(),
            env_log.display()
        ),
    )
    .unwrap();
    let mut perms = std::fs::metadata(&pg_dump).unwrap().permissions();
    perms.set_mode(0o700);
    std::fs::set_permissions(&pg_dump, perms).unwrap();

    // The credential a keychain-off connection supplied for this session.
    let store = crate::session_credential::SessionCredentialStore::new();
    store.set("conn-session", "session-secret");
    let password =
        crate::session_credential::resolve_tool_credential(&store, false, "conn-session", || {
            panic!("a keychain-off connection must not read the OS keychain")
        })
        .expect("the session credential is available");

    let ddl = super::get_pg_ddl_via_dump(
        "public",
        "t",
        &crate::commands::backup::PgConnParams::new(
            "localhost".into(),
            5432,
            "u".into(),
            "db".into(),
            password,
        ),
        pg_dump.to_str().unwrap(),
    );

    let argv = std::fs::read_to_string(&argv_log).unwrap_or_default();
    let env_password = std::fs::read_to_string(&env_log).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&dir);

    let ddl = ddl.expect("the DDL copy should succeed");
    assert!(
        ddl.contains("CREATE TABLE public.t (id integer);"),
        "the DDL must be returned verbatim: {ddl}"
    );
    assert_eq!(
        env_password, "session-secret",
        "the credential must travel through PGPASSWORD"
    );
    assert!(
        !argv.contains("session-secret"),
        "the credential must never be a process argument: {argv}"
    );
}
