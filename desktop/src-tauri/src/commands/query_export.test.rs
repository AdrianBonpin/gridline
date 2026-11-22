use super::*;
use sqlx::Connection;

const ENGINES: [ReadOnlyEngine; 3] = [
    ReadOnlyEngine::PostgreSql,
    ReadOnlyEngine::MySql,
    ReadOnlyEngine::Sqlite,
];

fn temp_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("gridline-export-{tag}-{}.csv", std::process::id()))
}

/// The rejection message for a statement the export gate must refuse.
fn rejection(engine: ReadOnlyEngine, sql: &str) -> String {
    validate_export_request(engine, sql, &temp_path("gate"))
        .err()
        .unwrap_or_else(|| panic!("{engine:?} must not export {sql:?}"))
}

// ── Format writers (pure) ─────────────────────────────────────────

#[test]
fn csv_cell_quotes_and_guards_formula_injection() {
    assert_eq!(
        csv_cell(&serde_json::Value::String("plain".into())),
        "plain"
    );
    assert_eq!(
        csv_cell(&serde_json::Value::String("a,b".into())),
        "\"a,b\""
    );
    assert_eq!(
        csv_cell(&serde_json::Value::String("a\"b".into())),
        "\"a\"\"b\""
    );
    assert_eq!(
        csv_cell(&serde_json::Value::String("a\nb".into())),
        "\"a\nb\""
    );
    assert_eq!(
        csv_cell(&serde_json::Value::String("=SUM(A1)".into())),
        "'=SUM(A1)"
    );
    assert_eq!(csv_cell(&serde_json::Value::String("+x".into())), "'+x");
    assert_eq!(csv_cell(&serde_json::Value::String("-1".into())), "'-1");
    assert_eq!(csv_cell(&serde_json::Value::String("@cmd".into())), "'@cmd");
    assert_eq!(csv_cell(&serde_json::Value::Null), "");
    assert_eq!(csv_cell(&serde_json::json!(42)), "42");
}

#[test]
fn csv_line_bom_is_written_by_header_only() {
    let cols = vec![
        crate::models::db_viewer::ColumnInfo {
            name: "a".into(),
            data_type: "int".into(),
            is_nullable: true,
            is_pk: false,
            is_fk: false,
            fk_ref: None,
            default_value: None,
            editable: true,
            is_generated: false,
        },
        crate::models::db_viewer::ColumnInfo {
            name: "b".into(),
            data_type: "text".into(),
            is_nullable: true,
            is_pk: false,
            is_fk: false,
            fk_ref: None,
            default_value: None,
            editable: true,
            is_generated: false,
        },
    ];
    let line = csv_line(&cols, &[serde_json::json!("1"), serde_json::Value::Null]);
    assert_eq!(line, "1,");
}

#[test]
fn jsonl_line_encodes_row_object() {
    let cols = vec![crate::models::db_viewer::ColumnInfo {
        name: "a".into(),
        data_type: "int".into(),
        is_nullable: true,
        is_pk: false,
        is_fk: false,
        fk_ref: None,
        default_value: None,
        editable: true,
        is_generated: false,
    }];
    let line = jsonl_line(&cols, &[serde_json::json!("x\"y")]);
    assert_eq!(line, "{\"a\":\"x\\\"y\"}");
}

// ── Export gate: rejected shapes, on every engine ─────────────────

#[test]
fn export_rejects_leading_comment_writes_on_every_engine() {
    for engine in ENGINES {
        for (sql, verb) in [
            ("-- nightly clean-up\nDELETE FROM sessions", "DELETE"),
            ("/* audit */ UPDATE users SET admin = 1", "UPDATE"),
            (
                "-- one\n/* two */\nINSERT INTO audit (msg) VALUES ('x')",
                "INSERT",
            ),
        ] {
            let error = rejection(engine, sql);
            assert!(
                error.contains(engine.as_str()),
                "the rejection must name the engine, got: {error}"
            );
            assert!(
                error.contains(verb),
                "{engine:?} must name {verb} as the offending verb, got: {error}"
            );
            assert!(
                error.contains("read-only"),
                "the rejection must say export is read-only, got: {error}"
            );
        }
    }
}

#[test]
fn export_rejects_mysql_executable_comment_writes_on_every_engine() {
    for engine in ENGINES {
        for (sql, verb) in [
            ("/*!40000 UPDATE users SET admin = 1 */", "UPDATE"),
            ("/*!40101 DELETE FROM sessions */", "DELETE"),
            (
                "/* leading */ /*!50000 INSERT INTO audit VALUES (1) */",
                "INSERT",
            ),
        ] {
            let error = rejection(engine, sql);
            assert!(
                error.contains(verb),
                "{engine:?} must name {verb} inside the executable comment, got: {error}"
            );
            assert!(error.contains("read-only"), "got: {error}");
        }
    }
}

