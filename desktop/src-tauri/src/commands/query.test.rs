use super::*;

// ── statement_kind / affected_from_tag (pure) ──────────────────────

#[test]
fn statement_kind_classifies_by_first_keyword() {
    assert_eq!(statement_kind("SELECT 1"), "select");
    assert_eq!(statement_kind("  with c as (select 1) select * from c"), "select");
    assert_eq!(statement_kind("insert into t values (1)"), "dml");
    assert_eq!(statement_kind("UPDATE t SET a=1"), "dml");
    assert_eq!(statement_kind("DELETE FROM t"), "dml");
    assert_eq!(statement_kind("CREATE TABLE t (a int)"), "ddl");
    assert_eq!(statement_kind("-- c\nDROP TABLE t"), "ddl");
}

#[test]
fn affected_from_tag_parses_pg_command_tags() {
    assert_eq!(affected_from_tag("INSERT 0 5"), Some(5));
    assert_eq!(affected_from_tag("UPDATE 3"), Some(3));
    assert_eq!(affected_from_tag("CREATE TABLE"), None);
}

// ── SQLite walker — real in-memory database, no env vars, not ignored ──

fn mem_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory");
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER, b TEXT);
         INSERT INTO t VALUES (1, 'x'), (2, 'y'), (3, 'z');",
    )
    .expect("seed");
    conn
}

#[test]
fn sqlite_walker_yields_notice_for_dml_with_affected() {
    let conn = mem_conn();
    let out = execute_sqlite_statement(&conn, "INSERT INTO t VALUES (4, 'w')", 1, 50)
        .expect("statement runs");
    match out {
        StatementOutcome::Notice { kind, affected, .. } => {
            assert_eq!(kind, "dml");
            assert_eq!(affected, Some(1));
        }
        _ => panic!("expected Notice, got Set"),
    }
}

#[test]
fn sqlite_walker_yields_set_for_select() {
    let conn = mem_conn();
    let out = execute_sqlite_statement(&conn, "SELECT a FROM t ORDER BY a", 1, 2)
        .expect("statement runs");
    match out {
        StatementOutcome::Set(qr) => {
            assert_eq!(qr.columns.len(), 1);
            assert_eq!(qr.rows.len(), 2, "page size caps rows");
            assert_eq!(qr.total_rows, 3, "total counts all rows");
        }
        _ => panic!("expected Set, got Notice"),
    }
}

#[test]
fn sqlite_walker_notices_ddl() {
    let conn = mem_conn();
    let out = execute_sqlite_statement(&conn, "CREATE TABLE u (x INT)", 1, 50).unwrap();
    match out {
        StatementOutcome::Notice { kind, .. } => assert_eq!(kind, "ddl"),
        _ => panic!("expected Notice"),
    }
}

#[test]
fn run_sqlite_statements_stops_at_first_error_with_prior_sets() {
    let conn = mem_conn();
    let statements = crate::db::sql_split::split_statements(
        "SELECT a FROM t; SELECT * FROM missing; SELECT 1",
    );
    let mut sets = Vec::new();
    let mut notices = Vec::new();
    let err = run_sqlite_statements(&conn, &statements, 1, 50, &mut sets, &mut notices);
    assert_eq!(sets.len(), 1, "first set is returned");
    assert!(err.is_some(), "the failed statement stops the run");
}

/// Live PG walker test — mirror the env/client conventions of the live PG
/// tests in `commands/objects.test.rs`. Assert: `SELECT 1; SELECT 2` (split
/// via sql_split) produces two Sets via `run_pg_statements`, and
/// `UPDATE`-on-missing-table produces a first-error stop with the error
/// notice attached.
#[tokio::test]
#[ignore]
async fn pg_multi_statement_live() {
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

    // Two SELECTs → two Sets, no notices.
    let stmts = crate::db::sql_split::split_statements("SELECT 1; SELECT 2");
    let mut sets = vec![];
    let mut notices = vec![];
    let err = run_pg_statements(&client, &stmts, 1, 50, &mut sets, &mut notices).await;
    assert!(err.is_none());
    assert_eq!(sets.len(), 2);
    assert!(notices.is_empty());

    // UPDATE on a missing table → first-error stop with an error notice.
    let bad = crate::db::sql_split::split_statements("UPDATE gridline_missing SET a=1");
    let mut sets2 = vec![];
    let mut notices2 = vec![];
    let err2 = run_pg_statements(&client, &bad, 1, 50, &mut sets2, &mut notices2).await;
    assert!(err2.is_some(), "missing table must stop the run");
    assert!(
        notices2.iter().any(|n| n.kind == "error"),
        "an error notice must be attached"
    );

    let _ = handle;
}

// ── sqlx type-feature coverage ──────────────────────────────────────

