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
