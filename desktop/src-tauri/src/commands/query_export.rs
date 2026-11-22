//! Streaming export of a full query result to a local file (spec §4/§5C).
//!
//! Headless `run_*_export` functions (testable without Tauri State) + one
//! thin command that owns the pool lock, the cancel registration, and the
//! `export-progress` events.
//!
//! Export is an Execution Entry Point that must never become a write path, so
//! the promise is enforced in two layers *in the backend*:
//!
//! 1. [`validate_export_request`] runs the shared, corpus-pinned classifier
//!    (`db::sql_classify`) behind an engine-appropriate allowlist: exactly one
//!    statement, it must be provably `Read`, and its leading verb must be one
//!    of the result-producing statements that engine actually supports.
//!    Leading comments, MySQL executable comments, data-modifying CTEs, unknown
//!    verbs, session/maintenance commands and multi-statement scripts are
//!    rejected with a reason that names the engine and the offending shape —
//!    no frontend analysis is involved or trusted.
//! 2. The statement then runs inside the engine's own read-only mechanism
//!    (`db::read_only`): a PostgreSQL/MySQL read-only transaction, or SQLite
//!    `PRAGMA query_only`. A write that somehow got past the gate is refused by
//!    the server, not by a comment.
//!
//! Fail-closed: any error deletes the partial file.

use crate::db::pool::DbHandle;
use crate::db::read_only::{ReadOnlyControl, ReadOnlyEngine, ReadOnlySession};
use crate::db::sql_classify::{
    classify_statement, scan_words, StatementKind, CTE_WRITE_VERBS, SCHEMA_VERBS, WRITE_VERBS,
};
use crate::db::sql_split::split_statements;
use crate::models::db_viewer::ColumnInfo;
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;

const PROGRESS_ROWS: u64 = 5_000;
const CURSOR_NAME: &str = "_gridline_export";
const CURSOR_FETCH: usize = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExportFormat {
    Csv,
    Jsonl,
    Json,
}

