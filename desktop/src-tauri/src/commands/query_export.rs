//! Streaming export of a full query result to a local file (spec §4/§5C).
//!
//! Headless `run_*_export` functions (testable without Tauri State) + one
//! thin command that owns the pool lock, the cancel registration, and the
//! `export-progress` events. Fail-closed: any error deletes the partial file.

use crate::db::pool::DbHandle;
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
            other => Err(format!("unsupported export format: {other} (csv | jsonl | json)")),
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

/// Read-only heuristic mirroring the frontend `isDestructiveQuery` set (spec §2:
/// never trust the frontend guard alone).
pub fn is_read_only_sql(sql: &str) -> bool {
    let k: String = sql
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_uppercase();
    !matches!(
        k.as_str(),
        "INSERT" | "UPDATE" | "DELETE" | "DROP" | "ALTER" | "TRUNCATE" | "CREATE" | "REPLACE"
    )
}

/// Validate export inputs: single, read-only statement + absolute path.
fn validate_export_inputs(sql: &str, path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Export path must be absolute".to_string());
    }
    if !is_read_only_sql(sql) {
        return Err("Export accepts read-only queries only (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/REPLACE are rejected)".to_string());
    }
    let statements = crate::db::sql_split::split_statements(sql);
    if statements.len() != 1 {
        return Err("Export accepts a single query".to_string());
    }
    Ok(())
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
    if guarded.contains(',') || guarded.contains('"') || guarded.contains('\n') || guarded.contains('\r') {
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
        obj.insert(c.name.clone(), row.get(i).cloned().unwrap_or(serde_json::Value::Null));
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

/// Run the export, deleting the partial file on any failure (fail-closed).
fn with_partial_cleanup<W, F>(path: &PathBuf, w: W, f: F) -> Result<ExportSummary, String>
where
    W: Write,
    F: FnOnce(&mut std::io::BufWriter<W>) -> Result<ExportSummary, String>,
{
    let mut writer = std::io::BufWriter::with_capacity(8 * 1024 * 1024, w);
    match f(&mut writer) {
        Ok(summary) => {
            writer.flush().map_err(|e| e.to_string())?;
            Ok(summary)
        }
        Err(e) => {
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
}

// ── SQLite (native streaming) ─────────────────────────────────────

pub fn run_sqlite_export(
    conn: &rusqlite::Connection,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    validate_export_inputs(sql, path)?;
    let file = std::fs::File::create(path).map_err(|e| format!("cannot create file: {e}"))?;

    with_partial_cleanup(path, file, |writer| {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
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
            let values: Vec<serde_json::Value> = (0..col_count)
                .map(|i| sqlite_ref_to_json(row, i))
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
    })
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

pub async fn run_pg_export(
    client: &tokio_postgres::Client,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    validate_export_inputs(sql, path)?;
    let file = std::fs::File::create(path).map_err(|e| format!("cannot create file: {e}"))?;
    let trimmed = sql.trim();
    let mut writer = std::io::BufWriter::with_capacity(8 * 1024 * 1024, file);

    // LINEAR FORM: run the cursor loop inline; on any error drop the writer
    // and remove the partial file.
    let run = async {
        client.simple_query("BEGIN").await.map_err(|e| format!("export begin failed: {e}"))?;
        if let Err(e) = client
            .simple_query(&format!("DECLARE {CURSOR_NAME} CURSOR FOR ({trimmed})"))
            .await
        {
            let _ = client.simple_query("ROLLBACK").await;
            return Err(format!("export declare failed: {e}"));
        }
        let mut columns: Vec<ColumnInfo> = Vec::new();
        let mut rows_written: u64 = 0;
        let mut first = true;
        if format == ExportFormat::Json {
            write!(writer, "[").map_err(|e| e.to_string())?;
        }
        loop {
            let msgs = client
                .simple_query(&format!("FETCH FORWARD {CURSOR_FETCH} FROM {CURSOR_NAME}"))
                .await;
            let msgs = match msgs {
                Ok(m) => m,
                Err(e) => {
                    let _ = client.simple_query("ROLLBACK").await;
                    return Err(format!("export fetch failed: {e}"));
                }
            };
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
                write_row(&mut writer, format, &columns, &row, first).map_err(|e| e.to_string())?;
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
        let _ = client.simple_query("ROLLBACK").await;
        progress(rows_written);
        Ok(ExportSummary { rows_written })
    }
    .await;

    match run {
        Ok(summary) => {
            writer.flush().map_err(|e| e.to_string())?;
            Ok(summary)
        }
        Err(e) => {
            drop(writer);
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
}

// ── MySQL (sqlx stream — native streaming) ─────────────────────────

pub async fn run_mysql_export(
    conn: &mut sqlx::mysql::MySqlConnection,
    sql: &str,
    format: ExportFormat,
    path: &PathBuf,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<ExportSummary, String> {
    validate_export_inputs(sql, path)?;
    let file = std::fs::File::create(path).map_err(|e| format!("cannot create file: {e}"))?;
    use futures_util::TryStreamExt;
    let mut writer = std::io::BufWriter::with_capacity(8 * 1024 * 1024, file);

    let run = async {
        let mut stream = sqlx::query(sql).fetch(&mut *conn);
        let mut columns: Vec<ColumnInfo> = Vec::new();
        let mut rows_written: u64 = 0;
        let mut first = true;
        if format == ExportFormat::Json {
            write!(writer, "[").map_err(|e| e.to_string())?;
        }
        while let Some(row) = stream.try_next().await.map_err(|e| {
            crate::commands::db_viewer::sanitize_error(&format!("{e}"))
        })? {
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
                    })
                    .collect();
                if format == ExportFormat::Csv {
                    write!(writer, "\u{FEFF}").map_err(|e| e.to_string())?; // UTF-8 BOM
                    writeln!(writer, "{}", csv_header(&columns)).map_err(|e| e.to_string())?;
                }
            }
            let values: Vec<serde_json::Value> =
                (0..row.len()).map(|i| crate::commands::query::mysql_cell_to_json(&row, i)).collect();
            write_row(&mut writer, format, &columns, &values, first).map_err(|e| e.to_string())?;
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
    .await;

    match run {
        Ok(summary) => {
            writer.flush().map_err(|e| e.to_string())?;
            Ok(summary)
        }
        Err(e) => {
            drop(writer);
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
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
        DbHandle::Sqlite(conn) => run_sqlite_export(conn, sql, format, path, progress),
        DbHandle::Postgresql(client, _) => run_pg_export(client, sql, format, path, progress).await,
        DbHandle::MySql(pool) => {
            let mut conn = pool
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            run_mysql_export(&mut *conn, sql, format, path, progress).await
        }
    }
}

#[tauri::command]
pub async fn export_query_to_file(
    connection_id: String,
    sql: String,
    format: String,
    path: String,
    state: State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    use tauri::Emitter;

    let fmt = ExportFormat::from_str(&format)?;
    let path_buf = PathBuf::from(&path);
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

    let mut pm = state.pool_manager.lock().await;
    let handle = pm
        .get(&connection_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    // MySQL: the STREAMING connection must be the one registered for
    // KILL QUERY cancellation — acquire it once here, register its id,
    // stream through it, then clear the registration.
    let result = match handle {
        DbHandle::MySql(pool) => {
            let mut conn = pool
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            let conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
                .fetch_one(&mut *conn)
                .await
                .unwrap_or(-1);
            state.cancel_registry.set_mysql_conn_id(&connection_id, Some(conn_id));
            let r = run_mysql_export(&mut *conn, &sql, fmt, &path_buf, &mut progress_cb).await;
            state.cancel_registry.set_mysql_conn_id(&connection_id, None);
            r
        }
        other => run_export_query(other, &sql, fmt, &path_buf, &mut progress_cb).await,
    };

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