#[test]
fn export_rejects_data_modifying_ctes_on_every_engine() {
    for engine in ENGINES {
        for (sql, verb) in [
            (
                "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
                "DELETE",
            ),
            (
                "WITH u AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM u",
                "INSERT",
            ),
            (
                "WITH x AS (SELECT 1), u AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM u",
                "UPDATE",
            ),
        ] {
            let error = rejection(engine, sql);
            assert!(
                error.contains("data-modifying CTE"),
                "{engine:?} must explain the write is in the CTE, got: {error}"
            );
            assert!(
                error.contains(verb),
                "{engine:?} must name {verb} inside the CTE, got: {error}"
            );
            assert!(error.contains("read-only"), "got: {error}");
        }
    }
}

#[test]
fn export_rejects_writes_wrapped_in_explain_on_every_engine() {
    for engine in ENGINES {
        for (sql, verb) in [
            ("EXPLAIN ANALYZE DELETE FROM sessions", "DELETE"),
            (
                "EXPLAIN (ANALYZE, BUFFERS) INSERT INTO audit VALUES (1)",
                "INSERT",
            ),
            ("EXPLAIN ANALYZE UPDATE users SET admin = 1", "UPDATE"),
        ] {
            let error = rejection(engine, sql);
            assert!(
                error.contains("EXPLAIN wraps") && error.contains(verb),
                "{engine:?} must name the wrapped {verb}, got: {error}"
            );
            assert!(error.contains("read-only"), "got: {error}");
        }
    }
}

/// The shared classifier answers "does this write?" for the destructive-query
/// prompt, and several commands legitimately answer "no" — but they are not
/// queries whose result set can be exported. The export gate is narrower on
/// purpose and says so.
#[test]
fn export_rejects_read_classified_statements_that_are_not_exportable_queries() {
    for engine in ENGINES {
        for sql in [
            "VACUUM",
            "REINDEX TABLE users",
            "SET statement_timeout = 1000",
            "BEGIN",
            "COMMIT",
            "LOCK TABLE users IN ACCESS EXCLUSIVE MODE",
        ] {
            let error = rejection(engine, sql);
            assert!(
                error.contains(engine.as_str()),
                "the rejection must name the engine, got: {error}"
            );
            assert!(
                error.contains("not an exportable read query"),
                "{engine:?} must say why {sql:?} is not exportable, got: {error}"
            );
            assert!(error.contains("read-only"), "got: {error}");
        }
    }
}

/// A verb that is a genuine read on one engine is not exportable on another:
/// the allowlist is per engine, so the failure is a named refusal at the gate
/// rather than a syntax error from the server.
#[test]
fn export_allowlist_is_engine_appropriate() {
    for (engine, sql, verb) in [
        (ReadOnlyEngine::Sqlite, "SHOW TABLES", "SHOW"),
        (ReadOnlyEngine::Sqlite, "DESCRIBE users", "DESCRIBE"),
        (ReadOnlyEngine::Sqlite, "TABLE users", "TABLE"),
        (
            ReadOnlyEngine::PostgreSql,
            "PRAGMA table_info(users)",
            "PRAGMA",
        ),
        (ReadOnlyEngine::PostgreSql, "DESCRIBE users", "DESCRIBE"),
        (ReadOnlyEngine::MySql, "PRAGMA table_info(users)", "PRAGMA"),
    ] {
        let error = rejection(engine, sql);
        assert!(
            error.contains(verb) && error.contains("not an exportable read query"),
            "{engine:?} must refuse {verb} by name, got: {error}"
        );
        assert!(error.contains(engine.as_str()), "got: {error}");
    }
}

#[test]
fn export_rejects_schema_unknown_and_multi_statement_scripts_on_every_engine() {
    for engine in ENGINES {
        let error = rejection(engine, "DROP TABLE users");
        assert!(
            error.contains("DROP") && error.contains("schema"),
            "got: {error}"
        );

        let error = rejection(engine, "CALL refresh_stats()");
        assert!(error.contains("cannot be proven read-only"), "got: {error}");

        let error = rejection(engine, "SELECT 1; DELETE FROM users");
        assert!(error.contains("single statement"), "got: {error}");

        let error = rejection(engine, "   -- only a comment\n");
        assert!(error.contains("no statement"), "got: {error}");
    }
}

