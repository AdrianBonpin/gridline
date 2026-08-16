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
async fn run_maintenance_analyze_succeeds() {
    let (pm, id) = pool().await;
    let res = crate::commands::maintenance::run_maintenance_inner(&pm, &id, "public", "pg_type", "analyze").await.unwrap();
    assert!(res.duration_ms >= 0);
    assert!(res.message.to_lowercase().contains("analyze"));
}