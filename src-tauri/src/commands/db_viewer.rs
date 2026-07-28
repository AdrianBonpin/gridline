//! DB Viewer helper functions and Tauri commands.
//!
//! This module provides pure SQL builder functions, pagination helpers,
//! and Tauri commands for the database viewer.

use crate::db::pool::{DbConfig, DbHandle};
use crate::models::db_viewer::{
    Change, ColumnInfo, EnumInfo, ExtensionInfo, FunctionInfo, QueryResult,
    SequenceInfo, TableInfo, TriggerInfo,
};
use std::collections::HashMap;
use tauri::State;
use tokio_postgres::types::ToSql;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Format a tokio-postgres connection error with full detail (severity,
/// message, SQLSTATE code) while redacting any embedded connection URL or
/// credentials so nothing sensitive reaches the frontend.
///
/// tokio-postgres's `Display` only prints "db error", so we walk the
/// `std::error::Error::source()` chain and also use `Debug` to surface the
/// real message (e.g. "password authentication failed for user \"x\"").
fn pg_error_message(err: &tokio_postgres::Error) -> String {
    // Prefer the Debug representation, which includes severity + message + code.
    let raw = format!("{:?}", err);
    // Redact postgres URL fragments and password=... sequences.
    let redacted = redact_secrets(&raw);
    truncate(&redacted, 400)
}

/// Redact credential-bearing substrings from an error/debug string so we
/// never leak usernames/passwords/connection strings to the frontend.
fn redact_secrets(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    // Replace `postgresql://user:password@host` style URLs with safely redacted text.
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if s[i..].to_lowercase().starts_with("postgres://")
            || s[i..].to_lowercase().starts_with("postgresql://")
        {
            // Skip the scheme.
            let scheme_end = i
                + s[i..]
                    .find("://")
                    .unwrap_or(0)
                + 3;
            out.push_str("[redacted-url://");
            // Find end of authority (next '/'. '/', or end).
            let rest = &s[scheme_end..];
            let end = match rest.find(['/', '?']) {
                Some(pos) => scheme_end + pos,
                None => s.len(),
            };
            i = end;
        } else if s[i..].to_lowercase().starts_with("password=") {
            out.push_str("[redacted]");
            // Skip to next whitespace or end.
            let rest = &s[i + "password=".len()..];
            let skip = rest.find(char::is_whitespace).unwrap_or(rest.len());
            i += "password=".len() + skip;
        } else {
            // Copy one char.
            let ch = s[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.saturating_sub(3)])
    }
}

/// Calculate the database offset for a given page and page size.
///
/// Uses 1-based page indexing:
/// - page 1, page_size 50 => offset 0
/// - page 2, page_size 50 => offset 50
/// - page 5, page_size 25 => offset 100
pub fn offset(page: i64, page_size: i64) -> i64 {
    (page - 1) * page_size
}

// ---------------------------------------------------------------------------
// Filter / Sort → SQL helpers
// ---------------------------------------------------------------------------

/// Returns true when the column name contains only safe identifier characters.
fn is_safe_identifier(col: &str) -> bool {
    !col.is_empty() && col.chars().all(|c| c.is_alphanumeric() || c == '_')
}

/// Build a WHERE clause from filter rules for PostgreSQL (parameterized $n).
/// Returns `(where_clause, param_values)` where `where_clause` starts with
/// " AND " (suitable for appending after WHERE 1=1).
fn build_pg_filter_clause(
    filters: &[crate::models::db_viewer::FilterRule],
    param_start: &mut usize,
) -> (String, Vec<String>) {
    let mut clauses = String::new();
    let mut params: Vec<String> = Vec::new();

    for rule in filters {
        let col = &rule.column;
        if !is_safe_identifier(col) {
            continue; // skip unsafe column names
        }

        let clause = match rule.operator.as_str() {
            "null" => {
                format!(" AND \"{}\" IS NULL", col)
            }
            "notnull" => {
                format!(" AND \"{}\" IS NOT NULL", col)
            }
            op @ ("eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt") => {
                *param_start += 1;
                let p = *param_start;
                params.push(rule.value.clone());
                match op {
                    "eq" => format!(" AND \"{}\"::text = ${}", col, p),
                    "neq" => format!(" AND \"{}\"::text != ${}", col, p),
                    "contains" => format!(" AND \"{}\"::text ILIKE '%' || ${} || '%'", col, p),
                    "starts" => format!(" AND \"{}\"::text ILIKE ${} || '%'", col, p),
                    "ends" => format!(" AND \"{}\"::text ILIKE '%' || ${}", col, p),
                    "gt" => format!(" AND \"{}\"::numeric > ${}::numeric", col, p),
                    "lt" => format!(" AND \"{}\"::numeric < ${}::numeric", col, p),
                    _ => unreachable!(),
                }
            }
            _ => continue, // unknown operator → skip
        };
        clauses.push_str(&clause);
    }

    (clauses, params)
}