#[test]
fn export_rejects_a_relative_output_path_on_every_engine() {
    for engine in ENGINES {
        let error = validate_export_request(engine, "SELECT 1", Path::new("relative.csv"))
            .expect_err("a relative path is not an export destination");
        assert!(error.contains("absolute"), "got: {error}");
    }
}

// ── Export gate: genuine reads still work, on every engine ────────

fn genuine_read_queries(engine: ReadOnlyEngine) -> Vec<&'static str> {
    let shared = vec![
        "SELECT 1",
        "select a, b from t order by a",
        "-- a leading comment is not a statement\nSELECT 1",
        "WITH cte AS (SELECT 1) SELECT * FROM cte",
        "VALUES (1)",
    ];
    let engine_specific: Vec<&'static str> = match engine {
        ReadOnlyEngine::PostgreSql => vec![
            "SHOW search_path",
            "EXPLAIN ANALYZE SELECT 1",
            "SELECT current_setting('transaction_read_only')",
            "TABLE users",
        ],
        ReadOnlyEngine::MySql => vec![
            "SHOW TABLES",
            "DESCRIBE users",
            "EXPLAIN SELECT * FROM users",
            "SELECT @@transaction_read_only",
        ],
        ReadOnlyEngine::Sqlite => vec![
            "PRAGMA table_info(users)",
            "SELECT query_only FROM pragma_query_only",
            "EXPLAIN QUERY PLAN SELECT 1",
        ],
    };
    shared.into_iter().chain(engine_specific).collect()
}

#[test]
fn export_accepts_genuine_read_queries_on_every_engine() {
    for engine in ENGINES {
        for sql in genuine_read_queries(engine) {
            let request = validate_export_request(engine, sql, &temp_path("read"))
                .unwrap_or_else(|e| panic!("{engine:?} must accept {sql:?}: {e}"));
            assert_eq!(request.engine(), engine);
            assert!(!request.sql().trim().is_empty());
        }
    }
}

/// What the export runs is exactly what was classified — not a re-parsed or
/// re-joined version of the user's text.
#[test]
fn export_runs_the_classified_statement_text() {
    let request = validate_export_request(
        ReadOnlyEngine::PostgreSql,
        "  SELECT 1;\n",
        &temp_path("classified"),
    )
    .expect("read query accepted");
    assert_eq!(request.sql(), "SELECT 1");
}

// ── SQLite: the backend path is enforced end to end ───────────────

#[tokio::test]
async fn sqlite_export_streams_all_rows_with_bom_and_guard() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER, b TEXT);
         INSERT INTO t VALUES (1, 'plain');
         INSERT INTO t VALUES (2, '=SUM(A1)');
         INSERT INTO t VALUES (3, NULL);",
    )
    .unwrap();

    let path = temp_path("stream");
    let mut rows_seen = 0u64;
    let summary = run_sqlite_export(
        &mut conn,
        "SELECT a, b FROM t ORDER BY a",
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
}

/// The SQLite export must run the statement under `PRAGMA query_only`, which is
/// observable from inside the exported query itself.
#[tokio::test]
async fn sqlite_export_runs_inside_query_only_and_restores_it() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    let path = temp_path("query-only");
    let summary = run_sqlite_export(
        &mut conn,
        "SELECT query_only FROM pragma_query_only",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect("export runs");
    assert_eq!(summary.rows_written, 1);

    let bytes = std::fs::read(&path).unwrap();
    let text = String::from_utf8_lossy(&bytes[3..]).to_string();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "query_only");
    assert_eq!(
        lines[1], "1",
        "the exported statement must run with SQLite's read-only enforcement on"
    );
    let _ = std::fs::remove_file(&path);

    let restored: i64 = conn
        .query_row("SELECT query_only FROM pragma_query_only", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(
        restored, 0,
        "the connection is usable for writes afterwards"
    );
}

