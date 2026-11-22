use super::*;
use crate::db::pool::{ConnectionPoolManager, DbHandle};

/// Connect directly via tokio-postgres (no tunnel) so tests are Tauri-free.
async fn pool() -> (tokio::sync::Mutex<ConnectionPoolManager>, String) {
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
    let id = "test-conn".to_string();
    pm.register(&id, DbHandle::postgresql(client, handle));
    (tokio::sync::Mutex::new(pm), id)
}

#[tokio::test]
#[ignore]
async fn schema_crud_create_rename_drop() {
    let (pm, id) = pool().await;
    let name = "gridline_test_schema";
    create_schema_inner(&pm, &id, name).await.unwrap();
    assert!(
        create_schema_inner(&pm, &id, name).await.is_err(),
        "duplicate should error"
    );
    rename_schema_inner(&pm, &id, name, "gridline_test_schema2")
        .await
        .unwrap();
    drop_schema_inner(&pm, &id, "gridline_test_schema2", false)
        .await
        .unwrap();
}

#[tokio::test]
#[ignore]
async fn search_objects_finds_table_and_function() {
    let (pm, id) = pool().await;
    let hits = search_objects_inner(&pm, &id, "public", "users")
        .await
        .unwrap();
    assert!(
        hits.iter()
            .any(|h| h.name == "users" && h.object_type == "TABLE"),
        "demo has a users table"
    );
    let fns = search_objects_inner(&pm, &id, "public", "get")
        .await
        .unwrap();
    // substring match across types; assert it returns a Vec<ObjectSearchHit>
    assert!(fns.iter().all(|h| h.object_type != ""));
    // empty needle returns nothing matched by position('' in name) > 0 is always true — so empty returns all (capped at 100)
    let all = search_objects_inner(&pm, &id, "public", "").await.unwrap();
    assert!(all.len() <= 100);
}

#[tokio::test]
#[ignore]
async fn object_ddl_for_sequence_enum_function() {
    let (pm, id) = pool().await;
    // demo has users_id_seq, an enum, and a function
    let seq = get_object_ddl_inner(&pm, &id, "public", "sequence", "users_id_seq")
        .await
        .unwrap();
    assert!(seq.starts_with("CREATE SEQUENCE"), "{seq}");
    // function: pg_get_functiondef passthrough
    let f = get_object_ddl_inner(&pm, &id, "public", "function", "audit_log").await; // name per demo
    assert!(f.is_ok());
    assert!(
        f.clone().unwrap().contains("CREATE FUNCTION")
            || f.unwrap().contains("CREATE OR REPLACE FUNCTION")
    );
}

#[tokio::test]
async fn build_object_ddl_inner_guards_missing_connection_and_rejects_unknown_op() {
    let pm = tokio::sync::Mutex::new(ConnectionPoolManager::new());
    // Missing connection -> Connection not found
    let err = build_object_ddl_inner(
        &pm,
        "missing",
        "sequence",
        serde_json::json!({
            "schema": "public", "name": "s", "action": { "op": "drop" }
        }),
    )
    .await
    .unwrap_err();
    assert!(err.contains("Connection not found"), "{err}");
    // SQLite now dispatches to the SQLite table builders; non-table ops are rejected.
    pm.lock().await.register(
        "sqlite",
        DbHandle::sqlite(rusqlite::Connection::open_in_memory().unwrap()),
    );
    let err = build_object_ddl_inner(
        &pm,
        "sqlite",
        "sequence",
        serde_json::json!({
            "schema": "public", "name": "s", "action": { "op": "drop" }
        }),
    )
    .await
    .unwrap_err();
    assert!(err.contains("unknown op"), "{err}");
}

/// In-memory SQLite pool registered under id "c" (no Tauri, no live PG).
fn fresh_pool_with_sqlite() -> ConnectionPoolManager {
    let mut pm = ConnectionPoolManager::new();
    pm.register(
        "c",
        DbHandle::sqlite(rusqlite::Connection::open_in_memory().unwrap()),
    );
    pm
}