/// Build a WHERE clause from filter rules for SQLite (positional ? params).
fn build_sqlite_filter_clause(filters: &[crate::models::db_viewer::FilterRule]) -> (String, Vec<String>) {
    let mut clauses = String::new();
    let mut params: Vec<String> = Vec::new();

    for rule in filters {
        let col = &rule.column;
        if !is_safe_identifier(col) {
            continue;
        }

        let clause = match rule.operator.as_str() {
            "null" => {
                format!(" AND \"{}\" IS NULL", col)
            }
            "notnull" => {
                format!(" AND \"{}\" IS NOT NULL", col)
            }
            op @ ("eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt") => {
                params.push(rule.value.clone());
                match op {
                    "eq" => format!(" AND \"{}\" = ?", col),
                    "neq" => format!(" AND \"{}\" != ?", col),
                    "contains" => format!(" AND \"{}\" LIKE '%' || ? || '%'", col),
                    "starts" => format!(" AND \"{}\" LIKE ? || '%'", col),
                    "ends" => format!(" AND \"{}\" LIKE '%' || ?", col),
                    "gt" => format!(" AND CAST(\"{}\" AS REAL) > CAST(? AS REAL)", col),
                    "lt" => format!(" AND CAST(\"{}\" AS REAL) < CAST(? AS REAL)", col),
                    _ => unreachable!(),
                }
            }
            _ => continue,
        };
        clauses.push_str(&clause);
    }

    (clauses, params)
}

/// Build an ORDER BY clause from sort rules.
/// Returns an empty string when there are no valid sort rules.
fn build_order_clause(sorts: &[crate::models::db_viewer::SortRule]) -> String {
    let mut parts: Vec<String> = Vec::new();
    for rule in sorts {
        if !is_safe_identifier(&rule.column) {
            continue;
        }
        let dir = match rule.order.as_str() {
            "asc" | "ASC" => "ASC",
            "desc" | "DESC" => "DESC",
            _ => continue,
        };
        parts.push(format!("\"{}\" {}", rule.column, dir));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", parts.join(", "))
    }
}

/// Build a parameterized UPDATE SQL statement.
///
/// The returned SQL uses `?` placeholders for both the SET values and the
/// WHERE primary-key conditions.
///
/// Example output:
/// ```sql
/// UPDATE "public"."users" SET "name" = ?, "email" = ? WHERE "id" = ?
/// ```
pub fn build_update_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
    new_data: &[(String, serde_json::Value)],
) -> String {
    let set_clause: Vec<String> = new_data
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    format!(
        "UPDATE \"{}\".\"{}\" SET {} WHERE {}",
        schema,
        table,
        set_clause.join(", "),
        where_clause.join(" AND ")
    )
}

/// Build a parameterized DELETE SQL statement.
///
/// Example output:
/// ```sql
/// DELETE FROM "public"."users" WHERE "id" = ?
/// ```
pub fn build_delete_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
) -> String {
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    format!(
        "DELETE FROM \"{}\".\"{}\" WHERE {}",
        schema,
        table,
        where_clause.join(" AND ")
    )
}

/// Build a parameterized INSERT SQL statement.
///
/// Example output:
/// ```sql
/// INSERT INTO "public"."users" ("id", "name") VALUES (?, ?)
/// ```
pub fn build_insert_sql(schema: &str, table: &str, columns: &[String]) -> String {
    let cols: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c)).collect();
    let placeholders: Vec<&str> = vec!["?"; columns.len()];
    format!(
        "INSERT INTO \"{}\".\"{}\" ({}) VALUES ({})",
        schema,
        table,
        cols.join(", "),
        placeholders.join(", ")
    )
}

// ---------------------------------------------------------------------------
// Change SQL builders (PostgreSQL `$N` placeholders)
// ---------------------------------------------------------------------------
//
// tokio-postgres uses `$1, $2, ...` positional placeholders (not `?`), so the
// `?`-based builders above cannot be used directly for PG execution. These
// helpers emit `$N` placeholders and return the bound values in the order they
// appear in the statement, so callers can bind them positionally.

/// Build a PostgreSQL UPDATE statement.
///
/// Returns `(sql, params)` where `params` is ordered SET values first, then
/// primary-key (WHERE) values. Placeholders are `$1, $2, ...` in the same
/// order.
pub fn build_pg_update_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
    new_data: &[(String, serde_json::Value)],
) -> (String, Vec<serde_json::Value>) {
    let mut params: Vec<serde_json::Value> = Vec::new();
    let set_clause: Vec<String> = new_data
        .iter()
        .map(|(col, val)| {
            params.push(val.clone());
            format!("\"{}\" = ${}", col, params.len())
        })
        .collect();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, val)| {
            params.push(val.clone());
            format!("\"{}\" = ${}", col, params.len())
        })
        .collect();
    (
        format!(
            "UPDATE \"{}\".\"{}\" SET {} WHERE {}",
            schema,
            table,
            set_clause.join(", "),
            where_clause.join(" AND ")
        ),
        params,
    )
}

/// Build a PostgreSQL DELETE statement.
pub fn build_pg_delete_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
) -> (String, Vec<serde_json::Value>) {
    let mut params: Vec<serde_json::Value> = Vec::new();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, val)| {
            params.push(val.clone());
            format!("\"{}\" = ${}", col, params.len())
        })
        .collect();
    (
        format!(
            "DELETE FROM \"{}\".\"{}\" WHERE {}",
            schema,
            table,
            where_clause.join(" AND ")
        ),
        params,
    )
}