impl ExportFormat {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "csv" => Ok(ExportFormat::Csv),
            "jsonl" => Ok(ExportFormat::Jsonl),
            "json" => Ok(ExportFormat::Json),
            other => Err(format!(
                "unsupported export format: {other} (csv | jsonl | json)"
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportSummary {
    pub rows_written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExportProgressEvent {
    pub job_id: String,
    /// "running" | "done" | "error"
    pub status: String,
    pub rows: u64,
    pub error: Option<String>,
}

// ── The read-only export contract ─────────────────────────────────

/// A statement the backend has proven read-only. The text it carries is the
/// exact text that was classified, so what runs cannot differ from what was
/// proven (no re-parse, no re-join, no client-side rewrite).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportStatement {
    engine: ReadOnlyEngine,
    sql: String,
}

impl ExportStatement {
    pub fn engine(&self) -> ReadOnlyEngine {
        self.engine
    }

    pub fn sql(&self) -> &str {
        &self.sql
    }
}

/// The verbs export will run for an engine: the subset of the shared
/// classifier's read set that returns a result set *that engine supports*.
///
/// This narrows, never widens, [`crate::db::sql_classify`]: a statement still
/// has to be classified `Read` before its verb is looked at. It exists because
/// the shared classifier answers "does this write?" for the destructive-query
/// prompt — a question `VACUUM`, `REINDEX`, `SET`, `BEGIN` and `LOCK` can
/// legitimately answer "no" — while export has to answer "is this a query I can
/// run and export?", which those commands are not. The lists also keep each
/// engine to statements it can parse, so `SHOW TABLES` on SQLite is refused at
/// the gate with a reason instead of failing at the server.
pub fn exportable_verbs(engine: ReadOnlyEngine) -> &'static [&'static str] {
    match engine {
        ReadOnlyEngine::PostgreSql => &["SELECT", "VALUES", "TABLE", "WITH", "SHOW", "EXPLAIN"],
        ReadOnlyEngine::MySql => &[
            "SELECT", "VALUES", "TABLE", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN",
        ],
        // `PRAGMA` stays exportable: read-only pragmas are how SQLite exposes
        // introspection, and `PRAGMA query_only` refuses the assignment forms
        // at the engine rather than being guessed at here.
        ReadOnlyEngine::Sqlite => &["SELECT", "VALUES", "WITH", "EXPLAIN", "PRAGMA"],
    }
}

/// The backend gate every export runs through, for the engine it is exporting
/// from. Accepts only a single statement the shared classifier proves read-only
/// and whose verb is an exportable read on that engine.
pub fn validate_export_request(
    engine: ReadOnlyEngine,
    sql: &str,
    path: &Path,
) -> Result<ExportStatement, String> {
    if !path.is_absolute() {
        return Err("Export path must be absolute".to_string());
    }

    let statements = split_statements(sql);
    match statements.len() {
        1 => {}
        0 => {
            return Err(format!(
                "export rejected on {}: no statement to export",
                engine.as_str()
            ))
        }
        found => {
            return Err(format!(
                "export rejected on {}: export accepts a single statement, found {found}",
                engine.as_str()
            ))
        }
    }

    let statement = &statements[0];
    if classify_statement(statement) != StatementKind::Read {
        return Err(not_exportable(engine, statement));
    }

    // A leading verb the shared classifier calls read-only, but that is not a
    // query this engine can export.
    let leading = leading_verb(statement);
    if !leading
        .as_deref()
        .is_some_and(|verb| exportable_verbs(engine).contains(&verb))
    {
        return Err(not_an_exportable_query(engine, leading.as_deref()));
    }

    Ok(ExportStatement {
        engine,
        sql: statement.clone(),
    })
}

/// The statement's leading keyword, with comments, quoted regions and
/// dollar-quoted bodies skipped — the same first word the shared classifier
/// dispatches on, so the allowlist cannot disagree with it about which verb a
/// statement starts with.
fn leading_verb(statement: &str) -> Option<String> {
    scan_words(statement).into_iter().next()
}

/// Why this statement is not exportable, naming the engine and the shape that
/// made it unprovable rather than a generic refusal.
fn not_exportable(engine: ReadOnlyEngine, statement: &str) -> String {
    let kind = classify_statement(statement);
    let words = scan_words(statement);
    let verb = words.first().map(String::as_str);
    // The first word (if any) among `verbs`, so a wrapped or nested statement
    // names the verb that actually writes instead of the wrapper around it.
    let inner = |verbs: &[&str]| {
        words
            .iter()
            .find(|word| verbs.iter().any(|verb| verb == word))
            .cloned()
    };
    let detail = match (kind, verb) {
        // `EXPLAIN DELETE …` writes (EXPLAIN ANALYZE executes); the outer verb
        // is not the offender, so name the wrapped one.
        (StatementKind::Write, Some("EXPLAIN")) => format!(
            "the EXPLAIN wraps {} which changes data",
            inner(WRITE_VERBS).unwrap_or_else(|| "a write".to_string())
        ),
        (StatementKind::Schema, Some("EXPLAIN")) => format!(
            "the EXPLAIN wraps {} which changes schema",
            inner(SCHEMA_VERBS).unwrap_or_else(|| "a schema change".to_string())
        ),
        // A write that hides in a CTE chain: the leading verb is misleading, so
        // name where the write actually is.
        (StatementKind::Write, Some("WITH")) => format!(
            "the statement is a data-modifying CTE ({})",
            inner(CTE_WRITE_VERBS).unwrap_or_else(|| "a write".to_string())
        ),
        (StatementKind::Write, Some(verb)) => format!("{verb} changes data"),
        (StatementKind::Schema, Some(verb)) => format!("{verb} changes schema"),
        (StatementKind::Unknown, Some(verb)) => format!("{verb} cannot be proven read-only"),
        _ => "the statement cannot be proven read-only".to_string(),
    };
    format!(
        "export rejected on {}: {detail}; export accepts only read-only queries",
        engine.as_str()
    )
}

/// Why a read-classified statement is still not exportable: it is not a query
/// that returns rows, or not one this engine supports.
fn not_an_exportable_query(engine: ReadOnlyEngine, verb: Option<&str>) -> String {
    let accepted = exportable_verbs(engine).join(", ");
    match verb {
        Some(verb) => format!(
            "export rejected on {}: {verb} is not an exportable read query on {}; \
             export accepts only read-only queries that return rows ({accepted})",
            engine.as_str(),
            engine.as_str()
        ),
        None => format!(
            "export rejected on {}: the statement has no exportable read verb; \
             export accepts only read-only queries that return rows ({accepted})",
            engine.as_str()
        ),
    }
}

// ── Format writers (pure) ─────────────────────────────────────────

/// Quote one CSV cell with formula-injection protection (spec §2) — mirrors
/// the client-side `csvCell` brought to parity in Task 11.
pub fn csv_cell(value: &serde_json::Value) -> String {
    let raw = match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let guarded = match raw.chars().next() {
        Some('=') | Some('+') | Some('-') | Some('@') | Some('\t') | Some('\r') => {
            format!("'{raw}")
        }
        _ => raw.clone(),
    };
    if guarded.contains(',')
        || guarded.contains('"')
        || guarded.contains('\n')
        || guarded.contains('\r')
    {
        format!("\"{}\"", guarded.replace('"', "\"\""))
    } else {
        guarded
    }
}

pub fn csv_line(columns: &[ColumnInfo], row: &[serde_json::Value]) -> String {
    let mut line = String::new();
    for (i, _) in columns.iter().enumerate() {
        if i > 0 {
            line.push(',');
        }
        line.push_str(&csv_cell(row.get(i).unwrap_or(&serde_json::Value::Null)));
    }
    line
}

pub fn csv_header(columns: &[ColumnInfo]) -> String {
    columns
        .iter()
        .map(|c| csv_cell(&serde_json::Value::String(c.name.clone())))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn jsonl_line(columns: &[ColumnInfo], row: &[serde_json::Value]) -> String {
    let mut obj = serde_json::Map::new();
    for (i, c) in columns.iter().enumerate() {
        obj.insert(
            c.name.clone(),
            row.get(i).cloned().unwrap_or(serde_json::Value::Null),
        );
    }
    serde_json::to_string(&serde_json::Value::Object(obj)).unwrap_or_default()
}

fn write_row<W: Write>(
    w: &mut W,
    format: ExportFormat,
    columns: &[ColumnInfo],
    row: &[serde_json::Value],
    first: bool,
) -> std::io::Result<()> {
    match format {
        ExportFormat::Csv => writeln!(w, "{}", csv_line(columns, row)),
        ExportFormat::Jsonl => writeln!(w, "{}", jsonl_line(columns, row)),
        ExportFormat::Json => {
            if !first {
                writeln!(w, ",")?;
            }
            write!(w, "{}", jsonl_line(columns, row))
        }
    }
}

// ── Output handling ──────────────────────────────────────────────
//
// A streamed export never writes to its destination directly. It writes a
// temporary sibling in the same directory, flushes, syncs and closes it, and
// only then publishes it with one rename. Two guarantees follow from that
// order: the prior destination survives any failure **byte for byte**, and a
// failed export removes the only partial artifact it created.

type ExportWriter = std::io::BufWriter<std::fs::File>;

/// Consume the File Grant that authorizes the export destination and return its
/// path.
///
/// Export writes a file, so the grant has to carry the `Write` intent: a
/// restore/import read grant is refused here. A path the renderer supplied is
/// not a grant, so handing one in fails closed with the `file-grant-invalid`
/// state instead of naming a file for the export to overwrite.
///
pub fn resolve_export_output(
    grants: &crate::file_grant::FileGrantStore,
    grant_id: &str,
) -> Result<PathBuf, String> {
    let path = crate::file_grant::consume_granted_path(
        grants,
        grant_id,
        crate::file_grant::FileIntent::Write,
    )?;
    Ok(PathBuf::from(path))
}

/// The temporary sibling a streamed export writes before publishing.
///
/// Same directory as the destination (so the publish is one atomic rename on
/// the same filesystem) and dot-prefixed with a unique suffix (so it cannot
/// collide with the destination or a concurrent export).
fn partial_sibling_path(destination: &Path) -> Result<PathBuf, String> {
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Export destination must name a file".to_string())?;
    let dir = destination
        .parent()
        .ok_or_else(|| "Export destination must have a parent directory".to_string())?;
    Ok(dir.join(format!(".{name}.gridline-partial-{}", uuid::Uuid::new_v4())))
}

/// A destination being written: the temporary sibling, its writer, and the
/// path it publishes to.
struct ExportTarget {
    destination: PathBuf,
    partial: PathBuf,
    writer: ExportWriter,
}

impl ExportTarget {
    fn create(destination: &Path) -> Result<Self, String> {
        let partial = partial_sibling_path(destination)?;
        let file =
            std::fs::File::create(&partial).map_err(|e| format!("cannot create file: {e}"))?;
        Ok(Self {
            destination: destination.to_path_buf(),
            partial,
            writer: std::io::BufWriter::with_capacity(8 * 1024 * 1024, file),
        })
    }

    /// Flush, sync, close, then rename over the destination. Any failure here
    /// removes the temporary output and reports why; the destination is never
    /// touched.
    fn publish(self) -> Result<(), String> {
        let Self {
            destination,
            partial,
            writer,
        } = self;
        let file = match writer.into_inner() {
            Ok(file) => file,
            Err(e) => {
                let message = e.error().to_string();
                drop(e); // close before removing the partial output
                let _ = std::fs::remove_file(&partial);
                return Err(format!("export write failed: {message}"));
            }
        };
        if let Err(e) = file.sync_all() {
            drop(file);
            let _ = std::fs::remove_file(&partial);
            return Err(format!("export write failed: {e}"));
        }
        drop(file);
        if let Err(e) = std::fs::rename(&partial, &destination) {
            let _ = std::fs::remove_file(&partial);
            return Err(format!(
                "export could not replace {}: {e}",
                destination.display()
            ));
        }
        Ok(())
    }

    /// Drop this export's own partial output. The destination is untouched.
    fn discard(self) {
        let Self {
            partial, writer, ..
        } = self;
        drop(writer);
        let _ = std::fs::remove_file(&partial);
    }
}

/// Open the destination's temporary sibling and start the engine's read-only
/// session: either both hold, or nothing is left behind (a failed start removes
/// the temporary output; a failed session start never creates one).
async fn start_export<'a, C: ReadOnlyControl + ?Sized>(
    conn: &'a mut C,
    engine: ReadOnlyEngine,
    destination: &Path,
) -> Result<(ReadOnlySession<'a, C>, ExportTarget), String> {
    let session = ReadOnlySession::start(conn, engine).await?;
    match ExportTarget::create(destination) {
        Ok(target) => Ok((session, target)),
        Err(e) => {
            let _ = session.finish().await;
            Err(e)
        }
    }
}

/// Publish on success; on any failure drop the temporary output and report the
/// primary error. A session that could not be closed is a failure too: the
/// connection's state is not what the caller would assume.
fn settle_export(
    target: ExportTarget,
    body: Result<ExportSummary, String>,
    restored: Result<(), String>,
) -> Result<ExportSummary, String> {
    match (body, restored) {
        (Ok(summary), Ok(())) => target.publish().map(|_| summary),
        (Ok(_), Err(e)) | (Err(e), _) => {
            target.discard();
            Err(e)
        }
    }
}

// ── SQLite (native streaming) ─────────────────────────────────────

fn sqlite_export_body(
    conn: &rusqlite::Connection,
    request: &ExportStatement,
    format: ExportFormat,
    writer: &mut ExportWriter,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let mut stmt = conn.prepare(request.sql()).map_err(|e| e.to_string())?;
    let columns: Vec<ColumnInfo> = (0..stmt.column_count())
        .map(|i| ColumnInfo {
            name: stmt.column_name(i).unwrap_or("?").to_string(),
            data_type: "TEXT".to_string(),
            is_nullable: true,
            is_pk: false,
            is_fk: false,
            fk_ref: None,
            default_value: None,
            editable: true,
            is_generated: false,
            is_unique: false,
            is_auto_increment: false,
        })
        .collect();
    if format == ExportFormat::Csv {
        write!(writer, "\u{FEFF}").map_err(|e| e.to_string())?; // UTF-8 BOM
        writeln!(writer, "{}", csv_header(&columns)).map_err(|e| e.to_string())?;
    }
    if format == ExportFormat::Json {
        write!(writer, "[").map_err(|e| e.to_string())?;
    }
    let col_count = columns.len();
    let mut rows_written: u64 = 0;
    let mut first = true;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let values: Vec<serde_json::Value> =
            (0..col_count).map(|i| sqlite_ref_to_json(row, i)).collect();
        write_row(writer, format, &columns, &values, first).map_err(|e| e.to_string())?;
        first = false;
        rows_written += 1;
        if rows_written % PROGRESS_ROWS == 0 {
            progress(rows_written);
        }
    }
    if format == ExportFormat::Json {
        writeln!(writer, "]").map_err(|e| e.to_string())?;
    }
    progress(rows_written);
    Ok(ExportSummary { rows_written })
}

pub async fn run_sqlite_export(
    conn: &mut rusqlite::Connection,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let request = validate_export_request(ReadOnlyEngine::Sqlite, sql, path)?;
    let (mut session, mut target) = start_export(conn, ReadOnlyEngine::Sqlite, path).await?;
    let body = sqlite_export_body(
        session.conn(),
        &request,
        format,
        &mut target.writer,
        progress,
    );
    let restored = session.finish().await;
    settle_export(target, body, restored)
}

fn sqlite_ref_to_json(row: &rusqlite::Row, i: usize) -> serde_json::Value {
    use rusqlite::types::ValueRef;
    match row.get_ref(i) {
        Ok(ValueRef::Null) => serde_json::Value::Null,
        Ok(ValueRef::Integer(v)) => serde_json::json!(v),
        Ok(ValueRef::Real(v)) => serde_json::json!(v),
        Ok(ValueRef::Text(v)) => serde_json::Value::String(String::from_utf8_lossy(v).to_string()),
        Ok(ValueRef::Blob(v)) => serde_json::Value::String(format!("[{}B blob]", v.len())),
        Err(_) => serde_json::Value::Null,
    }
}

// ── PostgreSQL (cursor FETCH loop — constant memory, stable order) ──

async fn pg_export_body(
    client: &mut tokio_postgres::Client,
    request: &ExportStatement,
    format: ExportFormat,
    writer: &mut ExportWriter,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let trimmed = request.sql().trim();
    client
        .simple_query(&format!("DECLARE {CURSOR_NAME} CURSOR FOR ({trimmed})"))
        .await
        .map_err(|e| format!("export declare failed: {e}"))?;

    let mut columns: Vec<ColumnInfo> = Vec::new();
    let mut rows_written: u64 = 0;
    let mut first = true;
    if format == ExportFormat::Json {
        write!(writer, "[").map_err(|e| e.to_string())?;
    }
    loop {
        let msgs = client
            .simple_query(&format!("FETCH FORWARD {CURSOR_FETCH} FROM {CURSOR_NAME}"))
            .await
            .map_err(|e| format!("export fetch failed: {e}"))?;
        let mut batch_rows: Vec<Vec<serde_json::Value>> = Vec::new();
        for msg in msgs {
            if let tokio_postgres::SimpleQueryMessage::Row(row) = msg {
                if columns.is_empty() {
                    columns = row
                        .columns()
                        .iter()
                        .map(|c| ColumnInfo {
                            name: c.name().to_string(),
                            data_type: "text".to_string(),
                            is_nullable: true,
                            is_pk: false,
                            is_fk: false,
                            fk_ref: None,
                            default_value: None,
                            editable: true,
                            is_generated: false,
                            is_unique: false,
                            is_auto_increment: false,
                        })
                        .collect();
                }
                // Simple-query protocol returns every value as text; decode
                // as &str (usize has no FromSql impl) and NULL as None.
                let values: Vec<serde_json::Value> = (0..row.len())
                    .map(|i| match row.try_get(i) {
                        Ok(Some(s)) => serde_json::Value::String(s.to_string()),
                        _ => serde_json::Value::Null,
                    })
                    .collect();
                batch_rows.push(values);
            }
        }
        if batch_rows.is_empty() {
            break;
        }
        if format == ExportFormat::Csv && rows_written == 0 {
            write!(writer, "\u{FEFF}").map_err(|e| e.to_string())?; // UTF-8 BOM
            writeln!(writer, "{}", csv_header(&columns)).map_err(|e| e.to_string())?;
        }
        for row in batch_rows {
            write_row(writer, format, &columns, &row, first).map_err(|e| e.to_string())?;
            first = false;
            rows_written += 1;
            if rows_written % PROGRESS_ROWS == 0 {
                progress(rows_written);
            }
        }
    }
    if format == ExportFormat::Json {
        writeln!(writer, "]").map_err(|e| e.to_string())?;
    }
    let _ = client.simple_query(&format!("CLOSE {CURSOR_NAME}")).await;
    progress(rows_written);
    Ok(ExportSummary { rows_written })
}

pub async fn run_pg_export(
    client: &mut tokio_postgres::Client,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let request = validate_export_request(ReadOnlyEngine::PostgreSql, sql, path)?;
    let (mut session, mut target) = start_export(client, ReadOnlyEngine::PostgreSql, path).await?;
    let body = pg_export_body(
        session.conn(),
        &request,
        format,
        &mut target.writer,
        progress,
    )
    .await;
    let restored = session.finish().await;
    settle_export(target, body, restored)
}

// ── MySQL (sqlx stream — native streaming) ─────────────────────────

async fn mysql_export_body(
    conn: &mut sqlx::mysql::MySqlConnection,
    request: &ExportStatement,
    format: ExportFormat,
    writer: &mut ExportWriter,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    use futures_util::TryStreamExt;
    let mut stream = sqlx::query(request.sql()).fetch(&mut *conn);
    let mut columns: Vec<ColumnInfo> = Vec::new();
    let mut rows_written: u64 = 0;
    let mut first = true;
    if format == ExportFormat::Json {
        write!(writer, "[").map_err(|e| e.to_string())?;
    }
    while let Some(row) = stream
        .try_next()
        .await
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?
    {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|c| ColumnInfo {
                    name: c.name().to_string(),
                    data_type: c.type_info().to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_fk: false,
                    fk_ref: None,
                    default_value: None,
                    editable: true,
                    is_generated: false,
                    is_unique: false,
                    is_auto_increment: false,
                })
                .collect();
            if format == ExportFormat::Csv {
                write!(writer, "\u{FEFF}").map_err(|e| e.to_string())?; // UTF-8 BOM
                writeln!(writer, "{}", csv_header(&columns)).map_err(|e| e.to_string())?;
            }
        }
        let values: Vec<serde_json::Value> = (0..row.len())
            .map(|i| crate::commands::query::mysql_cell_to_json(&row, i))
            .collect();
        write_row(writer, format, &columns, &values, first).map_err(|e| e.to_string())?;
        first = false;
        rows_written += 1;
        if rows_written % PROGRESS_ROWS == 0 {
            progress(rows_written);
        }
    }
    if format == ExportFormat::Json {
        writeln!(writer, "]").map_err(|e| e.to_string())?;
    }
    progress(rows_written);
    Ok(ExportSummary { rows_written })
}