#[tokio::test]
async fn build_object_ddl_sqlite_create_yields_sqlite_sql() {
    let pm = fresh_pool_with_sqlite();
    let params = serde_json::json!({
        "schema": "main", "name": "users",
        "action": { "op": "create", "columns": [
            { "name": "id", "type": "integer", "nullable": false, "default": null, "is_pk": true, "auto_increment": true, "unique": false },
            { "name": "name", "type": "text", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false }
        ] }
    });
    let sqls = build_object_ddl_inner(&tokio::sync::Mutex::new(pm), "c", "table", params)
        .await
        .unwrap();
    assert!(
        sqls.iter()
            .any(|s| s.contains("INTEGER PRIMARY KEY AUTOINCREMENT")),
        "{sqls:?}"
    );
    assert!(sqls.iter().all(|s| !s.contains("serial")), "{sqls:?}");
}

/// Run a batch of staged statements on the in-memory SQLite handle.
async fn sqlite_exec(pm: &tokio::sync::Mutex<ConnectionPoolManager>, sqls: &[String]) {
    let handle = pm.lock().await.acquire("c").unwrap();
    match handle {
        DbHandle::Sqlite(conn) => {
            let conn = conn.lock().await;
            for s in sqls {
                conn.execute_batch(s).unwrap_or_else(|e| panic!("{s}: {e}"));
            }
        }
        _ => panic!("expected a sqlite handle"),
    }
}

/// How many `sqlite_master` rows of `kind` carry `name`.
async fn sqlite_master_count(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    kind: &str,
    name: &str,
) -> i64 {
    let mut g = pm.lock().await;
    match g.get("c").unwrap() {
        DbHandle::Sqlite(conn) => {
            let conn = conn.lock().await;
            conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = ?1 AND name = ?2",
                rusqlite::params![kind, name],
                |r| r.get(0),
            )
            .unwrap()
        }
        _ => panic!("expected a sqlite handle"),
    }
}

/// Read one table's column names in physical order, plus every row.
async fn sqlite_columns_and_rows(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    table: &str,
) -> (Vec<String>, Vec<String>) {
    let handle = pm.lock().await.acquire("c").unwrap();
    match handle {
        DbHandle::Sqlite(conn) => {
            let conn = conn.lock().await;
            let cols: Vec<String> = {
                let mut stmt = conn
                    .prepare(&format!("PRAGMA table_info(\"{table}\")"))
                    .unwrap();
                stmt.query_map([], |r| r.get::<_, String>(1))
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect()
            };
            let expr: Vec<String> = cols
                .iter()
                .map(|c| format!("ifnull(CAST(\"{c}\" AS TEXT), '<null>')"))
                .collect();
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {} FROM \"{table}\"",
                    expr.join(" || '|' || ")
                ))
                .unwrap();
            let rows: Vec<String> = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            (cols, rows)
        }
        _ => panic!("expected a sqlite handle"),
    }
}