/// The exact function `export_query_to_file` calls, with no frontend in the
/// picture: every shape that could write is refused before a file exists, and a
/// genuine read still exports through the same dispatch.
#[tokio::test]
async fn dispatcher_rejects_writes_and_accepts_reads_without_any_frontend_help() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER, b TEXT);
         INSERT INTO t VALUES (1, 'only');",
    )
    .unwrap();
    let mut handle = crate::db::pool::DbHandle::sqlite(conn);

    let path = temp_path("dispatcher");
    for sql in [
        "-- sneaky\nDELETE FROM t",
        "/* block */ /*!40000 UPDATE t SET b = 'x' */",
        "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
        "EXPLAIN ANALYZE DELETE FROM t",
        "VACUUM",
        "DROP TABLE t",
        "SELECT 1; DELETE FROM t",
    ] {
        let error = run_export_query(&mut handle, sql, ExportFormat::Csv, &path, &mut |_| {})
            .await
            .expect_err("the dispatcher backend path must refuse this statement");
        assert!(error.contains("SQLite"), "got: {error}");
        assert!(
            error.contains("read-only") || error.contains("single statement"),
            "the refusal must say why, got: {error}"
        );
        assert!(!path.exists(), "a rejected export leaves no file: {sql:?}");
    }

    // Same dispatch, genuine read: it exports, and the write-capable shapes it
    // refused above changed nothing.
    let summary = run_export_query(
        &mut handle,
        "SELECT a, b FROM t ORDER BY a",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect("a genuine read exports through the dispatcher");
    assert_eq!(summary.rows_written, 1);
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("only"), "got: {text}");
    let _ = std::fs::remove_file(&path);

    let crate::db::pool::DbHandle::Sqlite(shared) = &handle else {
        unreachable!("handle is SQLite")
    };
    let conn = shared.try_lock().expect("sqlite connection is free");
    let rows: i64 = conn
        .query_row("SELECT count(*) FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 1, "no row was deleted, updated, or inserted");
    let value: String = conn
        .query_row("SELECT b FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "only", "no row was updated");
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 't'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1, "the table was not dropped");
}

#[tokio::test]
async fn sqlite_export_rejects_multi_statement_scripts() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    let path = temp_path("multi");
    let error = run_sqlite_export(
        &mut conn,
        "SELECT 1; SELECT 2",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect_err("multi-statement must be rejected");
    assert!(error.contains("single statement"), "got: {error}");
    assert!(!path.exists(), "no partial file may be left behind");
}

/// A backend invocation that never touched the frontend analysis at all: the
/// write is refused before the file is created and the database is untouched.
#[tokio::test]
async fn backend_export_path_rejects_writes_without_any_frontend_help() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER);
         INSERT INTO t VALUES (1);",
    )
    .unwrap();

    let path = temp_path("direct");
    for sql in [
        "-- sneaky\nDELETE FROM t",
        "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
        "/*!40000 DELETE FROM t */",
        "DROP TABLE t",
        "INSERT INTO t VALUES (2)",
    ] {
        let error = run_sqlite_export(&mut conn, sql, ExportFormat::Csv, &path, &mut |_| {})
            .await
            .expect_err("the backend export path must refuse this statement");
        assert!(error.contains("SQLite"), "got: {error}");
        assert!(error.contains("read-only"), "got: {error}");
        assert!(!path.exists(), "a rejected export leaves no file: {sql:?}");
    }

    let rows: i64 = conn
        .query_row("SELECT count(*) FROM t", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows, 1, "no row was deleted or inserted");
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 't'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 1, "the table was not dropped");
}

#[tokio::test]
async fn sqlite_export_error_deletes_partial_file() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1),(2),(3);")
        .unwrap();
    let path = temp_path("partial");
    let error = run_sqlite_export(
        &mut conn,
        "SELECT a, b FROM t",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect_err("bad column must fail");
    assert!(!error.is_empty());
    assert!(!path.exists(), "partial file must be deleted on error");
}

// ── Live engines: the mechanism is the server's, not a claim ──────