pub async fn run_mysql_export(
    conn: &mut sqlx::mysql::MySqlConnection,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let request = validate_export_request(ReadOnlyEngine::MySql, sql, path)?;
    let (mut session, mut target) = start_export(conn, ReadOnlyEngine::MySql, path).await?;
    let body = mysql_export_body(
        session.conn(),
        &request,
        format,
        &mut target.writer,
        progress,
    )
    .await;
    let restored = session.finish().await;
    settle_export(target, body, restored)
}

// ── Dispatcher + thin command ──────────────────────────────────────

/// Dispatch across engines. The caller (command) owns the pool lock and the
/// cancel registration; MySQL callers must hold a dedicated connection.
pub(crate) async fn run_export_query(
    handle: &mut DbHandle,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    match handle {
        DbHandle::Sqlite(conn) => {
            let mut conn = conn.lock().await;
            run_sqlite_export(&mut conn, sql, format, path, progress).await
        }
        DbHandle::Postgresql(client, _) => {
            let mut client = client.lock().await;
            run_pg_export(&mut client, sql, format, path, progress).await
        }
        DbHandle::MySql(pool) => {
            let pool = pool.lock().await;
            let mut conn = pool
                .clone()
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            run_mysql_export(&mut conn, sql, format, path, progress).await
        }
    }
}