/// Build a PostgreSQL INSERT statement.
pub fn build_pg_insert_sql(
    schema: &str,
    table: &str,
    columns: &[(String, serde_json::Value)],
) -> (String, Vec<serde_json::Value>) {
    let cols: Vec<String> = columns.iter().map(|(c, _)| format!("\"{}\"", c)).collect();
    let mut params: Vec<serde_json::Value> = Vec::new();
    let placeholders: Vec<String> = columns
        .iter()
        .map(|(_, val)| {
            params.push(val.clone());
            format!("${}", params.len())
        })
        .collect();
    (
        format!(
            "INSERT INTO \"{}\".\"{}\" ({}) VALUES ({})",
            schema,
            table,
            cols.join(", "),
            placeholders.join(", ")
        ),
        params,
    )
}

/// Convert a JSON value into a boxed PostgreSQL-bindable value.
///
/// Maps common JSON types to `tokio_postgres::types::ToSql` implementors.
/// Unknown/complex types are stringified as a fallback.
fn pg_box_value(v: &serde_json::Value) -> Box<dyn ToSql + Send + Sync> {
    match v {
        serde_json::Value::Null => Box::new(Option::<String>::None),
        serde_json::Value::Bool(b) => Box::new(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        other => Box::new(other.to_string()),
    }
}

/// Convert a JSON value into a `rusqlite::types::Value` for SQLite binding.
fn json_to_sqlite_value(v: &serde_json::Value) -> rusqlite::types::Value {
    use rusqlite::types::Value;
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Integer(*b as i64),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                Value::Text(n.to_string())
            }
        }
        serde_json::Value::String(s) => Value::Text(s.clone()),
        other => Value::Text(other.to_string()),
    }
}

