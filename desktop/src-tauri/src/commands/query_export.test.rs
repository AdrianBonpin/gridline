use super::*;
use sqlx::Connection;

#[test]
fn read_only_heuristic_matches_frontend_guard_set() {
    for sql in ["SELECT 1", "  with x as (select 1) select * from x", "-- note\nSELECT 1"] {
        assert!(is_read_only_sql(sql), "should allow: {sql}");
    }
    for sql in [
        "INSERT INTO t VALUES (1)",
        "update t set a = 1",
        "DELETE FROM t",
        "DROP TABLE t",
        "ALTER TABLE t ADD c int",
        "TRUNCATE t",
        "CREATE TABLE t (a int)",
        "REPLACE INTO t VALUES (1)",
    ] {
        assert!(!is_read_only_sql(sql), "should reject: {sql}");
    }
}

#[test]
fn csv_cell_quotes_and_guards_formula_injection() {
    assert_eq!(csv_cell(&serde_json::Value::String("plain".into())), "plain");
    assert_eq!(csv_cell(&serde_json::Value::String("a,b".into())), "\"a,b\"");
    assert_eq!(csv_cell(&serde_json::Value::String("a\"b".into())), "\"a\"\"b\"");
    assert_eq!(csv_cell(&serde_json::Value::String("a\nb".into())), "\"a\nb\"");
    assert_eq!(csv_cell(&serde_json::Value::String("=SUM(A1)".into())), "'=SUM(A1)");
    assert_eq!(csv_cell(&serde_json::Value::String("+x".into())), "'+x");
    assert_eq!(csv_cell(&serde_json::Value::String("-1".into())), "'-1");
    assert_eq!(csv_cell(&serde_json::Value::String("@cmd".into())), "'@cmd");
    assert_eq!(csv_cell(&serde_json::Value::Null), "");
    assert_eq!(csv_cell(&serde_json::json!(42)), "42");
}

#[test]
fn csv_line_bom_is_written_by_header_only() {
    let cols = vec![
        crate::models::db_viewer::ColumnInfo { name: "a".into(), data_type: "int".into(), is_nullable: true, is_pk: false, is_fk: false, fk_ref: None, default_value: None, editable: true, is_generated: false },
        crate::models::db_viewer::ColumnInfo { name: "b".into(), data_type: "text".into(), is_nullable: true, is_pk: false, is_fk: false, fk_ref: None, default_value: None, editable: true, is_generated: false },
    ];
    let line = csv_line(&cols, &[serde_json::json!("1"), serde_json::Value::Null]);
    assert_eq!(line, "1,");
}

#[test]
fn jsonl_line_encodes_row_object() {
    let cols = vec![crate::models::db_viewer::ColumnInfo { name: "a".into(), data_type: "int".into(), is_nullable: true, is_pk: false, is_fk: false, fk_ref: None, default_value: None, editable: true, is_generated: false }];
    let line = jsonl_line(&cols, &[serde_json::json!("x\"y")]);
    assert_eq!(line, "{\"a\":\"x\\\"y\"}");
}

#[test]
fn sqlite_export_streams_all_rows_with_bom_and_guard() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER, b TEXT);
         INSERT INTO t VALUES (1, 'plain');
         INSERT INTO t VALUES (2, '=SUM(A1)');
         INSERT INTO t VALUES (3, NULL);",
    )
    .unwrap();

    let path = std::env::temp_dir().join(format!("gridline-export-test-{}.csv", std::process::id()));
    let mut rows_seen = 0u64;
    let summary = run_sqlite_export(&conn, "SELECT a, b FROM t ORDER BY a", ExportFormat::Csv, &path, &mut |n| rows_seen = n)
        .expect("export runs");
    assert_eq!(summary.rows_written, 3);
    assert_eq!(rows_seen, 3);

    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "UTF-8 BOM first");
    let text = String::from_utf8_lossy(&bytes[3..]);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "a,b");
    assert_eq!(lines[1], "1,plain");
    assert_eq!(lines[2], "2,'=SUM(A1)");
    assert_eq!(lines[3], "3,");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn sqlite_export_rejects_write_statements_and_multi_statement() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    let path = std::env::temp_dir().join("gridline-export-should-not-exist.csv");
    let err = run_sqlite_export(&conn, "INSERT INTO t VALUES (1)", ExportFormat::Csv, &path, &mut |_| {})
        .expect_err("write SQL must be rejected");
    assert!(err.contains("read-only"), "got: {err}");
    let err = run_sqlite_export(&conn, "SELECT 1; SELECT 2", ExportFormat::Csv, &path, &mut |_| {})
        .expect_err("multi-statement must be rejected");
    assert!(err.contains("single"), "got: {err}");
    assert!(!path.exists(), "no partial file may be left behind");
}