/// Headless export core: resolve the connection, run the streaming export and
/// return the summary. The Tauri command keeps grant resolution and progress
/// events; everything else lives here so the tool-job seam is testable.
///
/// The pool registry is locked only long enough to clone the connection
/// handle, so a long export on one connection never blocks another connection's
/// commands (ticket 25). The handle itself is *not* cloned from a guard that
/// outlives the call.
pub(crate) async fn export_query_inner(
    pool_manager: &tokio::sync::Mutex<crate::db::pool::ConnectionPoolManager>,
    cancel_registry: &crate::cancel::CancelRegistry,
    connection_id: &str,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    let handle = crate::db::pool::acquire_handle(pool_manager, connection_id).await?;

    // MySQL: the STREAMING connection must be the one registered for
    // KILL QUERY cancellation — acquire it once here, register its id,
    // stream through it, then clear the registration.
    match handle {
        DbHandle::MySql(pool) => {
            let pool = pool.lock().await;
            let mut conn = pool
                .clone()
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            let conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
                .fetch_one(&mut *conn)
                .await
                .unwrap_or(-1);
            cancel_registry.set_mysql_conn_id(connection_id, Some(conn_id));
            let r = run_mysql_export(&mut conn, sql, format, path, progress).await;
            cancel_registry.set_mysql_conn_id(connection_id, None);
            r
        }
        mut other => run_export_query(&mut other, sql, format, path, progress).await,
    }
}