/// Parse a JSON object string (e.g. `{"id": 1}`) into ordered (column, value)
/// pairs. Insertion order of the JSON object is preserved by `serde_json`.
fn parse_json_pairs(json: &str) -> Result<Vec<(String, serde_json::Value)>, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid change JSON: {}", e))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "change JSON must be an object".to_string())?;
    Ok(obj.iter().map(|(k, val)| (k.clone(), val.clone())).collect())
}
///
/// Each inner `Vec<serde_json::Value>` represents one row, where the values
/// are expected in the order: `[name, schema, table_type]`.
pub fn parse_table_info_rows(rows: &[Vec<serde_json::Value>]) -> Vec<TableInfo> {
    rows.iter()
        .map(|row| {
            let name = row
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let schema = row
                .get(1)
                .and_then(|v| v.as_str())
                .unwrap_or("public")
                .to_string();
            let table_type = row
                .get(2)
                .and_then(|v| v.as_str())
                .unwrap_or("TABLE")
                .to_string();
            TableInfo {
                name,
                schema,
                table_type,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Convert a PostgreSQL row value at column index `i` to a JSON value.
///
/// Tries numeric/boolean types first (which need exact Rust type matching),
/// then UUID (with-uuid-1 feature), then chrono types (with-chrono-0_4),
/// then JSON/JSONB, then falls back to String.
fn sqlite_value_to_json(row: &rusqlite::Row, i: usize) -> serde_json::Value {
    use rusqlite::types::ValueRef;
    match row.get_ref(i) {
        Ok(ValueRef::Null) => serde_json::Value::Null,
        Ok(ValueRef::Integer(v)) => serde_json::json!(v),
        Ok(ValueRef::Real(v)) => serde_json::json!(v),
        Ok(ValueRef::Text(v)) => serde_json::Value::String(
            String::from_utf8_lossy(v).to_string(),
        ),
        Ok(ValueRef::Blob(v)) => serde_json::Value::String(format!(
            "[{}B blob]",
            v.len()
        )),
        Err(_) => serde_json::Value::Null,
    }
}

fn pg_value_to_json(row: &tokio_postgres::Row, i: usize) -> serde_json::Value {
    // Integer types
    if let Ok(Some(v)) = row.try_get::<_, Option<i32>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<i64>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<i16>>(i) {
        return serde_json::json!(v);
    }
    // Float types
    if let Ok(Some(v)) = row.try_get::<_, Option<f64>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<f32>>(i) {
        return serde_json::json!(v);
    }
    // Boolean
    if let Ok(Some(v)) = row.try_get::<_, Option<bool>>(i) {
        return serde_json::json!(v);
    }
    // UUID
    if let Ok(Some(v)) = row.try_get::<_, Option<uuid::Uuid>>(i) {
        return serde_json::Value::String(v.to_string());
    }
    // Timestamp / date types
    if let Ok(Some(v)) = row.try_get::<_, Option<chrono::NaiveDateTime>>(i) {
        return serde_json::Value::String(v.to_string());
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(i) {
        return serde_json::Value::String(v.to_rfc3339());
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<chrono::NaiveDate>>(i) {
        return serde_json::Value::String(v.to_string());
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<chrono::NaiveTime>>(i) {
        return serde_json::Value::String(v.to_string());
    }
    // JSON/JSONB
    if let Ok(Some(v)) = row.try_get::<_, Option<serde_json::Value>>(i) {
        return v;
    }
    // Text fallback: catches varchar, text, char, and USER-DEFINED enum
    // types. Under the simple query protocol, all values arrive as text
    // and FromSql<String> converts them regardless of column type OID.
    if let Ok(Some(v)) = row.try_get::<_, Option<String>>(i) {
        return serde_json::Value::String(v);
    }
    serde_json::Value::Null
}

#[tauri::command]
pub async fn db_connect(
    connection_id: String,
    config: DbConfig,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    if config.db_type == "postgresql" {
        use tokio_postgres::NoTls;

        let host = &config.host;
        let port = config.port.unwrap_or(5432) as u16;
        let user = config.username.as_deref().unwrap_or("postgres");
        let dbname = config.database.as_deref().unwrap_or("postgres");
        let password = config.password.as_deref().unwrap_or("");

        // Build a postgres URL connection string rather than the fragile
        // libpq key=value format. tokio-postgres parses URLs reliably and
        // urlencoding handles special characters in user/password/dbname.
        use urlencoding::encode as enc;
        let conn_str = format!(
            "postgresql://{}:{}@{}:{}/{}?connect_timeout=10",
            enc(user),
            enc(password),
            host,
            port,
            enc(dbname),
        );

        match tokio_postgres::connect(&conn_str, NoTls).await {
            Ok((client, connection)) => {
                let handle = tokio::spawn(async move {
                    if let Err(e) = connection.await {
                        eprintln!("PostgreSQL connection error: {}", e);
                    }
                });

                let mut pm = state.pool_manager.lock().await;
                pm.register(
                    &connection_id,
                    crate::db::pool::DbHandle::Postgresql(client, handle),
                );
                Ok(())
            }
            Err(e) => Err(format!("Connection failed: {}", pg_error_message(&e))),
        }
    } else if config.db_type == "sqlite" {
        match rusqlite::Connection::open(&config.host) {
            Ok(conn) => {
                let mut pm = state.pool_manager.lock().await;
                pm.register(&connection_id, crate::db::pool::DbHandle::Sqlite(conn));
                Ok(())
            }
            Err(e) => Err(format!("Connection failed: {}", e)),
        }
    } else {
        Err(format!(
            "Database type '{}' not yet supported for DB viewer",
            config.db_type
        ))
    }
}

#[tauri::command]
pub async fn db_disconnect(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut pm = state.pool_manager.lock().await;
    pm.remove(&connection_id);
    Ok(())
}

#[tauri::command]
pub async fn get_databases(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<Vec<String>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            let rows = client
                .query(
                    "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
                    &[],
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
        }
        Some(crate::db::pool::DbHandle::Sqlite(_)) => {
            // SQLite has a single database per file; expose the catalog name.
            Ok(vec!["main".to_string()])
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_schemas(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<Vec<String>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            let rows = client
                .query(
                    "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('information_schema', 'pg_catalog') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp%' ORDER BY nspname",
                    &[],
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows.iter().map(|r| r.get::<_, String>(0)).collect())
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            let mut stmt = conn
                .prepare("SELECT DISTINCT 'main' AS schema")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            Ok(rows.filter_map(|r| r.ok()).collect())
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_tables(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<TableInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            let schema_filter = schema.unwrap_or_else(|| "public".to_string());
            let rows = client
                .query(
                    "SELECT table_name, table_schema, table_type FROM information_schema.tables WHERE table_schema = $1 AND table_type IN ('BASE TABLE', 'VIEW') ORDER BY table_name",
                    &[&schema_filter],
                )
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| TableInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    table_type: r.get(2),
                })
                .collect())
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            let mut stmt = conn
                .prepare(
                    "SELECT name, 'main', type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(TableInfo {
                        name: row.get::<_, String>(0)?,
                        schema: row.get::<_, String>(1)?,
                        table_type: row.get::<_, String>(2)?.to_uppercase(),
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_table_data(
    connection_id: String,
    schema: String,
    table: String,
    page: Option<i64>,
    page_size: Option<i64>,
    filters: Option<Vec<crate::models::db_viewer::FilterRule>>,
    sorts: Option<Vec<crate::models::db_viewer::SortRule>>,
    state: State<'_, crate::AppState>,
) -> Result<QueryResult, String> {
    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50);
    let off = (p - 1) * ps;
    let filters = filters.unwrap_or_default();
    let sorts = sorts.unwrap_or_default();

    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            // Build filter clause (shared by COUNT and data queries)
            let mut pg_param_idx: usize = 0;
            let (filter_clause, mut filter_params) =
                build_pg_filter_clause(&filters, &mut pg_param_idx);
            let order_clause = build_order_clause(&sorts);

            // Get total count (with filters applied)
            let count_query =
                format!("SELECT COUNT(*) FROM \"{}\".\"{}\" WHERE 1=1{}", schema, table, filter_clause);
            let count_row = if filter_params.is_empty() {
                client
                    .query_one(&count_query, &[])
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                    filter_params.iter().map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
                client
                    .query_one(&count_query, &param_refs)
                    .await
                    .map_err(|e| e.to_string())?
            };
            let total_rows: i64 = count_row.get(0);

            // Get column info with FK detection and enum type names
            let col_query = r#"SELECT
    c.column_name,
    CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS data_type,
    c.is_nullable,
    COALESCE(pk.is_pk, false) AS is_pk,
    COALESCE(fk.is_fk, false) AS is_fk,
    fk.foreign_table_name,
    fk.foreign_column_name,
    c.column_default
FROM information_schema.columns c
LEFT JOIN (
    SELECT ku.column_name, true AS is_pk
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_catalog = ku.constraint_catalog
        AND tc.constraint_schema = ku.constraint_schema
        AND tc.constraint_name = ku.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
) pk ON c.column_name = pk.column_name
LEFT JOIN (
    SELECT
        ku.column_name,
        true AS is_fk,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_catalog = ku.constraint_catalog
        AND tc.constraint_schema = ku.constraint_schema
        AND tc.constraint_name = ku.constraint_name
    JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_catalog = ccu.constraint_catalog
        AND tc.constraint_schema = ccu.constraint_schema
        AND tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
) fk ON c.column_name = fk.column_name
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position"#;
            let col_rows = client
                .query(col_query, &[&schema, &table])
                .await
                .map_err(|e| e.to_string())?;
            let columns: Vec<ColumnInfo> = col_rows
                .iter()
                .map(|r| {
                    let is_fk: bool = r.get(4);
                    let fk_table: Option<String> = r.get(5);
                    let fk_column: Option<String> = r.get(6);
                    ColumnInfo {
                        name: r.get(0),
                        data_type: r.get(1),
                        is_nullable: r.get::<_, String>(2) == "YES",
                        is_pk: r.get(3),
                        is_fk,
                        fk_ref: if is_fk {
                            Some((fk_table.unwrap_or_default(), fk_column.unwrap_or_default()))
                        } else {
                            None
                        },
                        default_value: r.get::<_, Option<String>>(7),
                    }
                })
                .collect();

            // Get data (with filters and sorts applied)
            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" WHERE 1=1{} {} LIMIT {} OFFSET {}",
                schema, table, filter_clause, order_clause, ps, off
            );
            let data_rows = if filter_params.is_empty() {
                client
                    .query(&data_query, &[])
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> =
                    filter_params.iter().map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync)).collect();
                client
                    .query(&data_query, &param_refs)
                    .await
                    .map_err(|e| e.to_string())?
            };
            let rows: Vec<Vec<serde_json::Value>> = data_rows
                .iter()
                .map(|row| (0..row.len()).map(|i| pg_value_to_json(row, i)).collect())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_rows,
                page: p,
                page_size: ps,
            })
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            // Build filter clause (shared by COUNT and data queries)
            let (filter_clause, filter_vals) = build_sqlite_filter_clause(&filters);
            let order_clause = build_order_clause(&sorts);

            let count_query =
                format!("SELECT COUNT(*) FROM \"{}\".\"{}\" WHERE 1=1{}", schema, table, filter_clause);
            let total_rows: i64 = if filter_vals.is_empty() {
                conn.query_row(&count_query, [], |r| r.get(0))
                    .map_err(|e| e.to_string())?
            } else {
                let refs: Vec<&dyn rusqlite::types::ToSql> = filter_vals.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
                conn.query_row(&count_query, rusqlite::params_from_iter(&refs), |r| r.get(0))
                    .map_err(|e| e.to_string())?
            };

            // Get column metadata via PRAGMA table_info
            let pragma_query = format!("PRAGMA table_info('{}')", table);
            let mut pragma_stmt = conn.prepare(&pragma_query).map_err(|e| e.to_string())?;
            let col_meta: Vec<(String, String, bool, bool, Option<String>)> = pragma_stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(1)?,   // name
                        row.get::<_, String>(2)?,   // type
                        row.get::<_, bool>(3)?,     // notnull
                        row.get::<_, bool>(5)?,     // pk
                        row.get::<_, Option<String>>(4)?, // dflt_value
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            // Get FK metadata via PRAGMA foreign_key_list
            let fk_query = format!("PRAGMA foreign_key_list('{}')", table);
            let fk_map: HashMap<String, (String, String)> =
                if let Ok(mut fk_stmt) = conn.prepare(&fk_query) {
                    fk_stmt
                        .query_map([], |row| {
                            Ok((
                                row.get::<_, String>(3)?,  // from (column)
                                row.get::<_, String>(2)?,  // table
                                row.get::<_, String>(4)?,  // to (column)
                            ))
                        })
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .map(|(from, ref_table, ref_col)| (from, (ref_table, ref_col)))
                        .collect()
                } else {
                    HashMap::new()
                };

            let columns: Vec<ColumnInfo> = col_meta
                .iter()
                .map(|(name, dtype, notnull, is_pk, default_val)| {
                    let fk = fk_map.get(name);
                    ColumnInfo {
                        name: name.clone(),
                        data_type: if dtype.is_empty() { "TEXT".to_string() } else { dtype.clone() },
                        is_nullable: !notnull,
                        is_pk: *is_pk,
                        is_fk: fk.is_some(),
                        fk_ref: fk.map(|(t, c)| (t.clone(), c.clone())),
                        default_value: default_val.clone(),
                    }
                })
                .collect();

            // Get data (with filters and sorts applied)
            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" WHERE 1=1{} {} LIMIT {} OFFSET {}",
                schema, table, filter_clause, order_clause, ps, off
            );
            let mut stmt = conn.prepare(&data_query).map_err(|e| e.to_string())?;
            let col_count = stmt.column_count();

            let rows: Vec<Vec<serde_json::Value>> = if filter_vals.is_empty() {
                stmt.query_map([], |row| {
                    let mut vals = Vec::new();
                    for i in 0..col_count {
                        vals.push(sqlite_value_to_json(row, i));
                    }
                    Ok(vals)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
            } else {
                let refs: Vec<&dyn rusqlite::types::ToSql> = filter_vals.iter().map(|v| v as &dyn rusqlite::types::ToSql).collect();
                stmt.query_map(rusqlite::params_from_iter(&refs), |row| {
                    let mut vals = Vec::new();
                    for i in 0..col_count {
                        vals.push(sqlite_value_to_json(row, i));
                    }
                    Ok(vals)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect()
            };

            Ok(QueryResult {
                columns,
                rows,
                total_rows,
                page: p,
                page_size: ps,
            })
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_fk_preview(
    connection_id: String,
    schema: String,
    table: String,
    column: String,
    value: String,
    state: State<'_, crate::AppState>,
) -> Result<QueryResult, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            // Get column info with FK detection
            let col_query = r#"SELECT
    c.column_name,
    CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS data_type,
    c.is_nullable,
    COALESCE(pk.is_pk, false) AS is_pk,
    COALESCE(fk.is_fk, false) AS is_fk,
    fk.foreign_table_name,
    fk.foreign_column_name,
    c.column_default
FROM information_schema.columns c
LEFT JOIN (
    SELECT ku.column_name, true AS is_pk
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_catalog = ku.constraint_catalog
        AND tc.constraint_schema = ku.constraint_schema
        AND tc.constraint_name = ku.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
) pk ON c.column_name = pk.column_name
LEFT JOIN (
    SELECT
        ku.column_name,
        true AS is_fk,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage ku
        ON tc.constraint_catalog = ku.constraint_catalog
        AND tc.constraint_schema = ku.constraint_schema
        AND tc.constraint_name = ku.constraint_name
    JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_catalog = ccu.constraint_catalog
        AND tc.constraint_schema = ccu.constraint_schema
        AND tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
) fk ON c.column_name = fk.column_name
WHERE c.table_schema = $1 AND c.table_name = $2
ORDER BY c.ordinal_position"#;
            let col_rows = client
                .query(col_query, &[&schema, &table])
                .await
                .map_err(|e| pg_error_message(&e))?;
            let columns: Vec<ColumnInfo> = col_rows
                .iter()
                .map(|r| {
                    let is_fk: bool = r.get(4);
                    let fk_table: Option<String> = r.get(5);
                    let fk_column: Option<String> = r.get(6);
                    ColumnInfo {
                        name: r.get(0),
                        data_type: r.get(1),
                        is_nullable: r.get::<_, String>(2) == "YES",
                        is_pk: r.get(3),
                        is_fk,
                        fk_ref: if is_fk {
                            Some((fk_table.unwrap_or_default(), fk_column.unwrap_or_default()))
                        } else {
                            None
                        },
                        default_value: r.get::<_, Option<String>>(7),
                    }
                })
                .collect();

            // Fetch the referenced row
            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" WHERE \"{}\"::text = $1 LIMIT 1",
                schema, table, column
            );
            let data_rows = client
                .query(&data_query, &[&value])
                .await
                .map_err(|e| pg_error_message(&e))?;
            let rows: Vec<Vec<serde_json::Value>> = data_rows
                .iter()
                .map(|row| (0..row.len()).map(|i| pg_value_to_json(row, i)).collect())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_rows: 1,
                page: 1,
                page_size: 1,
            })
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            // Get column metadata via PRAGMA table_info
            let pragma_query = format!("PRAGMA table_info('{}')", table);
            let mut pragma_stmt = conn.prepare(&pragma_query).map_err(|e| e.to_string())?;
            let col_meta: Vec<(String, String, bool, bool, Option<String>)> = pragma_stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, bool>(3)?,
                        row.get::<_, bool>(5)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            // Get FK metadata
            let fk_query = format!("PRAGMA foreign_key_list('{}')", table);
            let fk_map: HashMap<String, (String, String)> =
                if let Ok(mut fk_stmt) = conn.prepare(&fk_query) {
                    fk_stmt
                        .query_map([], |row| {
                            Ok((
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(4)?,
                            ))
                        })
                        .map_err(|e| e.to_string())?
                        .filter_map(|r| r.ok())
                        .map(|(from, ref_table, ref_col)| (from, (ref_table, ref_col)))
                        .collect()
                } else {
                    HashMap::new()
                };

            let columns: Vec<ColumnInfo> = col_meta
                .iter()
                .map(|(name, dtype, notnull, is_pk, default_val)| {
                    let fk = fk_map.get(name);
                    ColumnInfo {
                        name: name.clone(),
                        data_type: if dtype.is_empty() { "TEXT".to_string() } else { dtype.clone() },
                        is_nullable: !notnull,
                        is_pk: *is_pk,
                        is_fk: fk.is_some(),
                        fk_ref: fk.map(|(t, c)| (t.clone(), c.clone())),
                        default_value: default_val.clone(),
                    }
                })
                .collect();

            // Fetch the referenced row
            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" WHERE \"{}\" = ?1 LIMIT 1",
                schema, table, column
            );
            let mut stmt = conn.prepare(&data_query).map_err(|e| e.to_string())?;
            let col_count = stmt.column_count();
            let rows: Vec<Vec<serde_json::Value>> = stmt
                .query_map([&value], |row| {
                    let mut vals = Vec::new();
                    for i in 0..col_count {
                        vals.push(sqlite_value_to_json(row, i));
                    }
                    Ok(vals)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_rows: 1,
                page: 1,
                page_size: 1,
            })
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn execute_change(
    connection_id: String,
    change: Change,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            // Build the parameterized SQL + bound values from the change.
            let (sql, params): (String, Vec<serde_json::Value>) = match &change {
                Change::Update {
                    schema,
                    table,
                    primary_key,
                    new_data,
                    ..
                } => {
                    let pk = parse_json_pairs(primary_key)?;
                    let data = parse_json_pairs(new_data)?;
                    build_pg_update_sql(schema, table, &pk, &data)
                }
                Change::Insert {
                    schema,
                    table,
                    data,
                    ..
                } => {
                    let pairs = parse_json_pairs(data)?;
                    build_pg_insert_sql(schema, table, &pairs)
                }
                Change::Delete {
                    schema,
                    table,
                    primary_key,
                    ..
                } => {
                    let pk = parse_json_pairs(primary_key)?;
                    build_pg_delete_sql(schema, table, &pk)
                }
                Change::AlterTable { sql, .. } => {
                    // Execute the raw DDL directly; no bound parameters.
                    client.execute(sql, &[]).await.map_err(|e| e.to_string())?;
                    return Ok(());
                }
            };

            // Box each value for trait-object binding (`$N` placeholders). The
            // boxed values must be `Send` so the async command future stays
            // `Send` across the `.await`.
            let boxed: Vec<Box<dyn ToSql + Send + Sync>> =
                params.iter().map(pg_box_value).collect();
            // Coerce each `&(dyn ToSql + Send + Sync)` reference down to
            // `&(dyn ToSql + Sync)` (dropping the `Send` auto-trait) to match
            // `tokio_postgres::Client::execute`'s expected slice type.
            let refs: Vec<&(dyn ToSql + Sync)> = boxed
                .iter()
                .map(|b| {
                    let r: &(dyn ToSql + Sync) = &**b;
                    r
                })
                .collect();
            client.execute(&sql, &refs).await.map_err(|e| e.to_string())?;
            Ok(())
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            let (sql, params): (String, Vec<serde_json::Value>) = match &change {
                Change::Update {
                    schema,
                    table,
                    primary_key,
                    new_data,
                    ..
                } => {
                    let pk = parse_json_pairs(primary_key)?;
                    let data = parse_json_pairs(new_data)?;
                    (
                        build_update_sql(schema, table, &pk, &data),
                        pk.iter()
                            .chain(data.iter())
                            .map(|(_, v)| v.clone())
                            .collect(),
                    )
                }
                Change::Insert {
                    schema,
                    table,
                    data,
                    ..
                } => {
                    let pairs = parse_json_pairs(data)?;
                    let columns: Vec<String> =
                        pairs.iter().map(|(c, _)| c.clone()).collect();
                    (
                        build_insert_sql(schema, table, &columns),
                        pairs.iter().map(|(_, v)| v.clone()).collect(),
                    )
                }
                Change::Delete {
                    schema,
                    table,
                    primary_key,
                    ..
                } => {
                    let pk = parse_json_pairs(primary_key)?;
                    (
                        build_delete_sql(schema, table, &pk),
                        pk.iter().map(|(_, v)| v.clone()).collect(),
                    )
                }
                Change::AlterTable { sql, .. } => {
                    conn.execute(sql, []).map_err(|e| e.to_string())?;
                    return Ok(());
                }
            };

            let sqlite_params: Vec<rusqlite::types::Value> =
                params.iter().map(json_to_sqlite_value).collect();
            conn.execute(&sql, rusqlite::params_from_iter(sqlite_params))
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn refresh_connection(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // Verify the connection is still alive by running a trivial query. The
    // frontend re-issues getDatabases/getSchemas/getTables separately after
    // this returns, so we only need to confirm reachability here.
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            client.query_one("SELECT 1", &[]).await.map_err(|e| e.to_string())?;
            Ok(())
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err("Connection not found".to_string()),
    }
}

#[tauri::command]
pub async fn get_functions(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<FunctionInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_functions_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| FunctionInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    return_type: r.get::<_, Option<String>>(2).unwrap_or_default(),
                    argument_types: r.get::<_, Option<Vec<String>>>(3).unwrap_or_default(),
                    argument_names: r.get::<_, Option<Vec<String>>>(4).unwrap_or_default(),
                    argument_modes: r.get::<_, Option<Vec<String>>>(5).unwrap_or_default(),
                    language: r.get(6),
                    source: r.get(7),
                    kind: r.get(8),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_triggers(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<TriggerInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_triggers_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| TriggerInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    table_schema: r.get(2),
                    table_name: r.get(3),
                    event_manipulation: r.get(4),
                    action_timing: r.get(5),
                    action_orientation: r.get(6),
                    action_statement: r.get(7),
                    enabled: r.get(8),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_sequences(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<SequenceInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_sequences_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| SequenceInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    start_value: r.get::<_, Option<String>>(2).unwrap_or_default(),
                    min_value: r.get::<_, Option<String>>(3).unwrap_or_default(),
                    max_value: r.get::<_, Option<String>>(4).unwrap_or_default(),
                    increment: r.get::<_, Option<String>>(5).unwrap_or_default(),
                    current_value: r.get::<_, Option<String>>(6).unwrap_or_default(),
                    cycle: r.get::<_, Option<String>>(7)
                        .map(|s| s == "YES")
                        .unwrap_or(false),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_enums(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<EnumInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_enums_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| EnumInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    labels: r.get::<_, Option<Vec<String>>>(2).unwrap_or_default(),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_extensions(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<Vec<ExtensionInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let query = crate::db::introspection::pg_extensions_query();
            let rows = client
                .query(&query, &[])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| ExtensionInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    version: r.get::<_, Option<String>>(2).unwrap_or_default(),
                    comment: r.get(3),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::db_viewer::Change;

    /// Verify the `offset` helper produces correct pagination offsets.
    #[test]
    fn pagination_offset_is_correct() {
        assert_eq!(offset(1, 50), 0, "page 1, size 50 => offset 0");
        assert_eq!(offset(2, 50), 50, "page 2, size 50 => offset 50");
        assert_eq!(offset(5, 25), 100, "page 5, size 25 => offset 100");
    }

    /// Verify that a `Change::Update` serializes with the correct `type` tag.
    #[test]
    fn execute_change_serialization() {
        let change = Change::Update {
            id: "chg-1".to_string(),
            schema: "public".to_string(),
            table: "users".to_string(),
            primary_key: r#"{"id": 1}"#.to_string(),
            old_data: r#"{"name": "alice"}"#.to_string(),
            new_data: r#"{"name": "bob"}"#.to_string(),
        };
        let json = serde_json::to_string(&change).unwrap();
        assert!(
            json.contains(r#""type":"update""#),
            "serialized Change::Update should use snake_case tag 'update'; got: {}",
            json
        );
    }

    /// Verify that `Change::id()` returns the correct identifier.
    #[test]
    fn change_id_is_accessible() {
        let change = Change::Insert {
            id: "chg-42".to_string(),
            schema: "public".to_string(),
            table: "logs".to_string(),
            data: r#"{"event": "login"}"#.to_string(),
        };
        assert_eq!(
            change.id(),
            "chg-42",
            "id() should return the 'id' field of the Insert variant"
        );
    }

    /// Verify that `build_update_sql` produces valid SQL with all required
    /// clauses.
    #[test]
    fn build_change_update_sql_is_valid() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let data = vec![
            ("name".to_string(), serde_json::json!("bob")),
            ("email".to_string(), serde_json::json!("bob@example.com")),
        ];

        let sql = build_update_sql("public", "users", &pk, &data);

        assert!(
            sql.to_uppercase().contains("UPDATE"),
            "UPDATE SQL must contain 'UPDATE'; got: {}",
            sql
        );
        assert!(
            sql.to_uppercase().contains("SET"),
            "UPDATE SQL must contain 'SET'; got: {}",
            sql
        );
        assert!(
            sql.to_uppercase().contains("WHERE"),
            "UPDATE SQL must contain 'WHERE'; got: {}",
            sql
        );
    }

    /// Verify that `build_delete_sql` produces valid SQL with all required
    /// clauses.
    #[test]
    fn build_change_delete_sql_is_valid() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];

        let sql = build_delete_sql("public", "users", &pk);

        assert!(
            sql.to_uppercase().contains("DELETE FROM"),
            "DELETE SQL must contain 'DELETE FROM'; got: {}",
            sql
        );
        assert!(
            sql.to_uppercase().contains("WHERE"),
            "DELETE SQL must contain 'WHERE'; got: {}",
            sql
        );
    }

    /// Verify that `build_insert_sql` produces valid SQL with all required
    /// clauses.
    #[test]
    fn build_change_insert_sql_is_valid() {
        let columns = vec!["id".to_string(), "name".to_string(), "email".to_string()];

        let sql = build_insert_sql("public", "users", &columns);

        assert!(
            sql.to_uppercase().contains("INSERT INTO"),
            "INSERT SQL must contain 'INSERT INTO'; got: {}",
            sql
        );
        assert!(
            sql.to_uppercase().contains("VALUES"),
            "INSERT SQL must contain 'VALUES'; got: {}",
            sql
        );
    }
}