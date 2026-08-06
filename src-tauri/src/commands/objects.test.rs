use super::*;
use crate::db::pool::{ConnectionPoolManager, DbHandle};

/// Connect directly via tokio-postgres (no tunnel) so tests are Tauri-free.
async fn pool() -> (tokio::sync::Mutex<ConnectionPoolManager>, String) {
    let h = std::env::var("GRIDLINE_TEST_PG_HOST").expect("set GRIDLINE_TEST_PG_HOST");
    let p: u16 = std::env::var("GRIDLINE_TEST_PG_PORT").unwrap_or_else(|_| "5432".into()).parse().unwrap();
    let u = std::env::var("GRIDLINE_TEST_PG_USER").expect("set GRIDLINE_TEST_PG_USER");
    let d = std::env::var("GRIDLINE_TEST_PG_DB").expect("set GRIDLINE_TEST_PG_DB");
    let pw = std::env::var("GRIDLINE_TEST_PG_PASSWORD").unwrap_or_default();
    let (client, conn) = tokio_postgres::connect(
        &format!("host={h} port={p} user={u} dbname={d} password={pw}"),
        tokio_postgres::NoTls,
    ).await.expect("connect to test PG");
    let handle = tokio::spawn(async move { let _ = conn.await; });
    let mut pm = ConnectionPoolManager::new();
    let id = "test-conn".to_string();
    pm.register(&id, DbHandle::Postgresql(client, handle));
    (tokio::sync::Mutex::new(pm), id)
}

#[tokio::test]
#[ignore]
async fn schema_crud_create_rename_drop() {
    let (pm, id) = pool().await;
    let name = "gridline_test_schema";
    create_schema_inner(&pm, &id, name).await.unwrap();
    assert!(create_schema_inner(&pm, &id, name).await.is_err(), "duplicate should error");
    rename_schema_inner(&pm, &id, name, "gridline_test_schema2").await.unwrap();
    drop_schema_inner(&pm, &id, "gridline_test_schema2", false).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn search_objects_finds_table_and_function() {
    let (pm, id) = pool().await;
    let hits = search_objects_inner(&pm, &id, "public", "users").await.unwrap();
    assert!(hits.iter().any(|h| h.name == "users" && h.object_type == "TABLE"), "demo has a users table");
    let fns = search_objects_inner(&pm, &id, "public", "get").await.unwrap();
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
    let seq = get_object_ddl_inner(&pm, &id, "public", "sequence", "users_id_seq").await.unwrap();
    assert!(seq.starts_with("CREATE SEQUENCE"), "{seq}");
    // function: pg_get_functiondef passthrough
    let f = get_object_ddl_inner(&pm, &id, "public", "function", "audit_log").await; // name per demo
    assert!(f.is_ok());
    assert!(f.clone().unwrap().contains("CREATE FUNCTION") || f.unwrap().contains("CREATE OR REPLACE FUNCTION"));
}

#[tokio::test]
async fn build_object_ddl_inner_guards_postgresql_only() {
    let pm = tokio::sync::Mutex::new(ConnectionPoolManager::new());
    // Missing connection -> Connection not found
    let err = build_object_ddl_inner(&pm, "missing", "sequence", serde_json::json!({
        "schema": "public", "name": "s", "action": { "op": "drop" }
    })).await.unwrap_err();
    assert!(err.contains("Connection not found"), "{err}");
    // Non-PostgreSQL handle -> PostgreSQL-only error
    pm.lock().await.register("sqlite", DbHandle::Sqlite(rusqlite::Connection::open_in_memory().unwrap()));
    let err = build_object_ddl_inner(&pm, "sqlite", "sequence", serde_json::json!({
        "schema": "public", "name": "s", "action": { "op": "drop" }
    })).await.unwrap_err();
    assert!(err.contains("PostgreSQL-only"), "{err}");
}

#[tokio::test]
#[ignore]
async fn build_object_ddl_inner_on_postgresql_pool() {
    let (pm, id) = pool().await;
    let sql = build_object_ddl_inner(&pm, &id, "sequence", serde_json::json!({
        "schema": "public", "name": "s", "action": { "op": "drop" }
    })).await.unwrap();
    assert_eq!(sql, vec!["DROP SEQUENCE \"public\".\"s\""]);
}

#[tokio::test]
async fn get_available_extensions_inner_guards_postgresql_only() {
    let pm = tokio::sync::Mutex::new(ConnectionPoolManager::new());
    // Missing connection -> Connection not found
    let err = get_available_extensions_inner(&pm, "missing").await.unwrap_err();
    assert!(err.contains("Connection not found"), "{err}");
    // Non-PostgreSQL handle -> PostgreSQL-only error
    pm.lock().await.register("sqlite", DbHandle::Sqlite(rusqlite::Connection::open_in_memory().unwrap()));
    let err = get_available_extensions_inner(&pm, "sqlite").await.unwrap_err();
    assert!(err.contains("PostgreSQL-only"), "{err}");
}

#[tokio::test]
#[ignore]
async fn get_available_extensions_on_postgresql_pool() {
    let (pm, id) = pool().await;
    let exts = get_available_extensions_inner(&pm, &id).await.unwrap();
    assert!(!exts.is_empty(), "pg_available_extensions should list built-ins");
    assert!(exts.iter().all(|e| !e.name.is_empty() && !e.version.is_empty()), "every extension needs name + default version: {exts:?}");
}

#[tokio::test]
#[ignore]
async fn object_dependencies_for_table_includes_view() {
    let (pm, id) = pool().await;
    // demo has order_summary VIEW depending on orders — drop would break it
    let deps = get_object_dependencies_inner(&pm, &id, "public", "table", "orders").await.unwrap();
    assert!(deps.iter().any(|d| d.class.contains("pg_class") && d.name.contains("order_summary")), "view depending on orders should surface: {deps:?}");
    // schema contents path
    let contents = get_object_dependencies_inner(&pm, &id, "public", "schema", "public").await.unwrap();
    assert!(!contents.is_empty(), "public schema should list contents");
}

#[tokio::test]
#[ignore]
async fn rebuild_table_rolls_back_on_failure() {
    let (pm, id) = pool().await;
    // setup: a table with a PK + one row
    {
        let mut g = pm.lock().await;
        if let crate::db::pool::DbHandle::Postgresql(c, _) = g.get(&id).unwrap() {
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
    let change = crate::models::db_viewer::Change::RebuildTable { id: "rb".into(), sql: bad_script.to_string() };
    let res = crate::commands::db_viewer::execute_change_inner(&pm, &id, change).await;
    assert!(res.is_err(), "expected rollback (transaction should fail on bad SQL)");
    // table still intact
    let mut g = pm.lock().await;
    if let crate::db::pool::DbHandle::Postgresql(c, _) = g.get(&id).unwrap() {
        let row = c.query_one("SELECT count(*) FROM rebuild_t", &[]).await.unwrap();
        assert_eq!(row.get::<_, i64>(0), 1, "rollback must preserve the original table");
        c.batch_execute("DROP TABLE rebuild_t").await.unwrap();
    }
}
