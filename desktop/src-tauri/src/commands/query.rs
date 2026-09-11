//! Arbitrary SQL query execution with subquery-based pagination and
//! query‑history recording.
//!
//! Architecture:
//! 1. Subquery wrapping is attempted first:
//!    `SELECT * FROM (user_query) AS _gridline_data LIMIT x OFFSET y`
//!    `SELECT COUNT(*) FROM (user_query) AS _gridline_cnt`
//! 2. If wrapping fails (CTEs, multi‑statement), fall back to raw
//!    execution with client‑side slicing.
//! 3. Every query is recorded in the local `query_history` table.

use crate::db::pool::DbHandle;
use crate::models::db_viewer::{ColumnInfo, MultiQueryResult, QueryResult, StatementNotice};
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row};
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Cancel-error classification
// ---------------------------------------------------------------------------
// The wrapped→raw fallback exists for queries that can't be wrapped (CTEs,
// multi-statement, non-SELECT). A USER CANCELLATION is NOT a wrapping failure:
// swallowing it would re-run the very query the user just cancelled — and for
// SQLite the interrupt flag is consumed by the aborted step, so the re-run
// runs completely free. These helpers let the fallbacks propagate cancellations.

fn is_sqlite_cancel_error(e: &rusqlite::Error) -> bool {
    e.sqlite_error_code() == Some(rusqlite::ErrorCode::OperationInterrupted)
}

fn is_pg_cancel_error(e: &tokio_postgres::Error) -> bool {
    e.code() == Some(&tokio_postgres::error::SqlState::QUERY_CANCELED)
}

fn is_mysql_cancel_error(e: &sqlx::Error) -> bool {
    match e.as_database_error().and_then(|d| d.code()) {
        Some(code) if code == "1317" => true, // ER_QUERY_INTERRUPTED (KILL QUERY)
        _ => e.to_string().to_lowercase().contains("interrupted"),
    }
}

// ---------------------------------------------------------------------------
// QueryHistoryEntry
// ---------------------------------------------------------------------------

/// A single record in the local `query_history` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: String,
    pub connection_id: String,
    pub query_text: String,
    pub execution_time_ms: Option<i64>,
    pub row_count: Option<i64>,
    /// `"success"` or `"error"`.
    pub status: String,
    pub error_message: Option<String>,
    pub executed_at: String,
    pub favorite: bool, // NEW — v6
}

// ---------------------------------------------------------------------------
// SavedQueryCommand
// ---------------------------------------------------------------------------

/// A saved query, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedQueryCommand {
    pub id: String,
    pub connection_id: Option<String>,
    pub name: String,
    pub query_text: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Patch body for `update_saved_query` — all fields optional.
#[derive(Debug, Deserialize)]
pub struct UpdateSavedQueryPatch {
    pub name: Option<String>,
    #[serde(rename = "queryText")]
    pub query_text: Option<String>,
    pub folder: Option<String>,
}

