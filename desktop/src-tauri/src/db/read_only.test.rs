use super::*;

/// Recording double at the control seam. It plays the role of a driver
/// connection: it records every statement in order, so a test can prove that
/// the engine mechanism is applied *around* whatever runs inside the session.
#[derive(Default)]
struct RecordingConn {
    statements: Vec<String>,
    fail_on: Option<String>,
}

impl ReadOnlyControl for RecordingConn {
    fn control(&mut self, statement: &str) -> ControlFuture<'_> {
        self.statements.push(statement.to_string());
        let outcome = if self.fail_on.as_deref() == Some(statement) {
            Err(format!("control failed: {statement}"))
        } else {
            Ok(())
        };
        Box::pin(std::future::ready(outcome))
    }
}

const ENGINES: [ReadOnlyEngine; 3] = [
    ReadOnlyEngine::PostgreSql,
    ReadOnlyEngine::MySql,
    ReadOnlyEngine::Sqlite,
];

#[test]
fn mechanisms_are_the_engines_own_read_only_features() {
    assert_eq!(
        ReadOnlyEngine::PostgreSql.begin_statement(),
        "BEGIN TRANSACTION READ ONLY"
    );
    assert_eq!(ReadOnlyEngine::PostgreSql.finish_statement(), "ROLLBACK");

    assert_eq!(
        ReadOnlyEngine::MySql.begin_statement(),
        "START TRANSACTION READ ONLY"
    );
    assert_eq!(ReadOnlyEngine::MySql.finish_statement(), "ROLLBACK");

    assert_eq!(
        ReadOnlyEngine::Sqlite.begin_statement(),
        "PRAGMA query_only = ON"
    );
    assert_eq!(
        ReadOnlyEngine::Sqlite.finish_statement(),
        "PRAGMA query_only = OFF"
    );

    // The engine name is what a rejection message names, so it must be the
    // engine the user connected to rather than a shared label.
    let names: Vec<&str> = ENGINES.iter().map(|e| e.as_str()).collect();
    assert_eq!(names, vec!["PostgreSQL", "MySQL", "SQLite"]);
}

/// The ordering guarantee: mechanism on, statement, mechanism off — asserted for
/// every engine through the same session type the export uses.
#[tokio::test]
async fn every_engine_wraps_the_statement_in_its_read_only_mechanism() {
    for engine in ENGINES {
        let mut conn = RecordingConn::default();
        let mut session = ReadOnlySession::start(&mut conn, engine)
            .await
            .unwrap_or_else(|e| panic!("{engine:?} should start a read-only session: {e}"));
        session
            .conn()
            .control("USER STATEMENT")
            .await
            .expect("statement runs");
        session.finish().await.expect("session closes");

        assert_eq!(
            conn.statements,
            vec![
                engine.begin_statement().to_string(),
                "USER STATEMENT".to_string(),
                engine.finish_statement().to_string(),
            ],
            "{engine:?} must run the statement between its mechanism statements"
        );
    }
}

#[tokio::test]
async fn start_fails_closed_when_the_mechanism_cannot_be_applied() {
    for engine in ENGINES {
        let mut conn = RecordingConn {
            statements: Vec::new(),
            fail_on: Some(engine.begin_statement().to_string()),
        };
        let error = ReadOnlySession::start(&mut conn, engine)
            .await
            .expect_err("a connection that cannot be made read-only is not usable");
        assert!(
            error.contains(engine.as_str()),
            "the failure must name the engine, got: {error}"
        );
        assert!(
            error.contains("read-only"),
            "the failure must say what could not be applied, got: {error}"
        );
        // Nothing but the failed mechanism statement may have run.
        assert_eq!(conn.statements, vec![engine.begin_statement().to_string()]);
    }
}

#[tokio::test]
async fn a_close_failure_is_reported_rather_than_swallowed() {
    let mut conn = RecordingConn {
        statements: Vec::new(),
        fail_on: Some(ReadOnlyEngine::MySql.finish_statement().to_string()),
    };
    let mut session = ReadOnlySession::start(&mut conn, ReadOnlyEngine::MySql)
        .await
        .expect("session starts");
    session
        .conn()
        .control("USER STATEMENT")
        .await
        .expect("statement runs");
    let error = session
        .finish()
        .await
        .expect_err("a session that could not be restored must report it");
    assert!(error.contains("MySQL"), "got: {error}");
}

/// Real mechanism, real database: `PRAGMA query_only` is the SQLite read-only
/// enforcement, so a write attempted while the session is open must fail at the
/// engine and leave the data untouched — and the session must restore the
/// connection's read-write state when it closes.
#[tokio::test]
async fn sqlite_query_only_actually_blocks_a_write_and_is_restored() {
    let mut conn = rusqlite::Connection::open_in_memory().expect("sqlite");
    conn.execute_batch(
        "CREATE TABLE t (a INTEGER);
         INSERT INTO t VALUES (1);",
    )
    .expect("fixture");

    let mut session = ReadOnlySession::start(&mut conn, ReadOnlyEngine::Sqlite)
        .await
        .expect("query_only applies");

    let active: i64 = session
        .conn()
        .query_row("SELECT query_only FROM pragma_query_only", [], |row| {
            row.get(0)
        })
        .expect("pragma readable");
    assert_eq!(active, 1, "query_only must be ON inside the session");

    let write = session.conn().execute_batch("INSERT INTO t VALUES (2)");
    assert!(
        write.is_err(),
        "a write inside the read-only session must be refused by SQLite"
    );

    session.finish().await.expect("query_only restored");

    let restored: i64 = conn
        .query_row("SELECT query_only FROM pragma_query_only", [], |row| {
            row.get(0)
        })
        .expect("pragma readable");
    assert_eq!(
        restored, 0,
        "the connection is read-write again after export"
    );

    let rows: i64 = conn
        .query_row("SELECT count(*) FROM t", [], |row| row.get(0))
        .expect("count");
    assert_eq!(rows, 1, "the refused write changed nothing");
}

/// All three engines share ONE control seam. If a driver needed its own
/// session type again, this assertion is where the divergence would surface.
#[test]
fn every_engine_connection_implements_the_single_control_seam() {
    fn assert_control<C: ReadOnlyControl + ?Sized>() {}

    assert_control::<rusqlite::Connection>();
    assert_control::<tokio_postgres::Client>();
    assert_control::<sqlx::MySqlConnection>();
}

/// `PRAGMA name = value` is classified as a read by the shared classifier (the
/// statement writes no rows), so the SQLite mechanism has to be the thing that
/// refuses it. It does: `query_only` rejects pragma writes to the database.
#[tokio::test]
async fn sqlite_query_only_refuses_a_pragma_assignment() {
    let mut conn = rusqlite::Connection::open_in_memory().expect("sqlite");

    let mut session = ReadOnlySession::start(&mut conn, ReadOnlyEngine::Sqlite)
        .await
        .expect("query_only applies");
    let write = session.conn().execute_batch("PRAGMA user_version = 5");
    assert!(
        write.is_err(),
        "a pragma write inside the read-only session must be refused by SQLite"
    );
    session.finish().await.expect("query_only restored");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("pragma readable");
    assert_eq!(version, 0, "the refused pragma changed nothing");
}
