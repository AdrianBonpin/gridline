//! Engine-enforced read-only execution for operations that promise to only read.
//!
//! Export is an Execution Entry Point: classification (`db::sql_classify`) is
//! the allowlist half of "this cannot write", and this module is the other
//! half. Even when a statement somehow got past classification, it still runs
//! inside the engine's own read-only mechanism, so the *server* is what refuses
//! the write:
//!
//! | Engine     | Mechanism                                    |
//! | ---------- | -------------------------------------------- |
//! | PostgreSQL | `BEGIN TRANSACTION READ ONLY` … `ROLLBACK`   |
//! | MySQL      | `START TRANSACTION READ ONLY` … `ROLLBACK`   |
//! | SQLite     | `PRAGMA query_only = ON` … `= OFF`           |
//!
//! [`ReadOnlySession`] applies the mechanism around whatever the caller runs,
//! which keeps the ordering identical on every engine instead of leaving each
//! driver to remember it. A session that cannot be started fails closed (the
//! caller must not run the statement at all), and a session that cannot be
//! closed is reported rather than swallowed.

use std::future::Future;
use std::pin::Pin;

/// Future returned by a control statement. Control statements are the engine's
/// own transaction/pragma management — never user SQL.
pub type ControlFuture<'a> = Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;

/// The engines whose read-only mechanism export relies on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadOnlyEngine {
    PostgreSql,
    MySql,
    Sqlite,
}

impl ReadOnlyEngine {
    /// The engine name a rejection or a session failure reports.
    pub fn as_str(self) -> &'static str {
        match self {
            ReadOnlyEngine::PostgreSql => "PostgreSQL",
            ReadOnlyEngine::MySql => "MySQL",
            ReadOnlyEngine::Sqlite => "SQLite",
        }
    }

    /// The statement that puts this engine into its read-only mechanism.
    pub fn begin_statement(self) -> &'static str {
        match self {
            ReadOnlyEngine::PostgreSql => "BEGIN TRANSACTION READ ONLY",
            ReadOnlyEngine::MySql => "START TRANSACTION READ ONLY",
            ReadOnlyEngine::Sqlite => "PRAGMA query_only = ON",
        }
    }

    /// The statement that ends it. For SQLite this restores the read-write mode
    /// Gridline's pooled connections are created with (the app never enables
    /// `query_only` elsewhere, so `OFF` is the connection's normal state).
    pub fn finish_statement(self) -> &'static str {
        match self {
            ReadOnlyEngine::PostgreSql => "ROLLBACK",
            ReadOnlyEngine::MySql => "ROLLBACK",
            ReadOnlyEngine::Sqlite => "PRAGMA query_only = OFF",
        }
    }

    /// Fail-closed wording for a mechanism that could not be applied.
    fn start_failure(self, detail: impl std::fmt::Display) -> String {
        format!(
            "{}: could not start a read-only session ({}): {detail}",
            self.as_str(),
            self.begin_statement()
        )
    }

    /// Reported (never swallowed) wording for a mechanism that could not be
    /// released.
    fn finish_failure(self, detail: impl std::fmt::Display) -> String {
        format!(
            "{}: the read-only session could not be closed ({}): {detail}",
            self.as_str(),
            self.finish_statement()
        )
    }
}

/// A connection that can run its engine's read-only control statements.
///
/// Each implementation names its own mechanism, so a new engine cannot be added
/// without saying which server feature makes the session read-only. The future
/// is `Send` so an export stays usable from a Tauri command.
pub trait ReadOnlyControl {
    fn control<'a>(&'a mut self, statement: &'a str) -> ControlFuture<'a>;
}

impl ReadOnlyControl for rusqlite::Connection {
    fn control<'a>(&'a mut self, statement: &'a str) -> ControlFuture<'a> {
        let outcome = self.execute_batch(statement).map_err(|e| format!("{e}"));
        Box::pin(std::future::ready(outcome))
    }
}

impl ReadOnlyControl for tokio_postgres::Client {
    fn control<'a>(&'a mut self, statement: &'a str) -> ControlFuture<'a> {
        Box::pin(async move {
            self.simple_query(statement)
                .await
                .map(|_| ())
                .map_err(|e| format!("{e}"))
        })
    }
}

impl ReadOnlyControl for sqlx::MySqlConnection {
    fn control<'a>(&'a mut self, statement: &'a str) -> ControlFuture<'a> {
        // `raw_sql` sends the statement unprepared, which is what transaction
        // control needs (transaction statements cannot be prepared).
        //
        // The stream is drained rather than collected and the statement is
        // owned: sqlx implements `Executor` for `&mut MySqlConnection` with one
        // lifetime serving as both the connection borrow and the query lifetime
        // (`impl<'c> Executor<'c> for &'c mut MySqlConnection`), and a control
        // statement borrowed from the caller makes that region impossible to
        // prove from inside this future (`implementation of Executor is not
        // general enough`).
        let sql = statement.to_string();
        Box::pin(async move {
            use futures_util::TryStreamExt;
            let mut stream = sqlx::raw_sql(&sql).execute_many(&mut *self);
            while let Some(_result) = stream.try_next().await.map_err(|e| format!("{e}"))? {}
            Ok(())
        })
    }
}

/// A connection that is currently inside its engine's read-only mechanism.
///
/// Obtained from [`ReadOnlySession::start`] and released with
/// [`ReadOnlySession::finish`]. The statement runs through
/// [`ReadOnlySession::conn`], so the mechanism is already active when it runs
/// and is still active until the session is closed.
#[must_use = "a read-only session must be closed with finish()"]
pub struct ReadOnlySession<'a, C: ?Sized> {
    conn: &'a mut C,
    engine: ReadOnlyEngine,
}

impl<C: ?Sized> std::fmt::Debug for ReadOnlySession<'_, C> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReadOnlySession")
            .field("engine", &self.engine)
            .finish_non_exhaustive()
    }
}

impl<'a, C: ReadOnlyControl + ?Sized> ReadOnlySession<'a, C> {
    /// Apply the engine's read-only mechanism. Fails closed: an error means the
    /// connection must not be used to run the statement.
    pub async fn start(conn: &'a mut C, engine: ReadOnlyEngine) -> Result<Self, String> {
        conn.control(engine.begin_statement())
            .await
            .map_err(|e| engine.start_failure(e))?;
        Ok(Self { conn, engine })
    }

    /// The connection to run the statement on.
    pub fn conn(&mut self) -> &mut C {
        self.conn
    }

    /// End the mechanism. Reported, never swallowed: a connection left in a
    /// half-closed state is visible to the caller.
    pub async fn finish(self) -> Result<(), String> {
        self.conn
            .control(self.engine.finish_statement())
            .await
            .map_err(|e| self.engine.finish_failure(e))
    }
}

#[cfg(test)]
#[path = "read_only.test.rs"]
mod read_only_tests;