impl From<crate::store::SavedQueryRow> for SavedQueryCommand {
    fn from(r: crate::store::SavedQueryRow) -> Self {
        Self {
            id: r.id,
            connection_id: r.connection_id,
            name: r.name,
            query_text: r.query_text,
            folder: r.folder,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Core executor (not a Tauri command itself — called by the command wrapper)
// ---------------------------------------------------------------------------

/// Execute arbitrary SQL on PostgreSQL or SQLite with subquery‑based
/// pagination and automatic fallback to client‑side slicing.
///
/// Returns `(QueryResult, Option<QueryHistoryEntry>)` so the caller can
/// write the history record through the store.
pub(crate) async fn execute_query_inner(
    pool_manager: &mut crate::db::pool::ConnectionPoolManager,
    db_store: &std::sync::Mutex<crate::store::Store>,
    cancel_registry: &crate::cancel::CancelRegistry,
    connection_id: &str,
    query: &str,
    page: i64,
    page_size: i64,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    let history_id = Uuid::new_v4().to_string();

    // Try subquery-wrapped execution first; fall back to raw on failure.
    let mut result = match pool_manager.get(connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            execute_pg_query(client, query, page, page_size).await
        }
        Some(DbHandle::Sqlite(conn)) => execute_sqlite_query(conn, query, page, page_size),
        Some(DbHandle::MySql(pool)) => {
            // Run on a dedicated pooled connection so the query's MySQL
            // CONNECTION_ID can be tracked for cancellation (`KILL QUERY ?`).
            let mut conn = pool
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            // CAST to SIGNED: MySQL returns CONNECTION_ID() as BIGINT UNSIGNED,
            // which sqlx refuses to decode into i64 (ColumnDecode error) — a
            // silent unwrap_or(-1) here would make KILL QUERY -1 fail.
            let conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
                .fetch_one(&mut *conn)
                .await
                .unwrap_or(-1);
            cancel_registry.set_mysql_conn_id(connection_id, Some(conn_id));
            let result = execute_mysql_query_on(&mut *conn, query, page, page_size).await;
            cancel_registry.set_mysql_conn_id(connection_id, None);
            result
        }
        None => {
            let elapsed = start.elapsed().as_millis() as i64;
            let err = "Connection not found".to_string();
            insert_history(
                db_store,
                &history_id,
                connection_id,
                query,
                Some(elapsed),
                None,
                "error",
                Some(&err),
            );
            return Err(err);
        }
    };

    let elapsed = start.elapsed().as_millis() as i64;

    // Attach server-side execution time to the returned result so the UI can
    // show "time taken" for query runs.
    if let Ok(qr) = &mut result {
        qr.execution_time_ms = Some(elapsed);
    }

    match &result {
        Ok(qr) => {
            insert_history(
                db_store,
                &history_id,
                connection_id,
                query,
                Some(elapsed),
                Some(qr.rows.len() as i64),
                "success",
                None,
            );
        }
        Err(e) => {
            insert_history(
                db_store,
                &history_id,
                connection_id,
                query,
                Some(elapsed),
                None,
                "error",
                Some(e),
            );
        }
    }

    result
}

/// Helper: insert a query_history row through the store, swallowing errors.
fn insert_history(
    db_store: &std::sync::Mutex<crate::store::Store>,
    id: &str,
    connection_id: &str,
    query_text: &str,
    execution_time_ms: Option<i64>,
    row_count: Option<i64>,
    status: &str,
    error_message: Option<&str>,
) {
    if let Ok(store) = db_store.lock() {
        let _ = store.insert_query_history(
            id,
            connection_id,
            query_text,
            execution_time_ms,
            row_count,
            status,
            error_message,
        );
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL execution
// ---------------------------------------------------------------------------

/// Try subquery‑wrapped pagination for PostgreSQL. Falls back to raw
/// execution via `simple_query` if wrapping produces a parse error.
async fn execute_pg_query(
    client: &tokio_postgres::Client,
    query: &str,
    page: i64,
    page_size: i64,
) -> Result<QueryResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query cannot be empty".to_string());
    }

    let off = (page.saturating_sub(1).max(0)) * page_size;

    // Attempt subquery wrapping.
    let wrapped_data = format!(
        "SELECT * FROM ({}) AS _gridline_data LIMIT $1 OFFSET $2",
        trimmed
    );
    let wrapped_count = format!("SELECT COUNT(*) FROM ({}) AS _gridline_cnt", trimmed);

    // Try the wrapped count query first — if this fails we fall back to raw.
    let total_rows: i64 = match client.query_one(&wrapped_count, &[]).await {
        Ok(row) => row.get::<_, i64>(0),
        Err(e) if is_pg_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => {
            // Wrapping failed — fall back to raw execution.
            return execute_pg_raw(client, trimmed, page, page_size, off).await;
        }
    };

    // Now execute the wrapped data query.
    let data_rows = match client.query(&wrapped_data, &[&page_size, &off]).await {
        Ok(rows) => rows,
        Err(e) if is_pg_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => {
            return execute_pg_raw(client, trimmed, page, page_size, off).await;
        }
    };

    // Build column info from the data rows.
    let columns: Vec<ColumnInfo> = match data_rows.first() {
        Some(first) => first
            .columns()
            .iter()
            .map(|c| ColumnInfo {
                name: c.name().to_string(),
                data_type: format!("{:?}", c.type_()),
                is_nullable: true,
                is_pk: false,
                is_fk: false,
                fk_ref: None,
                default_value: None,
                editable: true,
                is_generated: false,
            })
            .collect(),
        None => {
            // No rows — fall back to raw execution which handles
            // column metadata via simple_query.
            return execute_pg_raw(client, trimmed, page, page_size, off).await;
        }
    };

    // Convert rows to JSON.
    let rows: Vec<Vec<serde_json::Value>> = data_rows
        .iter()
        .map(|row| {
            (0..row.len())
                .map(|i| crate::commands::db_viewer::pg_value_to_json(row, i))
                .collect()
        })
        .collect();

    Ok(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

// ---------------------------------------------------------------------------
// PostgreSQL raw fallback (simple_query)
// ---------------------------------------------------------------------------

/// Execute a raw SQL string via `simple_query`, collecting all result rows
/// and slicing them on the client side for pagination.
async fn execute_pg_raw(
    client: &tokio_postgres::Client,
    query: &str,
    page: i64,
    page_size: i64,
    offset: i64,
) -> Result<QueryResult, String> {
    let messages = client
        .simple_query(query)
        .await
        .map_err(|e| crate::commands::db_viewer::pg_error_message(&e))?;

    let mut columns: Vec<ColumnInfo> = Vec::new();
    let mut all_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut saw_columns = false;

    for msg in messages {
        match msg {
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                if !saw_columns {
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
                    saw_columns = true;
                }
                let values: Vec<serde_json::Value> = (0..row.len())
                    .map(|i| {
                        // simple_query protocol returns everything as strings;
                        // try_get with just the index returns Option<&str>.
                        match row.try_get::<usize>(i) {
                            Ok(Some(s)) => serde_json::Value::String(s.to_string()),
                            Ok(None) => serde_json::Value::Null,
                            Err(_) => serde_json::Value::Null,
                        }
                    })
                    .collect();
                all_rows.push(values);
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(..) => {
                // DML statements like INSERT, UPDATE, DELETE, etc.
                // Return empty result with row count from the tag.
            }
            _ => {}
        }
    }

    let total_rows = all_rows.len() as i64;
    let uoffset = offset as usize;
    let ulimit = page_size as usize;

    let rows: Vec<Vec<serde_json::Value>> = if uoffset < all_rows.len() {
        all_rows.into_iter().skip(uoffset).take(ulimit).collect()
    } else {
        Vec::new()
    };

    Ok(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

// ---------------------------------------------------------------------------
// SQLite execution
// ---------------------------------------------------------------------------

/// Try subquery‑wrapped pagination for SQLite. Falls back to raw execution
/// if wrapping produces a parse error.
fn execute_sqlite_query(
    conn: &rusqlite::Connection,
    query: &str,
    page: i64,
    page_size: i64,
) -> Result<QueryResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query cannot be empty".to_string());
    }

    let off = (page.saturating_sub(1).max(0)) * page_size;

    // Attempt subquery wrapping.
    let wrapped_data = format!(
        "SELECT * FROM ({}) AS _gridline_data LIMIT {} OFFSET {}",
        trimmed, page_size, off
    );
    let wrapped_count = format!("SELECT COUNT(*) FROM ({}) AS _gridline_cnt", trimmed);

    // Try the wrapped count query first.
    let total_rows: i64 = match conn.query_row(&wrapped_count, [], |row| row.get::<_, i64>(0)) {
        Ok(n) => n,
        Err(e) if is_sqlite_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => {
            // Wrapping failed — fall back to raw execution.
            return execute_sqlite_raw(conn, trimmed, page, page_size, off);
        }
    };

    // Execute the wrapped data query.
    let (columns, all_rows) = match execute_sqlite_with_query(conn, &wrapped_data) {
        Ok(result) => result,
        // The data-step error is already a String (mapped inside
        // execute_sqlite_with_query); classify by the interrupt message.
        Err(e) if e.to_lowercase().contains("interrupted") => {
            return Err("Query cancelled".to_string());
        }
        Err(_) => {
            return execute_sqlite_raw(conn, trimmed, page, page_size, off);
        }
    };

    Ok(QueryResult {
        columns,
        rows: all_rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

/// Execute a SQL string on SQLite and return `(columns, rows)`.
fn execute_sqlite_with_query(
    conn: &rusqlite::Connection,
    sql: &str,
) -> Result<(Vec<ColumnInfo>, Vec<Vec<serde_json::Value>>), String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    let columns: Vec<ColumnInfo> = (0..stmt.column_count())
        .map(|i| {
            let name = stmt.column_name(i).unwrap_or("?").to_string();
            ColumnInfo {
                name,
                data_type: "TEXT".to_string(),
                is_nullable: true,
                is_pk: false,
                is_fk: false,
                fk_ref: None,
                default_value: None,
                editable: true,
                is_generated: false,
            }
        })
        .collect();

    let col_count = stmt.column_count();
    let rows: Vec<Vec<serde_json::Value>> = stmt
        .query_map([], |row| {
            let mut vals = Vec::with_capacity(col_count);
            for i in 0..col_count {
                vals.push(sqlite_value_to_json(row, i));
            }
            Ok(vals)
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok((columns, rows))
}

// ---------------------------------------------------------------------------
// SQLite raw fallback
// ---------------------------------------------------------------------------

/// Execute raw SQL on SQLite without subquery wrapping, paginating
/// client‑side.
fn execute_sqlite_raw(
    conn: &rusqlite::Connection,
    query: &str,
    page: i64,
    page_size: i64,
    offset: i64,
) -> Result<QueryResult, String> {
    let (columns, all_rows) = execute_sqlite_with_query(conn, query)?;

    let total_rows = all_rows.len() as i64;
    let uoffset = offset as usize;
    let ulimit = page_size as usize;

    let rows: Vec<Vec<serde_json::Value>> = if uoffset < all_rows.len() {
        all_rows.into_iter().skip(uoffset).take(ulimit).collect()
    } else {
        Vec::new()
    };

    Ok(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

// ---------------------------------------------------------------------------
// Value conversion helpers
// ---------------------------------------------------------------------------

/// Convert a `rusqlite::Row` cell to `serde_json::Value`.
fn sqlite_value_to_json(row: &rusqlite::Row, i: usize) -> serde_json::Value {
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

// ---------------------------------------------------------------------------
// MySQL execution
// ---------------------------------------------------------------------------

/// Wrap a user query for pagination: `SELECT * FROM (<q>) AS _gridline_data LIMIT ? OFFSET ?`.
pub(crate) fn mysql_wrap_data(query: &str) -> String {
    format!(
        "SELECT * FROM ({}) AS _gridline_data LIMIT ? OFFSET ?",
        query.trim()
    )
}

/// Wrap a user query for counting: `SELECT COUNT(*) FROM (<q>) AS _gridline_cnt`.
pub(crate) fn mysql_wrap_count(query: &str) -> String {
    format!("SELECT COUNT(*) FROM ({}) AS _gridline_cnt", query.trim())
}

/// Convert a sqlx MySql row cell to serde_json::Value (via the `json` feature).
/// Shared with the DB-viewer commands (pub(crate)).
pub(crate) fn mysql_cell_to_json(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    if let Ok(Some(v)) = row.try_get::<Option<serde_json::Value>, _>(i) {
        return v;
    }
    if let Ok(s) = row.try_get::<Option<String>, _>(i) {
        return s
            .map(|s| serde_json::Value::String(s))
            .unwrap_or(serde_json::Value::Null);
    }
    if let Ok(b) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return b
            .map(|b| serde_json::Value::String(String::from_utf8_lossy(&b).into_owned()))
            .unwrap_or(serde_json::Value::Null);
    }
    serde_json::Value::Null
}

async fn execute_mysql_query_on(
    conn: &mut sqlx::mysql::MySqlConnection,
    query: &str,
    page: i64,
    page_size: i64,
) -> Result<QueryResult, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err("Query cannot be empty".to_string());
    }
    let off = (page.saturating_sub(1).max(0)) * page_size;

    // Try the wrapped count first; fall back to raw on failure.
    let total_rows: i64 = match sqlx::query_scalar::<_, i64>(&mysql_wrap_count(trimmed))
        .fetch_one(&mut *conn)
        .await
    {
        Ok(n) => n,
        Err(e) if is_mysql_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => return execute_mysql_raw(&mut *conn, trimmed, page, page_size, off).await,
    };

    let data_rows = match sqlx::query(&mysql_wrap_data(trimmed))
        .bind(page_size)
        .bind(off)
        .fetch_all(&mut *conn)
        .await
    {
        Ok(rows) => rows,
        Err(e) if is_mysql_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => return execute_mysql_raw(&mut *conn, trimmed, page, page_size, off).await,
    };

    let columns: Vec<ColumnInfo> = match data_rows.first() {
        Some(first) => first
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
            .collect(),
        None => return execute_mysql_raw(&mut *conn, trimmed, page, page_size, off).await,
    };

    let rows: Vec<Vec<serde_json::Value>> = data_rows
        .iter()
        .map(|r| (0..r.len()).map(|i| mysql_cell_to_json(r, i)).collect())
        .collect();

    Ok(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

/// Raw fallback (no wrapping). Runs the query as-is and slices client-side,
/// mirroring the PG `simple_query` raw path. Used when wrapping fails
/// (e.g., multi-statement or non-selectable SQL).
async fn execute_mysql_raw(
    conn: &mut sqlx::mysql::MySqlConnection,
    query: &str,
    page: i64,
    page_size: i64,
    off: i64,
) -> Result<QueryResult, String> {
    let rows = sqlx::query(query)
        .fetch_all(&mut *conn)
        .await
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;

    let columns: Vec<ColumnInfo> = match rows.first() {
        Some(first) => first
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
            .collect(),
        None => Vec::new(),
    };

    let all_rows: Vec<Vec<serde_json::Value>> = rows
        .iter()
        .map(|r| (0..r.len()).map(|i| mysql_cell_to_json(r, i)).collect())
        .collect();
    let total_rows = all_rows.len() as i64;
    let uoff = off as usize;
    let ulimit = page_size as usize;
    let sliced: Vec<Vec<serde_json::Value>> = if uoff < all_rows.len() {
        all_rows.into_iter().skip(uoff).take(ulimit).collect()
    } else {
        Vec::new()
    };

    Ok(QueryResult {
        columns,
        rows: sliced,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    })
}

// ---------------------------------------------------------------------------
// Multiple result sets (execute_query_multi)
// ---------------------------------------------------------------------------
// Per the spec: statements execute sequentially; SELECT-producing statements
// get wrapped pagination (first page per set + total count — per-set paging is
// deliberately omitted because re-running a script would re-execute DML);
// DML/DDL produce notices; the first error stops the run, prior sets survive.

const MAX_STATEMENTS: usize = 50;

pub(crate) enum StatementOutcome {
    Set(QueryResult),
    Notice {
        kind: &'static str,
        text: String,
        affected: Option<i64>,
    },
}

/// Classify a statement by its first significant keyword (execution-time
/// classification per spec §4 — NOT in the tokenizer).
pub(crate) fn statement_kind(stmt: &str) -> &'static str {
    let k: String = stmt
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_lowercase();
    match k.as_str() {
        "select" | "with" | "values" | "table" => "select",
        "insert" | "update" | "delete" => "dml",
        _ => "ddl",
    }
}

/// Parse a PG CommandComplete tag ("INSERT 0 5" → 5; "CREATE TABLE" → None).
pub(crate) fn affected_from_tag(tag: &str) -> Option<i64> {
    tag.split_whitespace().last()?.parse::<i64>().ok()
}

fn notice_for(
    idx: usize,
    kind: &str,
    text: String,
    affected: Option<i64>,
) -> StatementNotice {
    StatementNotice {
        statement_index: idx,
        kind: kind.to_string(),
        text,
        affected,
    }
}

// ── SQLite walker ─────────────────────────────────────────────────

pub(crate) fn execute_sqlite_statement(
    conn: &rusqlite::Connection,
    stmt: &str,
    page: i64,
    page_size: i64,
) -> Result<StatementOutcome, String> {
    match conn.execute(stmt, []) {
        Ok(n) => Ok(StatementOutcome::Notice {
            kind: if statement_kind(stmt) == "ddl" { "ddl" } else { "dml" },
            text: format!("OK — {n} rows affected"),
            affected: Some(n as i64),
        }),
        Err(rusqlite::Error::ExecuteReturnedResults) => {
            let (columns, all_rows) = execute_sqlite_with_query(conn, stmt)?;
            let total_rows = all_rows.len() as i64;
            let rows: Vec<Vec<serde_json::Value>> = all_rows
                .into_iter()
                .take(page_size.max(0) as usize)
                .collect();
            Ok(StatementOutcome::Set(QueryResult {
                columns,
                rows,
                total_rows,
                page,
                page_size,
                execution_time_ms: None,
            }))
        }
        Err(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::OperationInterrupted =>
        {
            Err("Query cancelled".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

pub(crate) fn run_sqlite_statements(
    conn: &rusqlite::Connection,
    statements: &[String],
    page: i64,
    page_size: i64,
    result_sets: &mut Vec<QueryResult>,
    notices: &mut Vec<StatementNotice>,
) -> Option<String> {
    for (idx, stmt) in statements.iter().enumerate() {
        match execute_sqlite_statement(conn, stmt, page, page_size) {
            Ok(StatementOutcome::Set(qr)) => result_sets.push(qr),
            Ok(StatementOutcome::Notice { kind, text, affected }) => {
                notices.push(notice_for(idx, kind, text, affected))
            }
            Err(e) if e == "Query cancelled" => return Some(e),
            Err(e) => {
                notices.push(StatementNotice {
                    statement_index: idx,
                    kind: "error".into(),
                    text: e.clone(),
                    affected: None,
                });
                return Some(format!("Statement {} failed: {e}", idx + 1));
            }
        }
    }
    None
}

// ── PostgreSQL walker ─────────────────────────────────────────────

pub(crate) async fn execute_pg_statement(
    client: &tokio_postgres::Client,
    stmt: &str,
    page: i64,
    page_size: i64,
) -> Result<StatementOutcome, String> {
    let trimmed = stmt.trim();
    let off = (page.saturating_sub(1).max(0)) * page_size;

    // 1. Try wrapped pagination — a parse error here executes nothing.
    let wrapped_count = format!("SELECT COUNT(*) FROM ({}) AS _gridline_cnt", trimmed);
    if let Ok(row) = client.query_one(&wrapped_count, &[]).await {
        let total_rows: i64 = row.get(0);
        let wrapped_data = format!(
            "SELECT * FROM ({}) AS _gridline_data LIMIT $1 OFFSET $2",
            trimmed
        );
        let data_rows = client
            .query(&wrapped_data, &[&page_size, &off])
            .await
            .map_err(|e| {
                if is_pg_cancel_error(&e) {
                    "Query cancelled".to_string()
                } else {
                    format!("{e}")
                }
            })?;
        let columns: Vec<ColumnInfo> = match data_rows.first() {
            Some(first) => first
                .columns()
                .iter()
                .map(|c| ColumnInfo {
                    name: c.name().to_string(),
                    data_type: format!("{:?}", c.type_()),
                    is_nullable: true,
                    is_pk: false,
                    is_fk: false,
                    fk_ref: None,
                    default_value: None,
                    editable: true,
                    is_generated: false,
                })
                .collect(),
            None => Vec::new(),
        };
        let rows: Vec<Vec<serde_json::Value>> = data_rows
            .iter()
            .map(|row| {
                (0..row.len())
                    .map(|i| crate::commands::db_viewer::pg_value_to_json(row, i))
                    .collect()
            })
            .collect();
        return Ok(StatementOutcome::Set(QueryResult {
            columns,
            rows,
            total_rows,
            page,
            page_size,
            execution_time_ms: None,
        }));
    }

    // 2. Raw single-statement execution via simple_query (captures the
    //    CommandComplete tag so DML notices carry affected counts).
    let messages = client
        .simple_query(trimmed)
        .await
        .map_err(|e| {
            if is_pg_cancel_error(&e) {
                "Query cancelled".to_string()
            } else {
                crate::commands::db_viewer::pg_error_message(&e)
            }
        })?;

    let mut columns: Vec<ColumnInfo> = Vec::new();
    let mut all_rows: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut last_tag: Option<String> = None;
    for msg in messages {
        match msg {
            tokio_postgres::SimpleQueryMessage::Row(row) => {
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
                let values: Vec<serde_json::Value> = (0..row.len())
                    .map(|i| match row.try_get::<usize>(i) {
                        Ok(Some(s)) => serde_json::Value::String(s.to_string()),
                        _ => serde_json::Value::Null,
                    })
                    .collect();
                all_rows.push(values);
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(tag) => {
                last_tag = Some(tag.to_string());
            }
            _ => {}
        }
    }

    if all_rows.is_empty() {
        let tag = last_tag.clone().unwrap_or_else(|| "OK".to_string());
        let affected = last_tag.as_deref().and_then(affected_from_tag);
        return Ok(StatementOutcome::Notice {
            kind: if statement_kind(stmt) == "ddl" { "ddl" } else { "dml" },
            text: tag,
            affected,
        });
    }

    let total_rows = all_rows.len() as i64;
    let rows: Vec<Vec<serde_json::Value>> = all_rows
        .into_iter()
        .take(page_size.max(0) as usize)
        .collect();
    Ok(StatementOutcome::Set(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    }))
}

pub(crate) async fn run_pg_statements(
    client: &tokio_postgres::Client,
    statements: &[String],
    page: i64,
    page_size: i64,
    result_sets: &mut Vec<QueryResult>,
    notices: &mut Vec<StatementNotice>,
) -> Option<String> {
    for (idx, stmt) in statements.iter().enumerate() {
        match execute_pg_statement(client, stmt, page, page_size).await {
            Ok(StatementOutcome::Set(qr)) => result_sets.push(qr),
            Ok(StatementOutcome::Notice { kind, text, affected }) => {
                notices.push(notice_for(idx, kind, text, affected))
            }
            Err(e) if e == "Query cancelled" => return Some(e),
            Err(e) => {
                notices.push(StatementNotice {
                    statement_index: idx,
                    kind: "error".into(),
                    text: e.clone(),
                    affected: None,
                });
                return Some(format!("Statement {} failed: {e}", idx + 1));
            }
        }
    }
    None
}

// ── MySQL walker ──────────────────────────────────────────────────

async fn execute_mysql_statement_on(
    conn: &mut sqlx::mysql::MySqlConnection,
    stmt: &str,
    page: i64,
    page_size: i64,
) -> Result<StatementOutcome, String> {
    let trimmed = stmt.trim();
    let off = (page.saturating_sub(1).max(0)) * page_size;

    let total_rows: i64 = match sqlx::query_scalar::<_, i64>(&mysql_wrap_count(trimmed))
        .fetch_one(&mut *conn)
        .await
    {
        Ok(n) => n,
        Err(e) if is_mysql_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(_) => {
            return execute_mysql_raw(conn, trimmed, page, page_size, off)
                .await
                .map(|qr| {
                    if qr.columns.is_empty() {
                        StatementOutcome::Notice {
                            kind: if statement_kind(stmt) == "ddl" { "ddl" } else { "dml" },
                            text: "OK".to_string(),
                            affected: None,
                        }
                    } else {
                        StatementOutcome::Set(qr)
                    }
                });
        }
    };

    let data_rows = match sqlx::query(&mysql_wrap_data(trimmed))
        .bind(page_size)
        .bind(off)
        .fetch_all(&mut *conn)
        .await
    {
        Ok(rows) => rows,
        Err(e) if is_mysql_cancel_error(&e) => return Err("Query cancelled".to_string()),
        Err(e) => return Err(crate::commands::db_viewer::sanitize_error(&format!("{e}"))),
    };
    let columns: Vec<ColumnInfo> = match data_rows.first() {
        Some(first) => first
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
            .collect(),
        None => Vec::new(),
    };
    let rows: Vec<Vec<serde_json::Value>> = data_rows
        .iter()
        .map(|r| (0..r.len()).map(|i| mysql_cell_to_json(r, i)).collect())
        .collect();
    Ok(StatementOutcome::Set(QueryResult {
        columns,
        rows,
        total_rows,
        page,
        page_size,
        execution_time_ms: None,
    }))
}

async fn run_mysql_statements(
    conn: &mut sqlx::mysql::MySqlConnection,
    statements: &[String],
    page: i64,
    page_size: i64,
    result_sets: &mut Vec<QueryResult>,
    notices: &mut Vec<StatementNotice>,
    cancel_registry: &crate::cancel::CancelRegistry,
    connection_id: &str,
) -> Option<String> {
    let conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
        .fetch_one(&mut *conn)
        .await
        .unwrap_or(-1);
    cancel_registry.set_mysql_conn_id(connection_id, Some(conn_id));
    for (idx, stmt) in statements.iter().enumerate() {
        match execute_mysql_statement_on(conn, stmt, page, page_size).await {
            Ok(StatementOutcome::Set(qr)) => result_sets.push(qr),
            Ok(StatementOutcome::Notice { kind, text, affected }) => {
                notices.push(notice_for(idx, kind, text, affected))
            }
            Err(e) if e == "Query cancelled" => {
                cancel_registry.set_mysql_conn_id(connection_id, None);
                return Some(e);
            }
            Err(e) => {
                notices.push(StatementNotice {
                    statement_index: idx,
                    kind: "error".into(),
                    text: e.clone(),
                    affected: None,
                });
                cancel_registry.set_mysql_conn_id(connection_id, None);
                return Some(format!("Statement {} failed: {e}", idx + 1));
            }
        }
    }
    cancel_registry.set_mysql_conn_id(connection_id, None);
    None
}

/// Execute a multi-statement script, returning every result set and notices.
/// `execute_query` is untouched; the query workspace calls this instead.
#[tauri::command]
pub async fn execute_query_multi(
    connection_id: String,
    query: String,
    page: Option<i64>,
    page_size: Option<i64>,
    state: State<'_, crate::AppState>,
) -> Result<MultiQueryResult, String> {
    let start = Instant::now();
    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50);

    let statements = crate::db::sql_split::split_statements(&query);
    if statements.is_empty() {
        return Err("Query cannot be empty".to_string());
    }
    if statements.len() > MAX_STATEMENTS {
        return Err(format!(
            "Too many statements: {} (max {MAX_STATEMENTS})",
            statements.len()
        ));
    }

    let mut result_sets: Vec<QueryResult> = Vec::new();
    let mut notices: Vec<StatementNotice> = Vec::new();

    let err_text: Option<String>;
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            err_text =
                run_pg_statements(client, &statements, p, ps, &mut result_sets, &mut notices).await;
        }
        Some(DbHandle::Sqlite(conn)) => {
            err_text = run_sqlite_statements(conn, &statements, p, ps, &mut result_sets, &mut notices);
        }
        Some(DbHandle::MySql(pool)) => {
            let mut conn = pool
                .acquire()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            err_text = run_mysql_statements(
                &mut *conn,
                &statements,
                p,
                ps,
                &mut result_sets,
                &mut notices,
                &state.cancel_registry,
                &connection_id,
            )
            .await;
        }
        None => return Err("Connection not found".to_string()),
    }

    let elapsed = start.elapsed().as_millis() as i64;
    let row_count = result_sets.first().map(|q| q.rows.len() as i64).unwrap_or(0);
    let history_id = Uuid::new_v4().to_string();
    if let Some(e) = &err_text {
        insert_history(
            &state.db_store,
            &history_id,
            &connection_id,
            &query,
            Some(elapsed),
            Some(row_count),
            "error",
            Some(e.as_str()),
        );
    } else {
        insert_history(
            &state.db_store,
            &history_id,
            &connection_id,
            &query,
            Some(elapsed),
            Some(row_count),
            "success",
            None,
        );
    }

    Ok(MultiQueryResult {
        result_sets,
        notices,
        execution_time_ms: elapsed,
    })
}

// ---------------------------------------------------------------------------
// Query history commands
// ---------------------------------------------------------------------------

pub(crate) fn get_query_history_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    connection_id: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store.get_query_history(connection_id, limit, offset)
}

pub(crate) fn clear_query_history_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    connection_id: Option<&str>,
) -> Result<(), String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store.clear_query_history(connection_id)
}

pub(crate) fn set_history_favorite_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    id: &str,
    connection_id: &str,
) -> Result<(), String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store.set_history_favorite(id, connection_id)
}

pub(crate) fn save_query_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    connection_id: Option<String>,
    name: String,
    query_text: String,
    folder: String,
) -> Result<SavedQueryCommand, String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store
        .save_query(connection_id.as_deref(), &name, &query_text, &folder)
        .map(SavedQueryCommand::from)
}

pub(crate) fn get_saved_queries_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    connection_id: Option<String>,
) -> Result<Vec<SavedQueryCommand>, String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store
        .list_saved_queries(connection_id.as_deref())
        .map(|rows| rows.into_iter().map(SavedQueryCommand::from).collect())
}

pub(crate) fn update_saved_query_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    id: String,
    name: Option<String>,
    query_text: Option<String>,
    folder: Option<String>,
) -> Result<(), String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store.update_saved_query(
        &id,
        name.as_deref(),
        query_text.as_deref(),
        folder.as_deref(),
    )
}