/// Connect to the optional live MySQL test server. Returns `None` when the
/// env vars are absent so the whole suite stays green without a server
/// (matching the existing `#[ignore]`d integration-test convention).
pub(crate) async fn mysql_test_connection() -> Option<sqlx::mysql::MySqlConnection> {
    use sqlx::ConnectOptions;
    let host = std::env::var("GRIDLINE_TEST_MYSQL_HOST").ok()?;
    let port: u16 = std::env::var("GRIDLINE_TEST_MYSQL_PORT")
        .ok()?
        .parse()
        .ok()?;
    let user = std::env::var("GRIDLINE_TEST_MYSQL_USER").unwrap_or_else(|_| "root".into());
    let pass = std::env::var("GRIDLINE_TEST_MYSQL_PASS").unwrap_or_default();
    let db = std::env::var("GRIDLINE_TEST_MYSQL_DB").ok()?;
    sqlx::mysql::MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&user)
        .password(&pass)
        .database(&db)
        .ssl_mode(sqlx::mysql::MySqlSslMode::Disabled)
        .disable_statement_logging()
        .connect()
        .await
        .ok()
}

#[tokio::test]
#[ignore]
async fn mysql_decimal_and_date_decode_with_features_enabled() {
    use sqlx::Row;
    let Some(mut conn) = mysql_test_connection().await else { return };

    sqlx::query(
        "CREATE TEMPORARY TABLE gl_feature_probe (
           c_decimal DECIMAL(20,4), c_date DATE, c_datetime DATETIME(6) )",
    )
    .execute(&mut conn)
    .await
    .expect("create temporary table");

    sqlx::query(
        "INSERT INTO gl_feature_probe VALUES (
           12345678901234.5678, '2024-01-15', '2024-01-15 10:30:00.123456' )",
    )
    .execute(&mut conn)
    .await
    .expect("insert");

    let row = sqlx::query("SELECT * FROM gl_feature_probe")
        .fetch_one(&mut conn)
        .await
        .expect("select");

    let dec: sqlx::types::BigDecimal = row.try_get(0).expect("DECIMAL must decode");
    assert_eq!(dec.to_string(), "12345678901234.5678");

    let date: chrono::NaiveDate = row.try_get(1).expect("DATE must decode");
    assert_eq!(date, chrono::NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());

    let dt: chrono::NaiveDateTime = row.try_get(2).expect("DATETIME(6) must decode");
    assert_eq!(dt.to_string(), "2024-01-15 10:30:00.123456");
}

// ── mysql_cell_kind (pure) ──────────────────────────────────────────

#[test]
fn mysql_cell_kind_maps_every_type_name_sqlx_can_report() {
    use MysqlCellKind::*;
    // Every string here was observed from a live MySQL 8 server during the
    // architect phase (ColumnType::name(flags, max_size)).
    let cases: &[(&str, MysqlCellKind)] = &[
        ("BOOLEAN", Int { bits: 8, signed: true }),
        ("TINYINT", Int { bits: 8, signed: true }),
        ("TINYINT UNSIGNED", Int { bits: 8, signed: false }),
        ("SMALLINT", Int { bits: 16, signed: true }),
        ("SMALLINT UNSIGNED", Int { bits: 16, signed: false }),
        ("MEDIUMINT", Int { bits: 24, signed: true }),
        ("MEDIUMINT UNSIGNED", Int { bits: 24, signed: false }),
        ("INT", Int { bits: 32, signed: true }),
        ("INT UNSIGNED", Int { bits: 32, signed: false }),
        ("BIGINT", Int { bits: 64, signed: true }),
        ("BIGINT UNSIGNED", Int { bits: 64, signed: false }),
        ("YEAR", Int { bits: 16, signed: false }),
        ("BIT", Bit),
        ("FLOAT", Float),
        ("DOUBLE", Double),
        ("DECIMAL", Decimal),
        ("DATE", Date),
        ("TIME", Time),
        ("DATETIME", DateTime),
        ("TIMESTAMP", DateTime),
        ("JSON", Json),
        ("CHAR", Text),
        ("VARCHAR", Text),
        ("TEXT", Text),
        ("TINYTEXT", Text),
        ("MEDIUMTEXT", Text),
        ("LONGTEXT", Text),
        ("ENUM", Text),
        ("SET", Text),
        ("BINARY", Bytes),
        ("VARBINARY", Bytes),
        ("BLOB", Bytes),
        ("TINYBLOB", Bytes),
        ("MEDIUMBLOB", Bytes),
        ("LONGBLOB", Bytes),
        ("NULL", Null),
        ("GEOMETRY", Unknown),
        ("SOMETHING_NEW", Unknown),
    ];
    for (name, expected) in cases {
        assert_eq!(&mysql_cell_kind(name), expected, "type name {name}");
    }
}

#[test]
fn mysql_cell_kind_is_case_insensitive_and_trims() {
    assert_eq!(mysql_cell_kind("  bigint unsigned "), MysqlCellKind::Int { bits: 64, signed: false });
    assert_eq!(mysql_cell_kind("Datetime"), MysqlCellKind::DateTime);
}
