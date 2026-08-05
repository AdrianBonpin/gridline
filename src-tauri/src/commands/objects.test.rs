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