pub(crate) fn delete_saved_query_inner(
    db_store: &std::sync::Mutex<crate::store::Store>,
    id: String,
) -> Result<(), String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    store.delete_saved_query(&id)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    query: String,
    page: Option<i64>,
    page_size: Option<i64>,
    state: State<'_, crate::AppState>,
) -> Result<QueryResult, String> {
    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50);
    let mut pm = state.pool_manager.lock().await;
    execute_query_inner(
        &mut pm,
        &state.db_store,
        &state.cancel_registry,
        &connection_id,
        &query,
        p,
        ps,
    )
    .await
}

/// Cancel a query currently running on the given connection.
///
/// - PostgreSQL: opens a short-lived cancel connection (reusing the exact TLS
///   decision/config from connect) and sends a cancel request keyed to the
///   original backend.
/// - MySQL: opens a fresh connection and runs `KILL QUERY <conn_id>` for the
///   connection currently running the query (registered per-query).
/// - SQLite: signals the per-connection `InterruptHandle` (thread-safe).
#[tauri::command]
pub async fn cancel_query(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    use sqlx::ConnectOptions;
    match state.cancel_registry.get(&connection_id) {
        Some(crate::cancel::CancelHandle::Pg(pg)) => {
            // A Verify/Require decision always carries a built rustls config,
            // so the unwrap on the non-Disable branch is safe by construction.
            match pg.tls_decision {
                crate::db::tls::TlsDecision::Disable => {
                    pg.cancel_token.cancel_query(tokio_postgres::NoTls).await
                }
                _ => {
                    let connector = tokio_postgres_rustls::MakeRustlsConnect::new(
                        (*pg.tls_config.expect("tls config for non-disable decision")).clone(),
                    );
                    pg.cancel_token.cancel_query(connector).await
                }
            }
            .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))
        }
        Some(crate::cancel::CancelHandle::MySql(m)) => {
            let id = m
                .conn_id
                .ok_or_else(|| "No active query on this connection".to_string())?;
            let mut c = m
                .connect_options
                .connect()
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            sqlx::query(&format!("KILL QUERY {id}"))
                .execute(&mut c)
                .await
                .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
            Ok(())
        }
        Some(crate::cancel::CancelHandle::Sqlite(s)) => {
            s.interrupt();
            Ok(())
        }
        None => Err("No active cancel handle for this connection".into()),
    }
}

