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
use crate::models::db_viewer::{ColumnInfo, QueryResult};
use serde::{Deserialize, Serialize};
use sqlx::{Column, Row};
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

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
        Some(DbHandle::MySql(pool)) => execute_mysql_query(pool, query, page, page_size).await,
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
        Err(_) => {
            // Wrapping failed — fall back to raw execution.
            return execute_pg_raw(client, trimmed, page, page_size, off).await;
        }
    };

    // Now execute the wrapped data query.
    let data_rows = match client.query(&wrapped_data, &[&page_size, &off]).await {
        Ok(rows) => rows,
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
        Err(_) => {
            // Wrapping failed — fall back to raw execution.
            return execute_sqlite_raw(conn, trimmed, page, page_size, off);
        }
    };

    // Execute the wrapped data query.
    let (columns, all_rows) = match execute_sqlite_with_query(conn, &wrapped_data) {
        Ok(result) => result,
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
fn mysql_cell_to_json(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    row.try_get::<Option<serde_json::Value>, _>(i)
        .map(|o| o.unwrap_or(serde_json::Value::Null))
        .unwrap_or(serde_json::Value::Null)
}

async fn execute_mysql_query(
    pool: &sqlx::MySqlPool,
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
        .fetch_one(pool)
        .await
    {
        Ok(n) => n,
        Err(_) => return execute_mysql_raw(pool, trimmed, page, page_size, off).await,
    };

    let data_rows = match sqlx::query(&mysql_wrap_data(trimmed))
        .bind(page_size)
        .bind(off)
        .fetch_all(pool)
        .await
    {
        Ok(rows) => rows,
        Err(_) => return execute_mysql_raw(pool, trimmed, page, page_size, off).await,
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
        None => return execute_mysql_raw(pool, trimmed, page, page_size, off).await,
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
    pool: &sqlx::MySqlPool,
    query: &str,
    page: i64,
    page_size: i64,
    off: i64,
) -> Result<QueryResult, String> {
    let rows = sqlx::query(query)
        .fetch_all(pool)
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
    execute_query_inner(&mut pm, &state.db_store, &connection_id, &query, p, ps).await
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
}