#[tokio::test]
async fn sqlite_edit_add_in_middle_stages_only_add_and_keeps_rows() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(
        &pm,
        &[
            "CREATE TABLE \"main\".\"users\" (\"id\" INTEGER PRIMARY KEY, \"name\" TEXT, \"age\" INTEGER)".into(),
            "INSERT INTO \"main\".\"users\" VALUES (1, 'ada', 36)".into(),
        ],
    )
    .await;

    // `email` is inserted between `id` and `name`: it occupies the ordinal that
    // `name` used to hold.
    let params = serde_json::json!({
        // The form is seeded from the live snapshot, which is what a real edit
        // sends back (SQLite reports an INTEGER PRIMARY KEY as nullable).
        "schema": "main", "name": "users",
        "action": { "op": "edit", "columns": [
            { "name": "id", "type": "INTEGER", "nullable": true, "default": null, "is_pk": true, "auto_increment": false, "unique": false },
            { "name": "email", "type": "TEXT", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false },
            { "name": "name", "type": "TEXT", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false },
            { "name": "age", "type": "INTEGER", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false }
        ] }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .unwrap();
    assert_eq!(
        sqls,
        vec!["ALTER TABLE \"main\".\"users\" ADD COLUMN \"email\" TEXT"],
        "only the add is staged"
    );
    sqlite_exec(&pm, &sqls).await;
    // SQLite appends an added column physically; the point is that `name` and
    // `age` kept their own values instead of shifting into another column.
    let (cols, rows) = sqlite_columns_and_rows(&pm, "users").await;
    assert_eq!(cols, vec!["id", "name", "age", "email"]);
    assert_eq!(rows, vec!["1|ada|36|<null>"], "no value moved");
}

#[tokio::test]
async fn sqlite_edit_explicit_rename_keeps_values_under_the_new_name() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(
        &pm,
        &[
            "CREATE TABLE \"main\".\"users\" (\"id\" INTEGER PRIMARY KEY, \"name\" TEXT)".into(),
            "INSERT INTO \"main\".\"users\" VALUES (1, 'ada')".into(),
        ],
    )
    .await;

    let params = serde_json::json!({
        "schema": "main", "name": "users",
        "action": { "op": "edit", "columns": [
            { "name": "id", "type": "INTEGER", "nullable": true, "default": null, "is_pk": true, "auto_increment": false, "unique": false },
            { "name": "label", "type": "TEXT", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false, "renamed_from": "name" }
        ] }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .unwrap();
    assert_eq!(
        sqls,
        vec!["ALTER TABLE \"main\".\"users\" RENAME COLUMN \"name\" TO \"label\""],
        "an explicit rename stages only a rename"
    );
    sqlite_exec(&pm, &sqls).await;
    let (cols, rows) = sqlite_columns_and_rows(&pm, "users").await;
    assert_eq!(cols, vec!["id", "label"]);
    assert_eq!(rows, vec!["1|ada"], "the value followed the column");
}

// ---------------------------------------------------------------------------
// SQLite rebuild guard: a submission that needs a rebuild is refused before any
// mutation, with a reason naming the blocker (ticket 08)
// ---------------------------------------------------------------------------

/// The demo `order_items` shape: composite PK, a CHECK, a foreign key, and an
/// explicit index — every one of which the current rebuild script would drop.
const RICH_TABLE: &str = r#"
CREATE TABLE "main"."order_items" (
    "order_id"   INTEGER NOT NULL REFERENCES "orders"("id"),
    "product_id" INTEGER NOT NULL,
    "quantity"   INTEGER NOT NULL DEFAULT 1 CHECK ("quantity" > 0),
    "unit_price" REAL NOT NULL,
    PRIMARY KEY ("order_id", "product_id")
);
CREATE INDEX "main"."idx_order_items_product_id" ON "order_items"("product_id");
INSERT INTO "main"."order_items" VALUES (1, 7, 2, 34.99);
"#;

async fn pool_with_rich_table() -> tokio::sync::Mutex<ConnectionPoolManager> {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(
        &pm,
        &[
            "CREATE TABLE \"main\".\"orders\" (\"id\" INTEGER PRIMARY KEY)".into(),
            "INSERT INTO \"main\".\"orders\" VALUES (1)".into(),
            RICH_TABLE.to_string(),
        ],
    )
    .await;
    pm
}

fn rich_columns() -> serde_json::Value {
    serde_json::json!([
        { "name": "order_id", "type": "INTEGER", "nullable": false, "default": null, "is_pk": true, "auto_increment": false, "unique": false },
        { "name": "product_id", "type": "INTEGER", "nullable": false, "default": null, "is_pk": true, "auto_increment": false, "unique": false },
        { "name": "quantity", "type": "INTEGER", "nullable": false, "default": "1", "is_pk": false, "auto_increment": false, "unique": false },
        { "name": "unit_price", "type": "REAL", "nullable": false, "default": null, "is_pk": false, "auto_increment": false, "unique": false }
    ])
}

#[tokio::test]
async fn sqlite_edit_that_needs_a_rebuild_preserves_the_rich_table() {
    let pm = pool_with_rich_table().await;
    // Changing a declared type cannot be expressed by ALTER TABLE, so this
    // submission is a rebuild — and that rebuild has to carry the CHECK, the
    // foreign key, the composite primary key, and the explicit index.
    let mut columns = rich_columns();
    columns[2]["type"] = serde_json::json!("TEXT");
    let params = serde_json::json!({
        "schema": "main", "name": "order_items",
        "action": { "op": "edit", "columns": columns }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .expect("a rich table is rebuildable");
    let script = sqls.join(";\n");
    for preserved in [
        "CHECK (\"quantity\" > 0)",
        "REFERENCES \"orders\"(\"id\")",
        "PRIMARY KEY (\"order_id\", \"product_id\")",
        "CREATE INDEX \"idx_order_items_product_id\"",
        "\"quantity\" TEXT",
    ] {
        assert!(
            script.contains(preserved),
            "the rebuild keeps {preserved}: {script}"
        );
    }

    // And it really applies: the composite key, the index, and the row survive.
    crate::commands::db_viewer::execute_change_inner(
        &pm,
        "c",
        crate::models::db_viewer::Change::RebuildTable {
            id: "rb-edit".into(),
            table: "order_items".into(),
            sql: script,
        },
    )
    .await
    .expect("the rebuild applies");
    let (cols, rows) = sqlite_columns_and_rows(&pm, "order_items").await;
    assert_eq!(cols[2], "quantity", "the retyped column kept its place");
    assert_eq!(rows, vec!["1|7|2|34.99".to_string()]);
    assert_eq!(
        sqlite_master_count(&pm, "index", "idx_order_items_product_id").await,
        1,
        "the index came back"
    );
}

#[tokio::test]
async fn sqlite_edit_that_needs_no_rebuild_is_still_staged() {
    // The guard must not refuse ALTER-only work on a table it would refuse to
    // rebuild: adding a nullable column touches no metadata.
    let pm = pool_with_rich_table().await;
    let mut columns = rich_columns();
    columns.as_array_mut().unwrap().push(serde_json::json!(
        { "name": "discount", "type": "REAL", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false }
    ));
    let params = serde_json::json!({
        "schema": "main", "name": "order_items",
        "action": { "op": "edit", "columns": columns }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .expect("an ALTER-only edit needs no rebuild guard");
    assert_eq!(
        sqls,
        vec!["ALTER TABLE \"main\".\"order_items\" ADD COLUMN \"discount\" REAL".to_string()],
        "only the add is staged"
    );
}

#[tokio::test]
async fn sqlite_rebuild_op_of_a_rich_table_preserves_its_metadata() {
    let pm = pool_with_rich_table().await;
    let params = serde_json::json!({
        "schema": "main", "name": "order_items",
        "action": { "op": "rebuild", "columns": rich_columns() }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .expect("a rich table is rebuildable");
    let script = sqls.join(";\n");
    assert!(script.contains("CHECK (\"quantity\" > 0)"), "{script}");
    assert!(
        script.contains("CREATE INDEX \"idx_order_items_product_id\""),
        "{script}"
    );

    // Committing the staged script re-checks it against the live table, then
    // applies it in one transaction.
    let change = crate::models::db_viewer::Change::RebuildTable {
        id: "rb-rich".into(),
        table: "order_items".into(),
        sql: script,
    };
    crate::commands::db_viewer::execute_change_inner(&pm, "c", change)
        .await
        .expect("the rebuild applies");
    let (_, rows) = sqlite_columns_and_rows(&pm, "order_items").await;
    assert_eq!(rows, vec!["1|7|2|34.99".to_string()], "the row survived");
    assert_eq!(
        sqlite_master_count(&pm, "index", "idx_order_items_product_id").await,
        1,
        "the index survived"
    );
}

#[tokio::test]
async fn sqlite_rebuild_readiness_answers_for_the_proposed_columns() {
    let pm = pool_with_rich_table().await;
    // ALTER-only submission: no rebuild, so nothing to answer.
    let mut added = rich_columns();
    added.as_array_mut().unwrap().push(serde_json::json!(
        { "name": "discount", "type": "REAL", "nullable": true, "default": null, "is_pk": false, "auto_increment": false, "unique": false }
    ));
    let ready = get_table_rebuild_readiness_inner(&pm, "c", "main", "order_items", Some(added))
        .await
        .unwrap();
    assert!(ready.ok, "{ready:?}");
    assert!(ready.reasons.is_empty(), "{ready:?}");

    // A type change is a rebuild, and this table's CHECK, foreign key, composite
    // primary key, and index are all reproducible.
    let mut retyped = rich_columns();
    retyped[2]["type"] = serde_json::json!("TEXT");
    let rebuilt = get_table_rebuild_readiness_inner(&pm, "c", "main", "order_items", Some(retyped))
        .await
        .unwrap();
    assert!(rebuilt.ok, "{rebuilt:?}");
    assert!(rebuilt.reasons.is_empty(), "{rebuilt:?}");

    // Without proposed columns the answer is about the live table as-is.
    let live = get_table_rebuild_readiness_inner(&pm, "c", "main", "order_items", None)
        .await
        .unwrap();
    assert!(live.ok, "the rich table can be rebuilt: {live:?}");

    // Dropping the column the explicit index covers genuinely cannot be
    // preserved, and the readiness answer names it before anything is staged.
    let dropped: Vec<serde_json::Value> = rich_columns()
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["name"] != "product_id")
        .cloned()
        .collect();
    let refused = get_table_rebuild_readiness_inner(
        &pm,
        "c",
        "main",
        "order_items",
        Some(serde_json::Value::Array(dropped)),
    )
    .await
    .unwrap();
    assert!(!refused.ok, "{refused:?}");
    assert!(
        refused
            .reasons
            .iter()
            .any(|r| r.contains("idx_order_items_product_id") && r.contains("product_id")),
        "the reason names the index and the column: {refused:?}"
    );
}

/// The real seeded demo schema: the shapes the demo deliberately contains
/// (AUTOINCREMENT, FKs, CHECKs, UNIQUEs, composite PKs, indexes, expression
/// defaults, views) are the regression fixture for the guard — each one is
/// either reproducible by the rebuild script or refused by name.
const DEMO_SCHEMA: &str = include_str!("demo_schema.sql");

#[tokio::test]
async fn sqlite_rebuild_guard_accepts_the_demo_tables_it_can_reproduce() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(&pm, &[DEMO_SCHEMA.to_string()]).await;
    for table in [
        "users",
        "categories",
        "products",
        "addresses",
        "orders",
        "order_items",
        "audit_log",
        "files",
        "page_views",
        "app_settings",
        "marketing_campaigns",
    ] {
        let readiness = get_table_rebuild_readiness_inner(&pm, "c", "main", table, None)
            .await
            .unwrap_or_else(|e| panic!("{table}: {e}"));
        assert!(
            readiness.ok,
            "{table} is rebuildable, but the guard said {readiness:?}"
        );
    }
}

#[tokio::test]
async fn rebuilding_every_demo_table_keeps_its_schema_objects() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(&pm, &[DEMO_SCHEMA.to_string()]).await;
    // A reorder of each table, applied for real: the round-trip check inside
    // `apply_rebuild` is what makes this safe.
    for table in [
        "users",
        "categories",
        "products",
        "addresses",
        "orders",
        "order_items",
        "audit_log",
        "files",
        "page_views",
        "app_settings",
        "marketing_campaigns",
    ] {
        let before = sqlite_master_rows(&pm, table).await;
        let columns = sqlite_live_columns_json(&pm, table).await;
        let mut reordered = columns.clone();
        reordered.rotate_left(1);
        let params = serde_json::json!({
            "schema": "main", "name": table,
            "action": { "op": "rebuild", "columns": reordered }
        });
        let sqls = build_object_ddl_inner(&pm, "c", "table", params)
            .await
            .unwrap_or_else(|e| panic!("{table}: {e}"));
        crate::commands::db_viewer::execute_change_inner(
            &pm,
            "c",
            crate::models::db_viewer::Change::RebuildTable {
                id: format!("rb-{table}"),
                table: table.into(),
                sql: sqls.join(";\n"),
            },
        )
        .await
        .unwrap_or_else(|e| panic!("{table}: {e}"));
        assert_eq!(
            sqlite_master_rows(&pm, table).await,
            before,
            "{table}: every index and trigger survived the rebuild"
        );
    }
}

/// The `(type, name, sql)` of the indexes and triggers attached to `table`.
async fn sqlite_master_rows(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    table: &str,
) -> Vec<(String, String, String)> {
    let mut g = pm.lock().await;
    match g.get("c").unwrap() {
        DbHandle::Sqlite(conn) => {
            let conn = conn.lock().await;
            let mut stmt = conn
                .prepare(
                    "SELECT type, name, coalesce(sql, '') FROM sqlite_master \
                     WHERE tbl_name = ?1 AND type IN ('index', 'trigger') ORDER BY type, name",
                )
                .unwrap();
            stmt.query_map(rusqlite::params![table], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
        }
        _ => panic!("expected a sqlite handle"),
    }
}

/// The live columns of `table` as the editor would submit them.
async fn sqlite_live_columns_json(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    table: &str,
) -> Vec<serde_json::Value> {
    let mut g = pm.lock().await;
    match g.get("c").unwrap() {
        DbHandle::Sqlite(conn) => {
            let conn = conn.lock().await;
            let shape = crate::db::sqlite_rebuild::read_table_shape(&conn, table).unwrap();
            shape
                .columns
                .iter()
                .map(|c| {
                    serde_json::json!({
                        "name": c.name,
                        "type": c.type_,
                        "nullable": c.nullable,
                        "default": c.default,
                        "is_pk": c.is_pk,
                        "auto_increment": c.auto_increment,
                        "unique": c.unique,
                    })
                })
                .collect()
        }
        _ => panic!("expected a sqlite handle"),
    }
}

#[tokio::test]
async fn sqlite_rebuild_readiness_allows_a_plain_table() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    sqlite_exec(
        &pm,
        &[
            "CREATE TABLE \"main\".\"t\" (\"id\" INTEGER PRIMARY KEY, \"label\" TEXT NOT NULL)"
                .into(),
            "INSERT INTO \"main\".\"t\" VALUES (1, 'alpha')".into(),
        ],
    )
    .await;
    let columns = serde_json::json!([
        { "name": "label", "type": "TEXT", "nullable": false, "default": null, "is_pk": false, "auto_increment": false, "unique": false },
        { "name": "id", "type": "INTEGER", "nullable": true, "default": null, "is_pk": true, "auto_increment": false, "unique": false }
    ]);
    // A reorder: a rebuild, and this table carries nothing a rebuild would drop.
    let ready = get_table_rebuild_readiness_inner(&pm, "c", "main", "t", Some(columns.clone()))
        .await
        .unwrap();
    assert!(ready.ok, "{ready:?}");

    let params = serde_json::json!({
        "schema": "main", "name": "t",
        "action": { "op": "edit", "columns": columns }
    });
    let sqls = build_object_ddl_inner(&pm, "c", "table", params)
        .await
        .expect("a plain table can be rebuilt");
    assert!(
        sqls.iter().any(|s| s.contains("_gl_t_tmp")),
        "the reorder produced a rebuild script: {sqls:?}"
    );
}

#[tokio::test]
async fn execute_change_sqlite_ddl_runs_create() {
    let pm = tokio::sync::Mutex::new(fresh_pool_with_sqlite());
    let change = crate::models::db_viewer::Change::Ddl {
        id: "x".into(),
        sql: "CREATE TABLE u(id INTEGER)".into(),
    };
    let r = crate::commands::db_viewer::execute_change_inner(&pm, "c", change).await;
    assert!(r.is_ok(), "{r:?}");
    // the table really landed on the live connection
    {
        let handle = pm.lock().await.acquire("c").unwrap();
        match handle {
            crate::db::pool::DbHandle::Sqlite(conn) => {
                let conn = conn.lock().await;
                let n: i64 = conn
                    .query_row(
                        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='u'",
                        [],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(n, 1);
            }
            _ => panic!("expected a sqlite handle"),
        }
    }
}

#[tokio::test]
#[ignore]
async fn build_object_ddl_inner_on_postgresql_pool() {
    let (pm, id) = pool().await;
    let sql = build_object_ddl_inner(
        &pm,
        &id,
        "sequence",
        serde_json::json!({
            "schema": "public", "name": "s", "action": { "op": "drop" }
        }),
    )
    .await
    .unwrap();
    assert_eq!(sql, vec!["DROP SEQUENCE \"public\".\"s\""]);
}

#[tokio::test]
async fn get_available_extensions_inner_guards_postgresql_only() {
    let pm = tokio::sync::Mutex::new(ConnectionPoolManager::new());
    // Missing connection -> Connection not found
    let err = get_available_extensions_inner(&pm, "missing")
        .await
        .unwrap_err();
    assert!(err.contains("Connection not found"), "{err}");
    // Non-PostgreSQL handle -> PostgreSQL-only error
    pm.lock().await.register(
        "sqlite",
        DbHandle::sqlite(rusqlite::Connection::open_in_memory().unwrap()),
    );
    let err = get_available_extensions_inner(&pm, "sqlite")
        .await
        .unwrap_err();
    assert!(err.contains("PostgreSQL-only"), "{err}");
}

#[tokio::test]
#[ignore]
async fn get_available_extensions_on_postgresql_pool() {
    let (pm, id) = pool().await;
    let exts = get_available_extensions_inner(&pm, &id).await.unwrap();
    assert!(
        !exts.is_empty(),
        "pg_available_extensions should list built-ins"
    );
    assert!(
        exts.iter()
            .all(|e| !e.name.is_empty() && !e.version.is_empty()),
        "every extension needs name + default version: {exts:?}"
    );
}

#[tokio::test]
#[ignore]
async fn object_dependencies_for_table_includes_view() {
    let (pm, id) = pool().await;
    // demo has order_summary VIEW depending on orders — drop would break it
    let deps = get_object_dependencies_inner(&pm, &id, "public", "table", "orders")
        .await
        .unwrap();
    assert!(
        deps.iter()
            .any(|d| d.class.contains("pg_class") && d.name.contains("order_summary")),
        "view depending on orders should surface: {deps:?}"
    );
    // schema contents path
    let contents = get_object_dependencies_inner(&pm, &id, "public", "schema", "public")
        .await
        .unwrap();
    assert!(!contents.is_empty(), "public schema should list contents");
}

#[tokio::test]
#[ignore]
async fn get_roles_returns_current_role_and_memberships() {
    let (pm, id) = pool().await;
    let roles = crate::commands::objects::get_roles_inner(&pm, &id)
        .await
        .unwrap();
    assert!(
        roles.iter().any(|r| r.can_login),
        "at least one login role (the test user)"
    );
}

#[tokio::test]
#[ignore]
async fn rebuild_table_rolls_back_on_failure() {
    let (pm, id) = pool().await;
    // setup: a table with a PK + one row
    {
        let handle = pm.lock().await.acquire(&id).unwrap();
        if let crate::db::pool::DbHandle::Postgresql(c, _) = handle {
            let c = c.lock().await;
            c.batch_execute("DROP TABLE IF EXISTS rebuild_t; CREATE TABLE rebuild_t (id int PRIMARY KEY, v text); INSERT INTO rebuild_t VALUES (1,'a');").await.unwrap();
        }
    }
    // build a rebuild script whose final statement intentionally fails (syntax error)
    // so the whole transaction rolls back and rebuild_t keeps its row.
    let bad_script = "CREATE TABLE _gridline_rb_rebuild_t (id int PRIMARY KEY, v text); \
        INSERT INTO _gridline_rb_rebuild_t (id, v) SELECT id, v FROM rebuild_t; \
        DROP TABLE rebuild_t; \
        ALTER TABLE _gridline_rb_rebuild_t RENAME TO rebuild_t; \
        THIS IS NOT SQL;";
    let change = crate::models::db_viewer::Change::RebuildTable {
        id: "rb".into(),
        table: "rebuild_t".into(),
        sql: bad_script.to_string(),
    };
    let res = crate::commands::db_viewer::execute_change_inner(&pm, &id, change).await;
    assert!(
        res.is_err(),
        "expected rollback (transaction should fail on bad SQL)"
    );
    // table still intact
    let handle = pm.lock().await.acquire(&id).unwrap();
    if let crate::db::pool::DbHandle::Postgresql(c, _) = handle {
        let c = c.lock().await;
        let row = c
            .query_one("SELECT count(*) FROM rebuild_t", &[])
            .await
            .unwrap();
        assert_eq!(
            row.get::<_, i64>(0),
            1,
            "rollback must preserve the original table"
        );
        c.batch_execute("DROP TABLE rebuild_t").await.unwrap();
    }
}

#[tokio::test]
#[ignore = "requires live PG"]
async fn get_role_privileges_returns_grants_across_object_classes() {
    let (pm, id) = pool().await;
    let out = crate::commands::objects::get_role_privileges_inner(&pm, &id, "read_only")
        .await
        .unwrap_or_else(|e| panic!("privileges command failed: {e}"));
    let classes: std::collections::HashSet<String> =
        out.iter().map(|p| p.object_class.clone()).collect();
    assert!(classes.contains("table"), "expected a table grant: {out:?}");
    assert!(
        classes.contains("routine"),
        "expected a routine grant: {out:?}"
    );
    assert!(
        classes.contains("schema"),
        "expected a schema grant: {out:?}"
    );
    assert!(
        classes.contains("database"),
        "expected a database grant: {out:?}"
    );
}