/// Live PG export — mirror the env/client conventions of the live PG tests in
/// `commands/objects.test.rs`. Asserts the CSV shape, that the export ran inside
/// a server-side read-only transaction, and that the server refuses a write
/// there.
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
    // Omit the password when the server authenticates without one: an empty
    // `password=` is a connect-string parse error, not a credential.
    let mut config = format!("host={h} port={p} user={u} dbname={d}");
    if let Ok(pw) = std::env::var("GRIDLINE_TEST_PG_PASSWORD") {
        if !pw.is_empty() {
            config.push_str(&format!(" password={pw}"));
        }
    }
    let (mut client, conn) = tokio_postgres::connect(&config, tokio_postgres::NoTls)
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

    let path = temp_path("pg");
    let mut rows_seen = 0u64;
    let summary = run_pg_export(
        &mut client,
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

    // Server-side proof: inside the export session the transaction is read-only
    // and the server refuses a write.
    let flag_path = temp_path("pg-flag");
    run_pg_export(
        &mut client,
        "SELECT current_setting('transaction_read_only') AS ro",
        ExportFormat::Csv,
        &flag_path,
        &mut |_| {},
    )
    .await
    .expect("flag export runs");
    let flag_bytes = std::fs::read(&flag_path).unwrap();
    let flag_text = String::from_utf8_lossy(&flag_bytes[3..]).to_string();
    assert_eq!(
        flag_text.lines().nth(1),
        Some("on"),
        "the export statement must run in a read-only transaction"
    );
    let _ = std::fs::remove_file(&flag_path);

    let mut session =
        crate::db::read_only::ReadOnlySession::start(&mut client, ReadOnlyEngine::PostgreSql)
            .await
            .expect("read-only session");
    let write = session
        .conn()
        .simple_query("DELETE FROM gridline_export_test")
        .await;
    assert!(write.is_err(), "the server must refuse a write");
    session.finish().await.expect("session closes");

    // A write request never reaches the server at all.
    let rejected = run_pg_export(
        &mut client,
        "DELETE FROM gridline_export_test",
        ExportFormat::Csv,
        &temp_path("pg-write"),
        &mut |_| {},
    )
    .await;
    assert!(rejected.is_err());

    let _ = client
        .batch_execute("DROP TABLE IF EXISTS gridline_export_test")
        .await;
}

/// Live MySQL export — mirror the env conventions of the MySQL live tests in
/// `commands/db_viewer.rs` (GRIDLINE_TEST_MYSQL_*). Same assertions, plus the
/// server-side read-only transaction proof.
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

    let path = temp_path("mysql");
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

    // The exported statement runs inside the transaction the session opened.
    // `@@transaction_read_only` is deliberately not used: it reports the
    // session default, not the current transaction, so it stays 0 inside
    // `START TRANSACTION READ ONLY`. `@@in_transaction` is the honest signal.
    let flag_path = temp_path("mysql-flag");
    run_mysql_export(
        &mut conn,
        "SELECT @@in_transaction AS in_tx",
        ExportFormat::Csv,
        &flag_path,
        &mut |_| {},
    )
    .await
    .expect("flag export runs");
    let flag_bytes = std::fs::read(&flag_path).unwrap();
    let flag_text = String::from_utf8_lossy(&flag_bytes[3..]).to_string();
    assert_eq!(
        flag_text.lines().nth(1),
        Some("1"),
        "the export statement must run inside the read-only transaction"
    );
    let _ = std::fs::remove_file(&flag_path);

    // The mechanism is the server's: a DML write is refused while the session
    // is open and accepted once it closes, so the refusal is the read-only
    // transaction rather than a privilege or a client-side check. (DDL
    // implicitly commits, which is why the gate — not this mechanism — is what
    // keeps a schema change out of export.)
    let mut session =
        crate::db::read_only::ReadOnlySession::start(&mut conn, ReadOnlyEngine::MySql)
            .await
            .expect("read-only session");
    let write = sqlx::query("INSERT INTO gridline_export_test VALUES (99, 'x')")
        .execute(session.conn())
        .await;
    assert!(write.is_err(), "the server must refuse a write");
    session.finish().await.expect("session closes");
    sqlx::query("INSERT INTO gridline_export_test VALUES (99, 'x')")
        .execute(&mut conn)
        .await
        .expect("the connection is writable again after the session closes");
    sqlx::query("DELETE FROM gridline_export_test WHERE a = 99")
        .execute(&mut conn)
        .await
        .expect("cleanup");

    // A write request never reaches the server at all.
    let rejected = run_mysql_export(
        &mut conn,
        "DELETE FROM gridline_export_test",
        ExportFormat::Csv,
        &temp_path("mysql-write"),
        &mut |_| {},
    )
    .await;
    assert!(rejected.is_err());

    // Neither does a schema change.
    let rejected = run_mysql_export(
        &mut conn,
        "CREATE TABLE gridline_export_should_not_exist (a INT)",
        ExportFormat::Csv,
        &temp_path("mysql-ddl"),
        &mut |_| {},
    )
    .await;
    assert!(rejected.is_err());

    let rejected = run_mysql_export(
        &mut conn,
        "DELETE FROM gridline_export_test",
        ExportFormat::Csv,
        &temp_path("mysql-write"),
        &mut |_| {},
    )
    .await;
    assert!(rejected.is_err());

    let _ = sqlx::query("DROP TABLE IF EXISTS gridline_export_test")
        .execute(&mut conn)
        .await;
}