#[test]
fn sqlite_export_error_deletes_partial_file() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1),(2),(3);").unwrap();
    let path = std::env::temp_dir().join(format!("gridline-export-partial-{}.csv", std::process::id()));
    let err = run_sqlite_export(&conn, "SELECT a, b FROM t", ExportFormat::Csv, &path, &mut |_| {})
        .expect_err("bad column must fail");
    assert!(!err.is_empty());
    assert!(!path.exists(), "partial file must be deleted on error");
}

/// Live PG export — mirror the env/client conventions of the live PG tests in
/// `commands/objects.test.rs`. Assert a cursor export of a 3-row table
/// produces the same 4 CSV lines as the SQLite test (BOM + header + rows).
#[tokio::test]
#[ignore]
async fn pg_export_live() {
    let h = match std::env::var("GRIDLINE_TEST_PG_HOST") {
        Ok(v) => v,
        Err(_) => return,
    };
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
    let _conn_task = tokio::spawn(async move {
        let _ = conn.await;
    });
    client
        .batch_execute(
            "DROP TABLE IF EXISTS gridline_export_test;
             CREATE TABLE gridline_export_test (a INTEGER, b TEXT);
             INSERT INTO gridline_export_test VALUES (1,'plain'),(2,'=SUM(A1)'),(3,NULL);",
        )
        .await
        .expect("setup");

    let path = std::env::temp_dir().join(format!("gridline-export-pg-{}.csv", std::process::id()));
    let mut rows_seen = 0u64;
    let summary = run_pg_export(
        &client,
        "SELECT a, b FROM gridline_export_test ORDER BY a",
        ExportFormat::Csv,
        &path,
        &mut |n| rows_seen = n,
    )
    .await
    .expect("export runs");
    assert_eq!(summary.rows_written, 3);
    assert_eq!(rows_seen, 3);

    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "UTF-8 BOM first");
    let text = String::from_utf8_lossy(&bytes[3..]);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "a,b");
    assert_eq!(lines[1], "1,plain");
    assert_eq!(lines[2], "2,'=SUM(A1)");
    assert_eq!(lines[3], "3,");
    let _ = std::fs::remove_file(&path);
    let _ = client.batch_execute("DROP TABLE IF EXISTS gridline_export_test").await;
}

/// Live MySQL export — mirror the env conventions of the MySQL live tests in
/// `commands/db_viewer.rs` (GRIDLINE_TEST_MYSQL_*). Same assertions.
#[tokio::test]
#[ignore]
async fn mysql_export_live() {
    let host = match std::env::var("GRIDLINE_TEST_MYSQL_HOST") {
        Ok(v) => v,
        Err(_) => return,
    };
    let port: u16 = std::env::var("GRIDLINE_TEST_MYSQL_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3306);
    let user = std::env::var("GRIDLINE_TEST_MYSQL_USER").unwrap_or_else(|_| "root".into());
    let pass = std::env::var("GRIDLINE_TEST_MYSQL_PASS").unwrap_or_default();
    let db = match std::env::var("GRIDLINE_TEST_MYSQL_DB") {
        Ok(v) => v,
        Err(_) => return,
    };
    let opts = sqlx::mysql::MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&user)
        .password(&pass)
        .database(&db);
    let mut conn = sqlx::mysql::MySqlConnection::connect_with(&opts)
        .await
        .expect("connect to test MySQL");
    sqlx::query("DROP TABLE IF EXISTS gridline_export_test")
        .execute(&mut conn)
        .await
        .ok();
    sqlx::query("CREATE TABLE gridline_export_test (a INT, b TEXT)")
        .execute(&mut conn)
        .await
        .expect("create");
    sqlx::query("INSERT INTO gridline_export_test VALUES (1,'plain'),(2,'=SUM(A1)'),(3,NULL)")
        .execute(&mut conn)
        .await
        .expect("insert");

    let path = std::env::temp_dir().join(format!("gridline-export-mysql-{}.csv", std::process::id()));
    let mut rows_seen = 0u64;
    let summary = run_mysql_export(
        &mut conn,
        "SELECT a, b FROM gridline_export_test ORDER BY a",
        ExportFormat::Csv,
        &path,
        &mut |n| rows_seen = n,
    )
    .await
    .expect("export runs");
    assert_eq!(summary.rows_written, 3);
    assert_eq!(rows_seen, 3);

    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "UTF-8 BOM first");
    let text = String::from_utf8_lossy(&bytes[3..]);
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "a,b");
    assert_eq!(lines[1], "1,plain");
    assert_eq!(lines[2], "2,'=SUM(A1)");
    assert_eq!(lines[3], "3,");
    let _ = std::fs::remove_file(&path);
    let _ = sqlx::query("DROP TABLE IF EXISTS gridline_export_test")
        .execute(&mut conn)
        .await;
}
