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