// ── Export destination is authorized by a Write File Grant ────────

#[test]
fn a_raw_renderer_path_authorizes_no_export_output() {
    let grants = crate::file_grant::FileGrantStore::new();

    // The exact string a pre-fix renderer sent as the export `path`.
    let err = resolve_export_output(&grants, "/tmp/renderer-chosen.csv").unwrap_err();

    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "a bare path must be rejected as an invalid grant, got: {err}"
    );
}

#[test]
fn an_export_grant_resolves_its_destination_exactly_once() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        PathBuf::from("/tmp/gridline-granted.csv"),
        crate::file_grant::FileIntent::Write,
    );

    assert_eq!(
        resolve_export_output(&grants, &grant.id).unwrap(),
        PathBuf::from("/tmp/gridline-granted.csv")
    );

    let replay = resolve_export_output(&grants, &grant.id).unwrap_err();
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "a replayed grant must report the consumed state, got: {replay}"
    );
}

#[test]
fn a_read_grant_cannot_authorize_an_export_write() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        PathBuf::from("/tmp/restore-input.dump"),
        crate::file_grant::FileIntent::Read,
    );

    let err = resolve_export_output(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "a read grant must not authorize an export write, got: {err}"
    );
}

#[test]
fn an_expired_export_grant_reports_the_expired_state() {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let base = std::time::Instant::now();
    let elapsed = Arc::new(AtomicU64::new(0));
    let clock: crate::file_grant::Clock = {
        let elapsed = elapsed.clone();
        Box::new(move || base + std::time::Duration::from_millis(elapsed.load(Ordering::SeqCst)))
    };
    let grants = crate::file_grant::FileGrantStore::with_clock(crate::file_grant::GRANT_TTL, clock);
    let grant = grants.mint(
        PathBuf::from("/tmp/stale.csv"),
        crate::file_grant::FileIntent::Write,
    );

    elapsed.store(5 * 60 * 1000 + 1, Ordering::SeqCst);

    let err = resolve_export_output(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_EXPIRED),
        "an expired grant must report the expired state, got: {err}"
    );
}

/// Every sibling of `path` that this export wrote as its own temporary output.
fn partial_siblings(path: &Path) -> Vec<PathBuf> {
    let dir = path.parent().expect("temp path has a parent");
    let name = path
        .file_name()
        .expect("temp path names a file")
        .to_string_lossy()
        .to_string();
    let prefix = format!(".{name}");
    std::fs::read_dir(dir)
        .expect("temp dir is readable")
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|candidate| {
            candidate
                .file_name()
                .map(|n| n.to_string_lossy().starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect()
}

/// The acceptance criterion for a failed export: its temporary output is gone
/// and a pre-existing destination is byte-for-byte intact.
#[tokio::test]
async fn a_failed_export_keeps_the_prior_destination_and_removes_its_temporary_output() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER);
         INSERT INTO t VALUES (1),(2),(3);",
    )
    .unwrap();

    let path = temp_path("atomic-fail");
    std::fs::write(&path, b"prior contents").unwrap();

    // `b` does not exist, so the export fails after it has started writing.
    let error = run_sqlite_export(
        &mut conn,
        "SELECT a, b FROM t",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect_err("bad column must fail");
    assert!(!error.is_empty());

    assert_eq!(
        std::fs::read(&path).unwrap(),
        b"prior contents",
        "a failed export must leave the prior destination untouched"
    );
    assert!(
        partial_siblings(&path).is_empty(),
        "a failed export must remove its own temporary output"
    );
    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn a_successful_export_replaces_the_prior_destination_and_leaves_no_temporary_output() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER);
         INSERT INTO t VALUES (1),(2),(3);",
    )
    .unwrap();

    let path = temp_path("atomic-publish");
    std::fs::write(&path, b"stale destination").unwrap();

    let summary = run_sqlite_export(
        &mut conn,
        "SELECT a FROM t ORDER BY a",
        ExportFormat::Csv,
        &path,
        &mut |_| {},
    )
    .await
    .expect("export runs");
    assert_eq!(summary.rows_written, 3);

    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(&[0xEF, 0xBB, 0xBF]), "UTF-8 BOM first");
    let text = String::from_utf8_lossy(&bytes[3..]).to_string();
    assert_eq!(text.lines().collect::<Vec<_>>(), vec!["a", "1", "2", "3"]);
    assert!(
        partial_siblings(&path).is_empty(),
        "a published export must not leave its temporary output behind"
    );
    let _ = std::fs::remove_file(&path);
}