#[tauri::command]
pub async fn export_query_to_file(
    connection_id: String,
    sql: String,
    format: String,
    file_grant: String,
    state: State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;

    let fmt = ExportFormat::from_str(&format)?;
    // Authorize the write before anything is opened: the granted path is the
    // only destination this command can be made to use, and a grant is not
    // spent on a request that fails before the export starts.
    let path_buf = resolve_export_output(&state.file_grants, &file_grant)?;
    let path = path_buf.to_string_lossy().to_string();
    let job_id = uuid::Uuid::new_v4().to_string();

    let mut last_emit = std::time::Instant::now();
    let job = job_id.clone();
    let mut progress_cb = |rows: u64| {
        if last_emit.elapsed() >= std::time::Duration::from_millis(250) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "export-progress",
                ExportProgressEvent {
                    job_id: job.clone(),
                    status: "running".into(),
                    rows,
                    error: None,
                },
            );
        }
    };

    let result = export_query_inner(
        &state.pool_manager,
        &state.cancel_registry,
        &connection_id,
        &sql,
        fmt,
        &path_buf,
        &mut progress_cb,
    )
    .await;

    match result {
        Ok(summary) => {
            let _ = app.emit(
                "export-progress",
                ExportProgressEvent {
                    job_id: job_id.clone(),
                    status: "done".into(),
                    rows: summary.rows_written,
                    error: None,
                },
            );
            Ok(serde_json::json!({ "rows_written": summary.rows_written, "path": path }))
        }
        Err(e) => {
            let _ = app.emit(
                "export-progress",
                ExportProgressEvent {
                    job_id: job_id.clone(),
                    status: "error".into(),
                    rows: 0,
                    error: Some(e.clone()),
                },
            );
            Err(e)
        }
    }
}

#[cfg(test)]
#[path = "query_export.test.rs"]
mod query_export_tests;