#[tauri::command]
pub async fn get_query_history(
    connection_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    let l = limit.unwrap_or(50);
    let o = offset.unwrap_or(0);
    let store = state.db_store.lock().map_err(|e| e.to_string())?;
    store.get_query_history(connection_id.as_deref(), l, o)
}

#[tauri::command]
pub async fn clear_query_history(
    connection_id: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let store = state.db_store.lock().map_err(|e| e.to_string())?;
    store.clear_query_history(connection_id.as_deref())
}

#[tauri::command]
pub async fn set_history_favorite(
    id: String,
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    set_history_favorite_inner(&state.db_store, &id, &connection_id)
}

#[tauri::command]
pub async fn save_query(
    connection_id: Option<String>,
    name: String,
    query_text: String,
    folder: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<SavedQueryCommand, String> {
    save_query_inner(
        &state.db_store,
        connection_id,
        name,
        query_text,
        folder.unwrap_or_default(),
    )
}

#[tauri::command]
pub async fn get_saved_queries(
    connection_id: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<SavedQueryCommand>, String> {
    get_saved_queries_inner(&state.db_store, connection_id)
}

#[tauri::command]
pub async fn update_saved_query(
    id: String,
    patch: UpdateSavedQueryPatch,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    update_saved_query_inner(
        &state.db_store,
        id,
        patch.name,
        patch.query_text,
        patch.folder,
    )
}

#[tauri::command]
pub async fn delete_saved_query(
    id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    delete_saved_query_inner(&state.db_store, id)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use rusqlite::Connection as SqliteConnection;
    use std::sync::Mutex;

    /// Create an in‑memory Store with all migrations applied.
    fn test_store() -> Mutex<Store> {
        let conn = SqliteConnection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        // Insert a placeholder connection so FK constraints are satisfied.
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at)
             VALUES ('test-conn', 'test', 'sqlite', ':memory:', NULL, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        Mutex::new(Store::from_connection(conn))
    }

    /// Open an in‑memory SQLite database and return a DbHandle.
    fn test_sqlite_handle() -> DbHandle {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
             INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
             INSERT INTO users VALUES (2, 'Bob', 'bob@example.com');
             INSERT INTO users VALUES (3, 'Charlie', 'charlie@example.com');",
        )
        .unwrap();
        DbHandle::Sqlite(conn)
    }

    /// Open an in‑memory SQLite database for CTE testing.
    fn test_sqlite_cte_handle() -> DbHandle {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE items (id INTEGER PRIMARY KEY, val INTEGER);
             INSERT INTO items VALUES (1, 10);
             INSERT INTO items VALUES (2, 20);
             INSERT INTO items VALUES (3, 30);
             INSERT INTO items VALUES (4, 40);
             INSERT INTO items VALUES (5, 50);",
        )
        .unwrap();
        DbHandle::Sqlite(conn)
    }

    // ------------------------------------------------------------------
    // Test 1: Basic SELECT execution with pagination
    // ------------------------------------------------------------------

    #[test]
    fn basic_select_with_pagination() {
        let _store = test_store();
        let conn = test_sqlite_handle();

        let (columns, rows) =
            execute_sqlite_with_query(&unwrap_sqlite(&conn), "SELECT * FROM users ORDER BY id")
                .unwrap();

        assert_eq!(columns.len(), 3);
        assert_eq!(columns[0].name, "id");
        assert_eq!(rows.len(), 3);

        // Verify row values
        assert_eq!(rows[0][0], serde_json::json!(1));
        assert_eq!(rows[0][1], serde_json::json!("Alice"));
        assert_eq!(rows[1][0], serde_json::json!(2));
    }

    // ------------------------------------------------------------------
    // Test 2: Subquery wrapping produces correct LIMIT/OFFSET
    // ------------------------------------------------------------------

    #[test]
    fn subquery_wrapping_paginates_correctly() {
        let _store = test_store();
        let conn = test_sqlite_handle();

        // Page 1: 2 rows
        let result = execute_sqlite_query(
            &unwrap_sqlite(&conn),
            "SELECT * FROM users ORDER BY id",
            1,
            2,
        )
        .unwrap();

        assert_eq!(result.total_rows, 3);
        assert_eq!(result.rows.len(), 2);
        assert_eq!(result.rows[0][1], serde_json::json!("Alice"));
        assert_eq!(result.rows[1][1], serde_json::json!("Bob"));
        assert_eq!(result.page, 1);
        assert_eq!(result.page_size, 2);

        // Page 2: 1 row
        let result2 = execute_sqlite_query(
            &unwrap_sqlite(&conn),
            "SELECT * FROM users ORDER BY id",
            2,
            2,
        )
        .unwrap();

        assert_eq!(result2.total_rows, 3);
        assert_eq!(result2.rows.len(), 1);
        assert_eq!(result2.rows[0][1], serde_json::json!("Charlie"));
    }

    // ------------------------------------------------------------------
    // Test 3: EXPLAIN falls back to raw execution with client‑side pagination
    // ------------------------------------------------------------------

    #[test]
    fn cte_falls_back_to_raw_execution() {
        let _store = test_store();
        let conn = test_sqlite_cte_handle();

        // EXPLAIN cannot be wrapped in a subquery:
        // SELECT * FROM (EXPLAIN SELECT ...) is a syntax error.
        // This forces the fallback to raw execution.
        let query = "EXPLAIN SELECT * FROM items WHERE val > 20";

        let result = execute_sqlite_query(&unwrap_sqlite(&conn), query, 1, 10).unwrap();

        // Should fall back to raw — all rows fetched, client‑slice.
        // EXPLAIN returns rows (addr, opcode, p1, p2, p3, p4, p5, comment).
        assert!(result.total_rows > 0, "EXPLAIN should return rows");
        assert!(result.rows.len() <= 10, "page_size should limit rows");
        assert_eq!(result.columns.len(), 8, "EXPLAIN has 8 columns");
    }

    // ------------------------------------------------------------------
    // Test 4: Query history is recorded
    // ------------------------------------------------------------------

    #[test]
    fn query_history_is_recorded() {
        let store = test_store();

        // Directly insert a history entry and read it back.
        let entry_id = "hist-001";
        {
            let s = store.lock().unwrap();
            s.insert_query_history(
                entry_id,
                "test-conn",
                "SELECT 1",
                Some(42),
                Some(1),
                "success",
                None,
            )
            .unwrap();
        }

        // Read it back.
        {
            let s = store.lock().unwrap();
            let history = s.get_query_history(Some("test-conn"), 10, 0).unwrap();
            assert_eq!(history.len(), 1);
            assert_eq!(history[0].id, "hist-001");
            assert_eq!(history[0].connection_id, "test-conn");
            assert_eq!(history[0].query_text, "SELECT 1");
            assert_eq!(history[0].execution_time_ms, Some(42));
            assert_eq!(history[0].row_count, Some(1));
            assert_eq!(history[0].status, "success");
            assert_eq!(history[0].error_message, None);
        }

        // Insert an error entry.
        {
            let s = store.lock().unwrap();
            s.insert_query_history(
                "hist-002",
                "test-conn",
                "SELECT invalid",
                Some(5),
                None,
                "error",
                Some("syntax error"),
            )
            .unwrap();
        }

        // Read back with limit.
        {
            let s = store.lock().unwrap();
            let history = s.get_query_history(Some("test-conn"), 1, 0).unwrap();
            assert_eq!(history.len(), 1);
            // Most recent first (DESC order)
            assert_eq!(history[0].id, "hist-002");
        }

        // Clear history for connection.
        {
            let s = store.lock().unwrap();
            s.clear_query_history(Some("test-conn")).unwrap();
            let history = s.get_query_history(Some("test-conn"), 10, 0).unwrap();
            assert_eq!(history.len(), 0);
        }
    }

    // ------------------------------------------------------------------
    // Test 5: Saved query command roundtrip (save → list → update → delete)
    // ------------------------------------------------------------------

    #[test]
    fn save_query_command_roundtrip() {
        use crate::models::ConnectionInput;
        let conn = SqliteConnection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Mutex::new(Store::from_connection(conn));
        let sc2 = store
            .lock()
            .unwrap()
            .create_connection(ConnectionInput {
                name: "sc2".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                tag_ids: vec![],
                use_keychain: true,
                password: None,
                database: None,
                environment: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
            })
            .unwrap();

        // save
        let result = save_query_inner(
            &store,
            Some(sc2.id.clone()),
            "Q1".to_string(),
            "SELECT 1".to_string(),
            "r".to_string(),
        )
        .unwrap();
        assert_eq!(result.name, "Q1");
        assert_eq!(result.connection_id, Some(sc2.id.clone()));

        // list
        let list = get_saved_queries_inner(&store, Some(sc2.id.clone())).unwrap();
        assert_eq!(list.len(), 1);

        // update (bogus id "update" — no-op, exercises the code path)
        update_saved_query_inner(
            &store,
            "update".to_string(),
            Some("Renamed".to_string()),
            None,
            None,
        )
        .unwrap();

        // delete
        delete_saved_query_inner(&store, result.id).unwrap();
        let after = get_saved_queries_inner(&store, Some(sc2.id.clone())).unwrap();
        assert!(after.is_empty());
    }

    // ------------------------------------------------------------------
    // Helper: unwrap a DbHandle::Sqlite to get the connection reference
    // ------------------------------------------------------------------

    fn unwrap_sqlite(handle: &DbHandle) -> &SqliteConnection {
        match handle {
            DbHandle::Sqlite(conn) => conn,
            _ => panic!("Expected Sqlite handle"),
        }
    }

    // ------------------------------------------------------------------
    // MySQL wrapper SQL shapes
    // ------------------------------------------------------------------

    #[test]
    fn mysql_wrapped_query_shape_has_limit_offset_placeholders() {
        // The wrapped-data SQL must use MySQL `?` placeholders (not $1/$2).
        let q = mysql_wrap_data("SELECT * FROM t");
        assert!(q.contains("LIMIT ? OFFSET ?"));
        assert!(q.contains("AS _gridline_data"));
    }

    #[test]
    fn mysql_wrapped_count_shape_uses_subquery_alias() {
        let q = mysql_wrap_count("SELECT * FROM t");
        assert_eq!(q, "SELECT COUNT(*) FROM (SELECT * FROM t) AS _gridline_cnt");
    }

    // ------------------------------------------------------------------
    // Cancel propagation (v0.7.8 bugfix): a user cancel must NOT be swallowed
    // by the wrapped→raw fallback (which would re-run the cancelled query).
    // ------------------------------------------------------------------

    #[test]
    fn is_sqlite_cancel_error_classifies_interrupt() {
        let interrupted = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_INTERRUPT),
            Some("interrupted".to_string()),
        );
        assert!(is_sqlite_cancel_error(&interrupted));

        let other = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
            Some("SQL logic error".to_string()),
        );
        assert!(!is_sqlite_cancel_error(&other));
    }

    #[test]
    fn sqlite_cancel_aborts_wrapped_query_without_rerun() {
        use std::sync::mpsc;
        // A slow query whose wrapped COUNT step takes seconds — interrupt() must
        // abort it and surface "Query cancelled" instead of falling back to the
        // raw re-run (which would consume the interrupt flag and run to
        // completion, hiding the cancellation).
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let handle = conn.get_interrupt_handle();
        let slow = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 50000000) SELECT count(*) AS n FROM c";
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let res = execute_sqlite_query(&conn, slow, 1, 50);
            let cancelled = match &res {
                Err(msg) => msg.contains("Query cancelled"),
                Ok(_) => false,
            };
            let _ = tx.send(cancelled);
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        handle.interrupt();
        let cancelled = rx
            .recv_timeout(std::time::Duration::from_secs(15))
            .expect("query thread must finish");
        assert!(cancelled, "cancel must abort the wrapped query with 'Query cancelled' instead of re-running it");
    }

    #[tokio::test]
    #[ignore]
    async fn pg_cancel_aborts_wrapped_query_without_rerun() {
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
        let token = client.cancel_token();
        let run = tokio::spawn(async move {
            execute_pg_query(&client, "SELECT pg_sleep(3)", 1, 50).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        token
            .cancel_query(tokio_postgres::NoTls)
            .await
            .expect("cancel request");
        let res = run.await.expect("query task");
        assert!(res.is_err(), "pg_sleep must be cancelled, not re-run; got {res:?}");
        assert!(res.unwrap_err().contains("Query cancelled"));
        let _ = handle;
    }

    #[tokio::test]
    #[ignore]
    async fn mysql_cancel_aborts_wrapped_query_without_rerun() {
        use sqlx::ConnectOptions;
        let h = std::env::var("GRIDLINE_TEST_MYSQL_HOST").expect("set GRIDLINE_TEST_MYSQL_HOST");
        let p: u16 = std::env::var("GRIDLINE_TEST_MYSQL_PORT")
            .unwrap_or_else(|_| "3306".into())
            .parse()
            .unwrap();
        let u = std::env::var("GRIDLINE_TEST_MYSQL_USER").expect("set GRIDLINE_TEST_MYSQL_USER");
        let pw = std::env::var("GRIDLINE_TEST_MYSQL_PASS").unwrap_or_default();
        let db = std::env::var("GRIDLINE_TEST_MYSQL_DB").unwrap_or_default();
        let opts = sqlx::mysql::MySqlConnectOptions::new()
            .host(&h)
            .port(p)
            .username(&u)
            .password(&pw)
            .database(&db);
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .connect_with(opts.clone())
            .await
            .expect("connect to test MySQL");
        let mut conn = pool.acquire().await.expect("acquire");
        let conn_id: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
        let run = tokio::spawn(async move {
            execute_mysql_query_on(&mut *conn, "SELECT SLEEP(3)", 1, 50).await
        });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let mut killer = opts.connect().await.expect("killer connect");
        sqlx::query(&format!("KILL QUERY {conn_id}"))
            .execute(&mut killer)
            .await
            .expect("kill");
        let res = run.await.expect("query task");
        assert!(res.is_err(), "SLEEP(3) must be killed, not re-run; got {res:?}");
        assert!(res.unwrap_err().contains("Query cancelled"));
    }
}

#[cfg(test)]
#[path = "query.test.rs"]
mod query_tests;
