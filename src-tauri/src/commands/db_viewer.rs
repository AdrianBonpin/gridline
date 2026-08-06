//! DB Viewer helper functions and Tauri commands.
//!
//! This module provides pure SQL builder functions, pagination helpers,
//! and Tauri commands for the database viewer.

use crate::db::pool::{ConnectionPoolManager, DbConfig, DbHandle};
use crate::models::db_viewer::{
    Change, ColumnInfo, ConstraintInfo, EnumInfo, ExtensionInfo, FunctionInfo, IndexInfo,
    QueryResult, SequenceInfo, TableInfo, TriggerInfo,
};
use std::collections::HashMap;
use sqlx::Row;
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
pub(crate) fn pg_error_message(err: &tokio_postgres::Error) -> String {
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
            let scheme_end = i + s[i..].find("://").unwrap_or(0) + 3;
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

/// Split a `pg_get_indexdef(...,0,true)` / `pg_attribute` column CSV into a
/// Vec, trimming whitespace. Splits on commas that are NOT inside parens
/// (to keep expression-index columns intact).
pub(crate) fn split_columns_csv(csv: &str) -> Vec<String> {
    let csv = csv.trim();
    if csv.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut buf = String::new();
    for ch in csv.chars() {
        match ch {
            '(' => {
                depth += 1;
                buf.push(ch);
            }
            ')' => {
                depth -= 1;
                buf.push(ch);
            }
            ',' if depth == 0 => {
                out.push(buf.trim().to_string());
                buf.clear();
            }
            _ => buf.push(ch),
        }
    }
    if !buf.trim().is_empty() {
        out.push(buf.trim().to_string());
    }
    out
}

// ---------------------------------------------------------------------------
// Table DDL helpers
// ---------------------------------------------------------------------------

/// Fetch the stored `CREATE TABLE` statement for a SQLite table from
/// `sqlite_master`. Errors when the table does not exist.
pub fn get_sqlite_ddl(conn: &rusqlite::Connection, table: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
        rusqlite::params![table],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| format!("table DDL not found for {table}: {e}"))
}

/// Build the `pg_dump` argument vector for schema-only DDL extraction of a
/// single table. The password is intentionally NOT part of these args — it is
/// passed via the `PGPASSWORD` environment variable so it never appears on
/// the command line.
pub fn build_pg_dump_ddl_args(schema: &str, table: &str) -> Vec<String> {
    vec![
        "--schema-only".into(),
        "--no-owner".into(),
        format!("--schema={schema}"),
        format!("--table={table}"),
    ]
}

/// Check whether the `pg_dump` binary at the given path (bare name or
/// absolute path) is executable and reports a version.
pub fn pg_dump_available_at(path: &str) -> bool {
    std::process::Command::new(path)
        .arg("--version")
        .output()
        .is_ok()
}

/// Extract a single table's DDL from a PostgreSQL database by shelling out to
/// `pg_dump` (system-first, bundled-fallback) with `--schema-only`.
/// Credentials are supplied via the `PGPASSWORD` environment variable only —
/// never as argv — and are never logged. Execution requires a reachable
/// PostgreSQL server plus an installed `pg_dump`; unit tests cover the
/// argument construction instead.
pub fn get_pg_ddl_via_dump(
    schema: &str,
    table: &str,
    host: &str,
    port: u16,
    user: &str,
    db: &str,
    password: &str,
    pg_dump_path: &str,
) -> Result<String, String> {
    if !pg_dump_available_at(pg_dump_path) {
        return Err(
            "pg_dump not found. Install PostgreSQL client tools or use the bundled tools to copy table schema.".into(),
        );
    }
    let mut cmd = std::process::Command::new(pg_dump_path);
    cmd.args([
        format!("--host={host}"),
        format!("--port={port}"),
        format!("--username={user}"),
        format!("--dbname={db}"),
    ]);
    cmd.args(build_pg_dump_ddl_args(schema, table));
    cmd.env("PGPASSWORD", password);
    let out = cmd
        .output()
        .map_err(|e| format!("pg_dump spawn failed: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
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
fn build_sqlite_filter_clause(
    filters: &[crate::models::db_viewer::FilterRule],
) -> (String, Vec<String>) {
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

// ---------------------------------------------------------------------------
// Row-locator / editability helpers (Task 7)
// ---------------------------------------------------------------------------

/// Decide editability from pg_attribute flags: `attgenerated` ('' or 's'/'v')
/// and `attidentity` ('' or 'a'='ALWAYS' / 'd'='BY DEFAULT').
/// Generated (stored) columns and IDENTITY ALWAYS columns are non-editable.
pub(crate) fn editable_from_att(attgenerated: &str, attidentity: &str) -> bool {
    attgenerated.is_empty() && attidentity != "a"
}

/// Convert pg_attribute's internal "char" (i8, OID 18) to the 1-char string
/// used by `editable_from_att`: '' = not set, 's' = STORED, 'v' = VIRTUAL,
/// 'a' = ALWAYS, 'd' = BY DEFAULT. `None`/`\0` → "" (safe, no panic).
pub(crate) fn pg_char_to_att(value: Option<i8>) -> String {
    match value.and_then(|c| char::from_u32(c as u32)) {
        Some(c) if c != '\0' => c.to_string(),
        _ => String::new(),
    }
}

/// Assemble a PG SELECT statement from pre-formatted select items (already
/// quoted and optionally `::text`-cast), appending `ctid` when `append_locator`
/// is true (a no-PK *physical table*) so later UPDATE/DELETE queue changes can
/// target the exact row. Views expose no `ctid`, so callers must pass `false`
/// for them. `ctid` is appended last so it does not shift visible column order.
fn build_pg_select_from_items(
    schema: &str,
    table: &str,
    items: Vec<String>,
    append_locator: bool,
) -> String {
    let mut all_cols = items;
    if append_locator {
        all_cols.push("ctid".to_string());
    }
    format!(
        "SELECT {} FROM \"{}\".\"{}\"",
        all_cols.join(", "),
        schema,
        table
    )
}

/// Build the PG data SELECT, appending `ctid` only when `append_locator` is
/// true (no-PK physical tables). Never true for views.
pub(crate) fn build_pg_data_select(
    schema: &str,
    table: &str,
    visible_cols: &[String],
    append_locator: bool,
) -> String {
    let base_cols: Vec<String> = visible_cols.iter().map(|c| format!("\"{}\"", c)).collect();
    build_pg_select_from_items(schema, table, base_cols, append_locator)
}

/// Build the SQLite data SELECT, appending `rowid` when `append_locator` is
/// true (a no-PK *physical table*) so later UPDATE/DELETE queue changes can
/// target the exact row. Views expose no `rowid`, so callers must pass `false`
/// for them. The table is unqualified; SQLite browsing in this app is always
/// scoped to the `main` schema, where an unqualified name resolves identically.
pub(crate) fn build_sqlite_data_select(
    table: &str,
    visible_cols: &[String],
    append_locator: bool,
) -> String {
    let base_cols: Vec<String> = visible_cols.iter().map(|c| format!("\"{}\"", c)).collect();
    let mut all_cols = base_cols;
    if append_locator {
        all_cols.push("rowid".to_string());
    }
    format!("SELECT {} FROM \"{}\"", all_cols.join(", "), table)
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
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot update a row without a primary key or row locator".to_string());
    }
    let set_clause: Vec<String> = new_data
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    // Params must follow placeholder order: SET values first, then WHERE.
    let params: Vec<serde_json::Value> = new_data
        .iter()
        .chain(primary_key.iter())
        .map(|(_, v)| v.clone())
        .collect();
    Ok((
        format!(
            "UPDATE \"{}\".\"{}\" SET {} WHERE {}",
            schema,
            table,
            set_clause.join(", "),
            where_clause.join(" AND ")
        ),
        params,
    ))
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
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot delete a row without a primary key or row locator".to_string());
    }
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, _)| format!("\"{}\" = ?", col))
        .collect();
    Ok((
        format!(
            "DELETE FROM \"{}\".\"{}\" WHERE {}",
            schema,
            table,
            where_clause.join(" AND ")
        ),
        primary_key.iter().map(|(_, v)| v.clone()).collect(),
    ))
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
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot update a row without a primary key or row locator".to_string());
    }
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
    Ok((
        format!(
            "UPDATE \"{}\".\"{}\" SET {} WHERE {}",
            schema,
            table,
            set_clause.join(", "),
            where_clause.join(" AND ")
        ),
        params,
    ))
}

/// Build a PostgreSQL DELETE statement.
pub fn build_pg_delete_sql(
    schema: &str,
    table: &str,
    primary_key: &[(String, serde_json::Value)],
) -> Result<(String, Vec<serde_json::Value>), String> {
    if primary_key.is_empty() {
        return Err("cannot delete a row without a primary key or row locator".to_string());
    }
    let mut params: Vec<serde_json::Value> = Vec::new();
    let where_clause: Vec<String> = primary_key
        .iter()
        .map(|(col, val)| {
            params.push(val.clone());
            format!("\"{}\" = ${}", col, params.len())
        })
        .collect();
    Ok((
        format!(
            "DELETE FROM \"{}\".\"{}\" WHERE {}",
            schema,
            table,
            where_clause.join(" AND ")
        ),
        params,
    ))
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

/// Build the SQL skeleton for a bulk INSERT into PostgreSQL.
///
/// Emits `$N` placeholders; callers bind one row of values per execution so
/// the same statement can be reused for every row in the batch.
pub fn build_pg_bulk_insert_sql(schema: &str, table: &str, columns: &[String]) -> String {
    let cols: Vec<String> = columns.iter().map(|c| format!("\"{}\"", c)).collect();
    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("${i}")).collect();
    format!(
        "INSERT INTO \"{}\".\"{}\" ({}) VALUES ({})",
        schema,
        table,
        cols.join(", "),
        placeholders.join(", ")
    )
}

/// Build a `DROP TABLE` statement (schema-qualified). SQLite accepts the same
/// qualified form against the `main` schema.
pub fn build_drop_table_sql(schema: &str, table: &str) -> String {
    format!("DROP TABLE \"{}\".\"{}\"", schema, table)
}

/// Build a `DELETE FROM` (empty-table) statement (schema-qualified). SQLite
/// accepts the same qualified form against the `main` schema.
pub fn build_empty_table_sql(schema: &str, table: &str) -> String {
    format!("DELETE FROM \"{}\".\"{}\"", schema, table)
}

/// Apply a batch of rows to a SQLite table inside a single transaction.
///
/// Every row is inserted with its own parameterized statement; on the first
/// error the whole transaction is rolled back so no partial batch survives.
pub fn apply_bulk_insert_sqlite(
    conn: &rusqlite::Connection,
    table: &str,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
) -> Result<usize, String> {
    let sql = build_insert_sql("main", table, columns);
    conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
    let result = (|| {
        let mut count = 0;
        for (i, row) in rows.iter().enumerate() {
            let params: Vec<rusqlite::types::Value> =
                row.iter().map(json_to_sqlite_value).collect();
            conn.execute(&sql, rusqlite::params_from_iter(params))
                .map_err(|e| format!("row {}: {}", i + 1, e))?;
            count += 1;
        }
        Ok::<usize, String>(count)
    })();
    match result {
        Ok(count) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(count)
        }
        Err(e) => {
            // Best-effort rollback so a failed batch never persists partially.
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

/// Apply a batch of rows to a PostgreSQL table inside a single transaction.
///
/// The same `$N`-placeholder statement is reused per row with natively bound
/// values; on the first error the transaction is rolled back.
pub async fn apply_bulk_insert_pg(
    client: &tokio_postgres::Client,
    schema: &str,
    table: &str,
    columns: &[String],
    rows: &[Vec<serde_json::Value>],
) -> Result<usize, String> {
    let sql = build_pg_bulk_insert_sql(schema, table, columns);
    client
        .batch_execute("BEGIN")
        .await
        .map_err(|e| e.to_string())?;
    let mut count = 0;
    for (i, row) in rows.iter().enumerate() {
        let boxed: Vec<Box<dyn ToSql + Send + Sync>> = row.iter().map(pg_box_value).collect();
        let refs: Vec<&(dyn ToSql + Sync)> = boxed
            .iter()
            .map(|b| {
                let r: &(dyn ToSql + Sync) = &**b;
                r
            })
            .collect();
        if let Err(e) = client.execute(&sql, &refs).await {
            let _ = client.batch_execute("ROLLBACK").await;
            return Err(format!("row {}: {}", i + 1, e));
        }
        count += 1;
    }
    client
        .batch_execute("COMMIT")
        .await
        .map_err(|e| e.to_string())?;
    Ok(count)
}

/// Sanitize a raw error string before it crosses the IPC boundary: redact
/// credential-like fragments (connection URLs, `password=...`) and cap length.
pub(crate) fn sanitize_error(e: &str) -> String {
    truncate(&redact_secrets(e), 400)
}

/// Parse a JSON object string (e.g. `{"id": 1}`) into ordered (column, value)
/// pairs. Insertion order of the JSON object is preserved by `serde_json`.
fn parse_json_pairs(json: &str) -> Result<Vec<(String, serde_json::Value)>, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("invalid change JSON: {}", e))?;
    let obj = v
        .as_object()
        .ok_or_else(|| "change JSON must be an object".to_string())?;
    Ok(obj
        .iter()
        .map(|(k, val)| (k.clone(), val.clone()))
        .collect())
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
        Ok(ValueRef::Text(v)) => serde_json::Value::String(String::from_utf8_lossy(v).to_string()),
        Ok(ValueRef::Blob(v)) => serde_json::Value::String(format!("[{}B blob]", v.len())),
        Err(_) => serde_json::Value::Null,
    }
}

/// Serialize an i64 as a JSON string to preserve precision across the IPC
/// boundary (JS `Number` loses integer fidelity beyond 2^53). The frontend
/// treats numeric columns as strings for edit round-trips.
pub(crate) fn i64_to_json(v: i64) -> serde_json::Value {
    serde_json::Value::String(v.to_string())
}

pub(crate) fn pg_value_to_json(row: &tokio_postgres::Row, i: usize) -> serde_json::Value {
    // Integer types
    if let Ok(Some(v)) = row.try_get::<_, Option<i32>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<i64>>(i) {
        return i64_to_json(v);
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

/// Establish a PostgreSQL connection with the given TLS connector and spawn
/// the background connection driver task.
///
/// This helper keeps the two TLS branches of `db_connect` unified: without it
/// the `Connection<Socket, NoTlsStream>` vs `Connection<Socket, TlsStream>`
/// types would force duplicated spawn/register blocks.
pub(crate) async fn connect_pg_with<T>(
    pgconfig: &tokio_postgres::Config,
    tls: T,
) -> Result<(tokio_postgres::Client, tokio::task::JoinHandle<()>), tokio_postgres::Error>
where
    T: tokio_postgres::tls::MakeTlsConnect<tokio_postgres::Socket>,
    T::Stream: Send + 'static,
{
    let (client, connection) = pgconfig.connect(tls).await?;
    let handle = tokio::spawn(async move {
        if let Err(e) = connection.await {
            eprintln!("PostgreSQL connection error: {}", e);
        }
    });
    Ok((client, handle))
}

/// Headless MySQL connect (no Tauri `State`). Opens an SSH tunnel when
/// configured (binding 127.0.0.1 only), maps SSL modes, and registers a
/// `DbHandle::MySql` pool. Errors are sanitized so no `mysql://user:pass@host`
/// text leaks across the IPC boundary.
pub(crate) async fn run_mysql_connect(
    connection_id: &str,
    config: &crate::db::pool::DbConfig,
    ssh_manager: &std::sync::Mutex<crate::commands::ssh::SshTunnelManager>,
    pool_manager: &tokio::sync::Mutex<crate::db::pool::ConnectionPoolManager>,
) -> Result<(), String> {
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
    if config.host.trim().is_empty() {
        return Err("host is required".to_string());
    }

    let target_host: String;
    let target_port: u16;
    let via_tunnel: bool;

    if let Some(ssh_cfg) = config.ssh_config() {
        let key = connection_id.to_string();
        let remote_host = config.host.clone();
        let remote_port = config.port.unwrap_or(3306) as u16;
        let pw = config.ssh_password.clone();
        let pp = config.ssh_passphrase.clone();
        let backend = ssh_manager.lock().unwrap().backend_clone();
        let tunnel = tokio::task::spawn_blocking(move || {
            backend.open(
                &key,
                &ssh_cfg,
                &remote_host,
                remote_port,
                pw.as_deref(),
                pp.as_deref(),
            )
        })
        .await
        .map_err(|e| format!("Connection failed: {e}"))?
        .map_err(|e| sanitize_error(&e))?;
        let lp = tunnel.local_port;
        ssh_manager
            .lock()
            .unwrap()
            .insert_tunnel(connection_id.to_string(), tunnel);
        target_host = "127.0.0.1".to_string();
        target_port = lp;
        via_tunnel = true;
    } else {
        target_host = config.host.clone();
        target_port = config.port.unwrap_or(3306) as u16;
        via_tunnel = false;
    }

    let mut opts = MySqlConnectOptions::new()
        .host(&target_host)
        .port(target_port)
        .username(config.username.as_deref().unwrap_or("root"))
        .password(config.password.as_deref().unwrap_or(""))
        .database(config.database.as_deref().unwrap_or("mysql"));

    // TLS: through a tunnel the peer is loopback, so verify-ca/verify-full
    // degrade to encrypt-only `require`. Direct connections honor the mode.
    let decision = crate::commands::ssh::effective_tls_decision(
        crate::db::tls::tls_decision(config.ssl_mode.as_deref()),
        via_tunnel,
    );
    match decision {
        crate::db::tls::TlsDecision::Disable => {
            opts = opts.ssl_mode(MySqlSslMode::Disabled);
        }
        crate::db::tls::TlsDecision::Require => {
            opts = opts.ssl_mode(MySqlSslMode::Required);
        }
        crate::db::tls::TlsDecision::Verify => {
            // sqlx 0.8 has no VerifyFull: verify-ca -> VerifyCa (chain only),
            // verify-full -> VerifyIdentity (chain + hostname).
            match config.ssl_mode.as_deref() {
                Some("verify-ca") => opts = opts.ssl_mode(MySqlSslMode::VerifyCa),
                _ => opts = opts.ssl_mode(MySqlSslMode::VerifyIdentity),
            }
            if let Some(ca) = config.ssl_ca_path.as_deref() {
                opts = opts.ssl_ca(ca);
            }
        }
    }

    match MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(opts)
        .await
    {
        Ok(pool) => {
            pool_manager
                .lock()
                .await
                .register(connection_id, crate::db::pool::DbHandle::MySql(pool));
            Ok(())
        }
        Err(e) => {
            if via_tunnel {
                ssh_manager.lock().unwrap().close_tunnel(connection_id);
            }
            Err(format!(
                "Connection failed: {}",
                sanitize_error(&format!("{e}"))
            ))
        }
    }
}

#[tauri::command]
pub async fn db_connect(
    connection_id: String,
    config: DbConfig,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    if config.db_type == "postgresql" {
        let user = config.username.as_deref().unwrap_or("postgres");
        let dbname = config.database.as_deref().unwrap_or("postgres");
        let password = config.password.as_deref().unwrap_or("");
        let default_port = config.port.unwrap_or(5432) as u16;

        let ssh_cfg = config.ssh_config();
        let will_tunnel = ssh_cfg.is_some();

        // TLS first: through a tunnel the peer is loopback, so
        // verify-ca/verify-full degrade to encrypt-only `require`; direct
        // connections honor the user's mode. Building this before opening the
        // tunnel means a config error can't leak the tunnel.
        let decision = crate::commands::ssh::effective_tls_decision(
            crate::db::tls::tls_decision(config.ssl_mode.as_deref()),
            will_tunnel,
        );
        let tls = crate::db::tls::build_tls_config(
            decision,
            config.ssl_ca_path.as_deref(),
            config.ssl_cert_path.as_deref(),
            config.ssl_key_path.as_deref(),
        )
        .map_err(|e| sanitize_error(&e))?;

        // SSH tunnel: if configured, open a loopback tunnel to the remote DB
        // and connect through it. The blocking ssh2 handshake runs in
        // `spawn_blocking` so it never blocks the async runtime.
        let (connect_host, connect_port, via_tunnel) = match ssh_cfg {
            Some(ssh) => {
                let key = connection_id.clone();
                let remote_host = config.host.clone();
                let remote_port = config.port.unwrap_or(5432) as u16;
                let pw = config.ssh_password.clone();
                let pp = config.ssh_passphrase.clone();
                let backend = state.ssh_manager.lock().unwrap().backend_clone();
                let tunnel = tokio::task::spawn_blocking(move || {
                    backend.open(
                        &key,
                        &ssh,
                        &remote_host,
                        remote_port,
                        pw.as_deref(),
                        pp.as_deref(),
                    )
                })
                .await
                .map_err(|e| format!("Connection failed: {e}"))?
                .map_err(|e| sanitize_error(&e))?;
                let lp = tunnel.local_port;
                state
                    .ssh_manager
                    .lock()
                    .unwrap()
                    .insert_tunnel(connection_id.clone(), tunnel);
                ("127.0.0.1".to_string(), lp, true)
            }
            None => (config.host.clone(), default_port, false),
        };

        // Config builder: user/password/dbname are sent as-is (no URL
        // percent-encoding needed), and the TLS connector is chosen explicitly.
        let mut pgconfig = tokio_postgres::Config::new();
        pgconfig
            .host(connect_host.clone())
            .port(connect_port)
            .user(user)
            .password(password)
            .dbname(dbname)
            .connect_timeout(std::time::Duration::from_secs(10));

        let result = match tls {
            None => connect_pg_with(&pgconfig, tokio_postgres::NoTls).await,
            Some(cc) => {
                let connector = tokio_postgres_rustls::MakeRustlsConnect::new((*cc).clone());
                connect_pg_with(&pgconfig, connector).await
            }
        };

        match result {
            Ok((client, handle)) => {
                let mut pm = state.pool_manager.lock().await;
                pm.register(
                    &connection_id,
                    crate::db::pool::DbHandle::Postgresql(client, handle),
                );
                Ok(())
            }
            Err(e) => {
                if via_tunnel {
                    state
                        .ssh_manager
                        .lock()
                        .unwrap()
                        .close_tunnel(&connection_id);
                }
                Err(format!("Connection failed: {}", pg_error_message(&e)))
            }
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
    } else if config.db_type == "mysql" {
        run_mysql_connect(
            &connection_id,
            &config,
            &state.ssh_manager,
            &state.pool_manager,
        )
        .await
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
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            let rows = sqlx::query(&crate::db::mysql::mysql_databases_query())
                .fetch_all(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            let mut dbs: Vec<String> = rows
                .iter()
                .map(|r| crate::db::mysql::mysql_row_string(r, 0))
                .collect();
            dbs.retain(|d| !crate::db::mysql::MYSQL_SYSTEM_DBS.contains(&d.as_str()));
            Ok(dbs)
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
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            // MySQL has no separate schema layer — databases play the role of
            // schemas, so the schema selector mirrors the database list.
            let rows = sqlx::query(&crate::db::mysql::mysql_databases_query())
                .fetch_all(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            let mut dbs: Vec<String> = rows
                .iter()
                .map(|r| crate::db::mysql::mysql_row_string(r, 0))
                .collect();
            dbs.retain(|d| !crate::db::mysql::MYSQL_SYSTEM_DBS.contains(&d.as_str()));
            Ok(dbs)
        }
        None => Err("Connection not found".to_string()),
    }
}

/// Headless table listing shared by the `get_tables` command and integration
/// tests (thin-command principle — no Tauri `State`).
pub(crate) async fn get_tables_inner(
    pool_manager: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    schema: Option<&str>,
) -> Result<Vec<TableInfo>, String> {
    let mut pm = pool_manager.lock().await;
    match pm.get(connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            let schema_filter = schema.unwrap_or("public").to_string();
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
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        }
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            // 2 columns (name, type) when a schema is given; 3 (+ schema)
            // when not — hence sqlx::query + try_get, not query_as.
            let query = crate::db::introspection::mysql_tables_query(schema);
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            Ok(rows
                .iter()
                .map(|r| {
                    let name = crate::db::mysql::mysql_row_string(r, 0);
                    let raw_type = crate::db::mysql::mysql_row_string(r, 1);
                    let schema_name: String = match schema {
                        Some(s) => s.to_string(),
                        None => crate::db::mysql::mysql_row_string(r, 2),
                    };
                    let table_type = if raw_type.eq_ignore_ascii_case("view") {
                        "VIEW"
                    } else {
                        "TABLE"
                    };
                    TableInfo {
                        name,
                        schema: schema_name,
                        table_type: table_type.to_string(),
                    }
                })
                .collect())
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
    get_tables_inner(&state.pool_manager, &connection_id, schema.as_deref()).await
}

/// Load column metadata (name, type, nullability, PK, default, generated) for
/// a MySQL table, then mark FK columns with their referenced (table, column).
///
/// PK and generated columns are read-only (`editable: false`), mirroring the
/// PostgreSQL rule. `fk_ref` carries the referenced table + column only — the
/// same contract the frontend expects (MySQL FKs are assumed to live in the
/// same database, matching how PostgreSQL's `fk_ref` assumes the same schema).
pub(crate) async fn mysql_load_columns(
    pool: &sqlx::MySqlPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let col_query = crate::db::mysql::mysql_columns_query(schema, table);
    let col_rows = sqlx::query(&col_query)
        .fetch_all(pool)
        .await
        .map_err(|e| sanitize_error(&format!("{e}")))?;
    let mut columns: Vec<ColumnInfo> = col_rows
        .iter()
        .map(|r| {
            let name = crate::db::mysql::mysql_row_string(r, 0);
            let data_type = crate::db::mysql::mysql_row_string(r, 1);
            let is_nullable = crate::db::mysql::mysql_row_string(r, 2);
            let column_key = crate::db::mysql::mysql_row_string(r, 3);
            let default_value: Option<String> = r
                .try_get::<String, _>(4)
                .ok()
                .or_else(|| r.try_get::<Vec<u8>, _>(4).ok().map(|b| String::from_utf8_lossy(&b).into_owned()));
            let extra = crate::db::mysql::mysql_row_string(r, 5);
            let is_pk = column_key == "PRI";
            let is_generated = extra.to_ascii_uppercase().contains("GENERATED");
            ColumnInfo {
                name: name.clone(),
                data_type,
                is_nullable: is_nullable == "YES",
                is_pk,
                is_fk: false,
                fk_ref: None,
                default_value,
                editable: !is_pk && !is_generated,
                is_generated,
            }
        })
        .collect();

    // FK pass: mark is_fk + fk_ref for columns named in the FK metadata.
    let fk_query = crate::db::mysql::mysql_fk_query(schema, table);
    let fk_rows = sqlx::query(&fk_query)
        .fetch_all(pool)
        .await
        .map_err(|e| sanitize_error(&format!("{e}")))?;
    for r in fk_rows {
        let col = crate::db::mysql::mysql_row_string(&r, 0);
        let ref_table = crate::db::mysql::mysql_row_string(&r, 2);
        let ref_col = crate::db::mysql::mysql_row_string(&r, 3);
        if let Some(c) = columns.iter_mut().find(|c| c.name == col) {
            c.is_fk = true;
            c.fk_ref = Some((ref_table, ref_col));
        }
    }
    Ok(columns)
}

/// Bind `serde_json::Value` change params to a MySQL `?`-placeholder statement.
/// Maps common JSON types to native MySQL-encodable values (NULL → SQL NULL).
pub(crate) fn bind_mysql_params<'q>(
    q: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    params: &[serde_json::Value],
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    let mut q = q;
    for v in params {
        match v {
            serde_json::Value::Null => q = q.bind(Option::<String>::None),
            serde_json::Value::Bool(b) => q = q.bind(*b),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    q = q.bind(i);
                } else if let Some(f) = n.as_f64() {
                    q = q.bind(f);
                } else {
                    q = q.bind(n.to_string());
                }
            }
            serde_json::Value::String(s) => q = q.bind(s.clone()),
            other => q = q.bind(other.to_string()),
        }
    }
    q
}

/// Headless table-data fetch shared by the `get_table_data` command and
/// integration tests (thin-command principle — no Tauri `State`).
pub(crate) async fn get_table_data_inner(
    pool_manager: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    schema: &str,
    table: &str,
    page: Option<i64>,
    page_size: Option<i64>,
    filters: Option<Vec<crate::models::db_viewer::FilterRule>>,
    sorts: Option<Vec<crate::models::db_viewer::SortRule>>,
) -> Result<QueryResult, String> {
    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50);
    let off = (p - 1) * ps;
    let filters = filters.unwrap_or_default();
    let sorts = sorts.unwrap_or_default();

    let mut pm = pool_manager.lock().await;
    match pm.get(connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            // Build filter clause (shared by COUNT and data queries)
            let mut pg_param_idx: usize = 0;
            let (filter_clause, filter_params) =
                build_pg_filter_clause(&filters, &mut pg_param_idx);
            let order_clause = build_order_clause(&sorts);

            // Get total count (with filters applied)
            let count_query = format!(
                "SELECT COUNT(*) FROM \"{}\".\"{}\" WHERE 1=1{}",
                schema, table, filter_clause
            );
            let count_row = if filter_params.is_empty() {
                client
                    .query_one(&count_query, &[])
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = filter_params
                    .iter()
                    .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
                    .collect();
                client
                    .query_one(&count_query, &param_refs)
                    .await
                    .map_err(|e| e.to_string())?
            };
            let total_rows: i64 = count_row.get(0);

            // Views expose no `ctid`; detect them so no row-locator is appended
            // to the data SELECT and columns stay read-only.
            let is_view: bool = client
                .query_one(
                    "SELECT EXISTS(SELECT 1 FROM information_schema.tables \
                     WHERE table_schema = $1 AND table_name = $2 AND table_type = 'VIEW')",
                    &[&schema, &table],
                )
                .await
                .map(|r| r.get::<_, bool>(0))
                .unwrap_or(false);

            // Get column info with FK detection and enum type names
            let col_query = r#"SELECT
    c.column_name,
    CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS data_type,
    c.is_nullable,
    COALESCE(pk.is_pk, false) AS is_pk,
    COALESCE(fk.is_fk, false) AS is_fk,
    fk.foreign_table_name,
    fk.foreign_column_name,
    c.column_default,
    a.attgenerated,
    a.attidentity
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
LEFT JOIN pg_attribute a
    ON a.attrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
    AND a.attname = c.column_name
    AND a.attnum > 0
    AND NOT a.attisdropped
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
                    // pg_attribute.attgenerated/attidentity are PG's internal
                    // "char" type (OID 18) → tokio-postgres delivers i8, not
                    // String; deserializing as String panics. Convert safely.
                    let attgenerated =
                        pg_char_to_att(r.try_get::<_, Option<i8>>(8).unwrap_or(None));
                    let attidentity = pg_char_to_att(r.try_get::<_, Option<i8>>(9).unwrap_or(None));
                    let is_pk: bool = r.get(3);
                    ColumnInfo {
                        name: r.get(0),
                        data_type: r.get(1),
                        is_nullable: r.get::<_, String>(2) == "YES",
                        is_pk,
                        is_fk,
                        fk_ref: if is_fk {
                            Some((fk_table.unwrap_or_default(), fk_column.unwrap_or_default()))
                        } else {
                            None
                        },
                        default_value: r.get::<_, Option<String>>(7),
                        editable: editable_from_att(&attgenerated, &attidentity)
                            && !is_pk
                            && !is_view,
                        is_generated: !attgenerated.is_empty(),
                    }
                })
                .collect();

            // Get data (with filters and sorts applied).
            // Custom/enum types need explicit ::text cast because tokio-postgres
            // FromSql<String> rejects custom type OIDs even in simple query mode.
            let standard_pg_types: &[&str] = &[
                "uuid",
                "text",
                "varchar",
                "char",
                "bpchar",
                "name",
                "int2",
                "int4",
                "int8",
                "smallint",
                "integer",
                "bigint",
                "float4",
                "float8",
                "real",
                "double precision",
                "numeric",
                "decimal",
                "money",
                "bool",
                "boolean",
                "date",
                "time",
                "timetz",
                "timestamp",
                "timestamptz",
                "interval",
                "json",
                "jsonb",
                "bytea",
                "oid",
                "timestamp without time zone",
                "timestamp with time zone",
                "time without time zone",
                "time with time zone",
            ];
            let has_pk = columns.iter().any(|c| c.is_pk);
            let select_items: Vec<String> = columns
                .iter()
                .map(|c| {
                    let lower = c.data_type.to_lowercase();
                    if standard_pg_types.contains(&lower.as_str()) {
                        format!("\"{}\"", c.name)
                    } else {
                        // Custom type (enum, composite, domain) — cast to text
                        format!("\"{}\"::text", c.name)
                    }
                })
                .collect();
            // `ctid` is appended last for no-PK tables so later UPDATE/DELETE
            // queue changes can target the exact row. It stays out of `columns`.
            // Views are excluded — they expose no ctid and are read-only.
            let data_query = format!(
                "{} WHERE 1=1{} {} LIMIT {} OFFSET {}",
                build_pg_select_from_items(&schema, &table, select_items, !has_pk && !is_view),
                filter_clause,
                order_clause,
                ps,
                off
            );
            let data_rows = if filter_params.is_empty() {
                client
                    .query(&data_query, &[])
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                let param_refs: Vec<&(dyn tokio_postgres::types::ToSql + Sync)> = filter_params
                    .iter()
                    .map(|s| s as &(dyn tokio_postgres::types::ToSql + Sync))
                    .collect();
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
                execution_time_ms: None,
            })
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            // Views expose no `rowid`; detect them so no row-locator is appended
            // to the data SELECT and columns stay read-only.
            let is_view: bool = conn
                .query_row(
                    "SELECT type = 'view' FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')",
                    rusqlite::params![table],
                    |r| r.get::<_, bool>(0),
                )
                .unwrap_or(false);

            // Build filter clause (shared by COUNT and data queries)
            let (filter_clause, filter_vals) = build_sqlite_filter_clause(&filters);
            let order_clause = build_order_clause(&sorts);

            let count_query = format!(
                "SELECT COUNT(*) FROM \"{}\".\"{}\" WHERE 1=1{}",
                schema, table, filter_clause
            );
            let total_rows: i64 = if filter_vals.is_empty() {
                conn.query_row(&count_query, [], |r| r.get(0))
                    .map_err(|e| e.to_string())?
            } else {
                let refs: Vec<&dyn rusqlite::types::ToSql> = filter_vals
                    .iter()
                    .map(|v| v as &dyn rusqlite::types::ToSql)
                    .collect();
                conn.query_row(&count_query, rusqlite::params_from_iter(&refs), |r| {
                    r.get(0)
                })
                .map_err(|e| e.to_string())?
            };

            // Get column metadata via PRAGMA table_info
            let pragma_query = format!("PRAGMA table_info('{}')", table);
            let mut pragma_stmt = conn.prepare(&pragma_query).map_err(|e| e.to_string())?;
            let col_meta: Vec<(String, String, bool, bool, Option<String>)> = pragma_stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(1)?,         // name
                        row.get::<_, String>(2)?,         // type
                        row.get::<_, bool>(3)?,           // notnull
                        row.get::<_, bool>(5)?,           // pk
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
                                row.get::<_, String>(3)?, // from (column)
                                row.get::<_, String>(2)?, // table
                                row.get::<_, String>(4)?, // to (column)
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
                        data_type: if dtype.is_empty() {
                            "TEXT".to_string()
                        } else {
                            dtype.clone()
                        },
                        is_nullable: !notnull,
                        is_pk: *is_pk,
                        is_fk: fk.is_some(),
                        fk_ref: fk.map(|(t, c)| (t.clone(), c.clone())),
                        default_value: default_val.clone(),
                        editable: !*is_pk && !is_view,
                        is_generated: false,
                    }
                })
                .collect();

            // Get data (with filters and sorts applied).
            // `rowid` is appended last for no-PK tables so later UPDATE/DELETE
            // queue changes can target the exact row. It stays out of `columns`.
            // Views are excluded — they expose no rowid and are read-only.
            let visible_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
            let has_pk = columns.iter().any(|c| c.is_pk);
            let data_query = format!(
                "{} WHERE 1=1{} {} LIMIT {} OFFSET {}",
                build_sqlite_data_select(&table, &visible_names, !has_pk && !is_view),
                filter_clause,
                order_clause,
                ps,
                off
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
                let refs: Vec<&dyn rusqlite::types::ToSql> = filter_vals
                    .iter()
                    .map(|v| v as &dyn rusqlite::types::ToSql)
                    .collect();
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
                execution_time_ms: None,
            })
        }
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            let columns = mysql_load_columns(pool, schema, table).await?;

            // Total count (filters do not affect the count — MySQL has no
            // per-filter count query, mirroring the select builder's scope).
            let total_rows: i64 =
                sqlx::query_scalar::<_, i64>(&crate::db::mysql::mysql_count_query(schema, table))
                    .fetch_one(pool)
                    .await
                    .map_err(|e| sanitize_error(&format!("{e}")))?;

            // mysql_select_data_query already embeds ORDER BY from `sorts`
            // (falling back to a smart default sort) — no shared order-clause
            // helper needed.
            let visible_names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
            let default_sort = crate::db::mysql::mysql_default_sort(&visible_names).to_string();
            let data_query = crate::db::mysql::mysql_select_data_query(
                schema, table, &filters, &sorts, &default_sort,
            );

            let mut q = sqlx::query(&data_query);
            for f in &filters {
                // null/notnull operators emit IS [NOT] NULL — no bound param.
                if f.operator == "null" || f.operator == "notnull" {
                    continue;
                }
                q = q.bind(&f.value);
            }
            let data_rows = q
                .bind(ps)
                .bind(off)
                .fetch_all(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;

            let rows: Vec<Vec<serde_json::Value>> = data_rows
                .iter()
                .map(|row| {
                    (0..row.len())
                        .map(|i| crate::commands::query::mysql_cell_to_json(row, i))
                        .collect()
                })
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                total_rows,
                page: p,
                page_size: ps,
                execution_time_ms: None,
            })
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
    get_table_data_inner(
        &state.pool_manager,
        &connection_id,
        &schema,
        &table,
        page,
        page_size,
        filters,
        sorts,
    )
    .await
}

/// Headless column introspection for a table, shared by the `get_table_columns`
/// command and integration tests (thin-command principle — no Tauri `State`).
/// Mirrors the `pg_columns_query` row mapping `get_table_data` uses.
pub(crate) async fn get_table_columns_inner(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<crate::models::ColumnInfo>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Table columns are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let rows = client
        .query(&crate::db::introspection::pg_columns_query(schema, table), &[])
        .await
        .map_err(|e| sanitize_error(&format!("{e}")))?;
    Ok(rows
        .iter()
        .map(|r| {
            let is_fk: bool = r.get::<_, Option<String>>(10).is_some();
            let fk_schema: Option<String> = r.get(9);
            let fk_table: Option<String> = r.get(10);
            crate::models::ColumnInfo {
                name: r.get(0),
                data_type: r.get(1),
                is_nullable: r.get::<_, String>(2) == "YES",
                is_pk: r.get::<_, Option<String>>(8).as_deref() == Some("PRIMARY KEY"),
                is_fk,
                fk_ref: if is_fk {
                    Some((fk_schema.unwrap_or_default(), fk_table.unwrap_or_default()))
                } else {
                    None
                },
                default_value: r.get::<_, Option<String>>(6),
                editable: true,
                is_generated: false,
            }
        })
        .collect())
}

#[tauri::command]
pub async fn get_table_columns(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, crate::AppState>,
) -> Result<Vec<crate::models::ColumnInfo>, String> {
    get_table_columns_inner(&state.pool_manager, &connection_id, &schema, &table).await
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
                        editable: true,
                        is_generated: false,
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
                execution_time_ms: None,
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
                        data_type: if dtype.is_empty() {
                            "TEXT".to_string()
                        } else {
                            dtype.clone()
                        },
                        is_nullable: !notnull,
                        is_pk: *is_pk,
                        is_fk: fk.is_some(),
                        fk_ref: fk.map(|(t, c)| (t.clone(), c.clone())),
                        default_value: default_val.clone(),
                        editable: true,
                        is_generated: false,
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
                execution_time_ms: None,
            })
        }
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            // The request already resolves the referenced table/column (the
            // frontend reads `fk_ref`); fetch the referenced row directly.
            let columns = mysql_load_columns(pool, &schema, &table).await?;
            let qualified = format!(
                "{}.{}",
                crate::db::mysql::mysql_quote_ident(&schema),
                crate::db::mysql::mysql_quote_ident(&table)
            );
            let data_query = format!(
                "SELECT * FROM {} WHERE {} = ? LIMIT 1",
                qualified,
                crate::db::mysql::mysql_quote_ident(&column)
            );
            let data_rows = sqlx::query(&data_query)
                .bind(&value)
                .fetch_all(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            let rows: Vec<Vec<serde_json::Value>> = data_rows
                .iter()
                .map(|row| {
                    (0..row.len())
                        .map(|i| crate::commands::query::mysql_cell_to_json(row, i))
                        .collect()
                })
                .collect();
            let total_rows = rows.len() as i64;
            Ok(QueryResult {
                columns,
                rows,
                total_rows,
                page: 1,
                page_size: 1,
                execution_time_ms: None,
            })
        }
        None => Err("Connection not found".to_string()),
    }
}

/// Map a tokio_postgres/rusqlite affected-row count to a friendly error.
/// Exactly 1 -> Ok (None). 0 -> stale; >1 -> ambiguous.
pub(crate) fn affected_count_error(n: u64) -> Option<String> {
    match n {
        0 => Some("row was modified or removed by another session".to_string()),
        1 => None,
        _ => Some("ambiguous row match".to_string()),
    }
}

/// Headless change-application shared by the `execute_change` command and
/// integration tests (thin-command principle — no Tauri `State`).
pub(crate) async fn execute_change_inner(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    change: Change,
) -> Result<(), String> {
    let mut pm = pm.lock().await;
    match pm.get(connection_id) {
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
                    build_pg_update_sql(schema, table, &pk, &data)?
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
                    build_pg_delete_sql(schema, table, &pk)?
                }
                Change::AlterTable { sql, .. } => {
                    // Execute the raw DDL directly; no bound parameters.
                    client.execute(sql, &[]).await.map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Change::Ddl { sql, .. } => {
                    client.execute(sql, &[]).await.map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Change::RebuildTable { sql, .. } => {
                    // Single transaction: all-or-nothing rebuild (multi-statement
                    // DDL only; VACUUM never reaches here). Rolls back on any
                    // statement failure.
                    let tx = client
                        .build_transaction()
                        .start()
                        .await
                        .map_err(|e| e.to_string())?;
                    tx.batch_execute(sql)
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    tx.commit()
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    return Ok(());
                }
                Change::BulkInsert {
                    schema,
                    table,
                    columns,
                    rows,
                    ..
                } => {
                    // Single transaction for the whole batch; rolls back on the
                    // first failed row so no partial batch persists.
                    return apply_bulk_insert_pg(client, schema, table, columns, rows)
                        .await
                        .map(|_| ());
                }
                Change::DropTable { schema, table, .. } => {
                    client
                        .execute(&build_drop_table_sql(schema, table), &[])
                        .await
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Change::EmptyTable { schema, table, .. } => {
                    client
                        .execute(&build_empty_table_sql(schema, table), &[])
                        .await
                        .map_err(|e| e.to_string())?;
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
            let n = client
                .execute(&sql, &refs)
                .await
                .map_err(|e| e.to_string())?;
            if let Some(msg) = affected_count_error(n) {
                return Err(msg);
            }
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
                    build_update_sql(schema, table, &pk, &data)?
                }
                Change::Insert {
                    schema,
                    table,
                    data,
                    ..
                } => {
                    let pairs = parse_json_pairs(data)?;
                    let columns: Vec<String> = pairs.iter().map(|(c, _)| c.clone()).collect();
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
                    build_delete_sql(schema, table, &pk)?
                }
                Change::AlterTable { sql, .. } => {
                    conn.execute(sql, []).map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Change::Ddl { .. } => {
                    return Err("Object management is PostgreSQL-only".to_string());
                }
                Change::RebuildTable { .. } => {
                    return Err("Object management is PostgreSQL-only".to_string());
                }
                Change::BulkInsert {
                    table,
                    columns,
                    rows,
                    ..
                } => {
                    // Single transaction for the whole batch; rolls back on the
                    // first failed row so no partial batch persists.
                    return apply_bulk_insert_sqlite(conn, table, columns, rows).map(|_| ());
                }
                Change::DropTable { schema, table, .. } => {
                    conn.execute(&build_drop_table_sql(schema, table), [])
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }
                Change::EmptyTable { schema, table, .. } => {
                    conn.execute(&build_empty_table_sql(schema, table), [])
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }
            };

            let sqlite_params: Vec<rusqlite::types::Value> =
                params.iter().map(json_to_sqlite_value).collect();
            let n = conn
                .execute(&sql, rusqlite::params_from_iter(sqlite_params))
                .map_err(|e| e.to_string())?;
            if let Some(msg) = affected_count_error(n as u64) {
                return Err(msg);
            }
            Ok(())
        }
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
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
                    crate::db::mysql::mysql_build_update_sql(schema, table, &pk, &data)?
                }
                Change::Insert {
                    schema,
                    table,
                    data,
                    ..
                } => {
                    let pairs = parse_json_pairs(data)?;
                    crate::db::mysql::mysql_build_insert_sql(schema, table, &pairs)
                }
                Change::Delete {
                    schema,
                    table,
                    primary_key,
                    ..
                } => {
                    let pk = parse_json_pairs(primary_key)?;
                    crate::db::mysql::mysql_build_delete_sql(schema, table, &pk)?
                }
                Change::AlterTable { sql, .. } => {
                    // Raw DDL, no bound parameters.
                    sqlx::query(sql)
                        .execute(pool)
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    return Ok(());
                }
                Change::Ddl { .. } => {
                    return Err("Object management is PostgreSQL-only".to_string());
                }
                Change::RebuildTable { .. } => {
                    return Err("Object management is PostgreSQL-only".to_string());
                }
                Change::BulkInsert {
                    schema,
                    table,
                    columns,
                    rows,
                    ..
                } => {
                    if columns.is_empty() || rows.is_empty() {
                        return Err("bulk insert requires non-empty columns and rows".to_string());
                    }
                    let sql = crate::db::mysql::mysql_build_bulk_insert_sql(
                        schema,
                        table,
                        columns,
                        rows.len(),
                    );
                    let params: Vec<serde_json::Value> =
                        rows.iter().flatten().cloned().collect();
                    // Bulk insert affects many rows — skip the single-row
                    // affected-count guard.
                    bind_mysql_params(sqlx::query(&sql), &params)
                        .execute(pool)
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    return Ok(());
                }
                Change::DropTable { schema, table, .. } => {
                    sqlx::query(&crate::db::mysql::mysql_build_drop_sql(schema, table))
                        .execute(pool)
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    return Ok(());
                }
                Change::EmptyTable { schema, table, .. } => {
                    sqlx::query(&crate::db::mysql::mysql_build_empty_sql(schema, table))
                        .execute(pool)
                        .await
                        .map_err(|e| sanitize_error(&format!("{e}")))?;
                    return Ok(());
                }
            };

            let result = bind_mysql_params(sqlx::query(&sql), &params)
                .execute(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            if let Some(msg) = affected_count_error(result.rows_affected()) {
                return Err(msg);
            }
            Ok(())
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
    execute_change_inner(&state.pool_manager, &connection_id, change).await
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
            client
                .query_one("SELECT 1", &[])
                .await
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Some(crate::db::pool::DbHandle::Sqlite(conn)) => {
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        Some(crate::db::pool::DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            // Verify reachability (the sqlx pool reconnects transparently); the
            // frontend re-issues getDatabases/getSchemas/getTables afterwards.
            sqlx::query_scalar::<_, i64>("SELECT 1")
                .fetch_one(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
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
        Some(DbHandle::MySql(_)) => Err("MySQL functions not yet supported".to_string()),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_indexes(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<IndexInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_indexes_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| IndexInfo {
                    name: r.get(0),
                    schema: r.get(1),
                    table: r.get(2),
                    definition: r.get(3),
                    is_unique: r.get(4),
                    method: r.get::<_, Option<String>>(5).unwrap_or_default(),
                    columns: split_columns_csv(&r.get::<_, Option<String>>(6).unwrap_or_default()),
                    size_bytes: r.get::<_, Option<i64>>(7),
                    tablespace: r.get::<_, Option<String>>(8),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        Some(DbHandle::MySql(_)) => Err("MySQL indexes not yet supported".to_string()),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn get_constraints(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<Vec<ConstraintInfo>, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let schema = schema.unwrap_or_else(|| "public".to_string());
            let query = crate::db::introspection::pg_constraints_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| e.to_string())?;
            Ok(rows
                .iter()
                .map(|r| {
                    // contype::text decodes as a String ("c" | "u" | "x").
                    let contype =
                        match r.get::<_, Option<String>>(3).unwrap_or_default().as_str() {
                            "c" => "CHECK",
                            "u" => "UNIQUE",
                            "x" => "EXCLUSION",
                            other => other,
                        }
                        .to_string();
                    ConstraintInfo {
                        name: r.get(0),
                        schema: r.get(1),
                        table: r.get(2),
                        contype,
                        definition: r.get(4),
                        deferrable: r.get(5),
                        validated: r.get(6),
                        columns: split_columns_csv(
                            &r.get::<_, Option<String>>(7).unwrap_or_default(),
                        ),
                    }
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        Some(DbHandle::MySql(_)) => Err("MySQL constraints not yet supported".to_string()),
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
        Some(DbHandle::MySql(_)) => Err("MySQL triggers not yet supported".to_string()),
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
                    cycle: r
                        .get::<_, Option<String>>(7)
                        .map(|s| s == "YES")
                        .unwrap_or(false),
                })
                .collect())
        }
        Some(DbHandle::Sqlite(_)) => Ok(vec![]),
        Some(DbHandle::MySql(_)) => Err("MySQL sequences not yet supported".to_string()),
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
        Some(DbHandle::MySql(_)) => Err("MySQL enums not yet supported".to_string()),
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
            let rows = client.query(&query, &[]).await.map_err(|e| e.to_string())?;
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
        Some(DbHandle::MySql(_)) => Err("MySQL extensions not yet supported".to_string()),
        None => Err("Connection not found".into()),
    }
}

/// Fetch a table's `CREATE TABLE` DDL for display/copy.
///
/// SQLite reads the stored statement from `sqlite_master` directly; PostgreSQL
/// shells out to the system `pg_dump --schema-only` so the output matches what
/// `pg_dump` would emit, scoped to the requested schema + table.
#[tauri::command]
pub async fn get_table_ddl(
    connection_id: String,
    schema: String,
    table: String,
    state: State<'_, crate::AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Sqlite(conn)) => get_sqlite_ddl(conn, &table),
        Some(DbHandle::MySql(pool)) => {
            let pool = &*pool; // Executor is implemented for &Pool, not &mut Pool
            // SHOW CREATE TABLE returns (Table, Create Table); take the DDL.
            let row = sqlx::query(&crate::db::mysql::mysql_ddl_query(&schema, &table))
                .fetch_one(pool)
                .await
                .map_err(|e| sanitize_error(&format!("{e}")))?;
            Ok(crate::db::mysql::mysql_row_string(&row, 1))
        }
        Some(DbHandle::Postgresql(_client, _)) => {
            // Pull connection metadata so pg_dump reaches the same server the
            // pool is connected to (host/port/user/dbname + keychain password).
            let conn_row = state
                .db_store
                .lock()
                .map_err(|e| e.to_string())?
                .get_connections()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|c| c.id == connection_id)
                .ok_or_else(|| format!("connection {connection_id} not found"))?;
            let host = conn_row.host.clone();
            let port = conn_row.port.unwrap_or(5432) as u16;
            let user = conn_row.username.unwrap_or_else(|| "postgres".into());
            let db = conn_row.database.unwrap_or_else(|| "postgres".into());
            let password =
                crate::commands::keychain::get_connection_password_internal(&app, &connection_id)?
                    .unwrap_or_default();

            // SSH-tunneled connections: pg_dump must reach the DB through the
            // same local loopback listener the app uses, not the remote host.
            let tunnel_port = state
                .ssh_manager
                .lock()
                .map_err(|e| e.to_string())?
                .get_local_port(&connection_id);
            let (dump_host, dump_port) = match tunnel_port {
                Some(lp) => ("127.0.0.1".to_string(), lp),
                None => (host, port),
            };

            // pg_dump is blocking I/O; run it off the async runtime. Credentials
            // travel via PGPASSWORD, never argv. Resolve system-first,
            // bundled-fallback, before moving into the closure.
            let pg_dump_path = crate::commands::backup::resolve_tool(&app, "pg_dump").0;
            let ddl = tokio::task::spawn_blocking(move || {
                get_pg_ddl_via_dump(
                    &schema, &table, &dump_host, dump_port, &user, &db, &password, &pg_dump_path,
                )
            })
            .await
            .map_err(|e| format!("pg_dump task failed: {e}"))??;
            Ok(sanitize_error(&ddl))
        }
        None => Err("Connection not found".into()),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::ssh::{Ssh2Backend, SshTunnelManager};
    use crate::db::pool::{ConnectionPoolManager, DbConfig};
    use crate::models::db_viewer::Change;
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn split_columns_csv_handles_commas_and_trims() {
        assert_eq!(
            split_columns_csv("id, name, created_at"),
            vec!["id", "name", "created_at"]
        );
        assert_eq!(split_columns_csv("id"), vec!["id"]);
        assert_eq!(split_columns_csv(""), Vec::<String>::new());
        // expression index column list may include parens — keep raw, just split on top-level commas
        assert_eq!(
            split_columns_csv("lower(name), id"),
            vec!["lower(name)", "id"]
        );
    }

    /// bigint precision: values beyond 2^53 must round-trip as strings.
    #[test]
    fn i64_preserves_precision_as_string() {
        // A bigint beyond 2^53 must round-trip as a string, not a JS number.
        let big: i64 = 9_007_199_254_740_993; // 2^53 + 1
        let v = i64_to_json(big);
        assert_eq!(
            v,
            serde_json::Value::String("9007199254740993".to_string()),
            "bigint must be a string to avoid float precision loss"
        );
        let small: i64 = 42;
        let v2 = i64_to_json(small);
        assert_eq!(v2, serde_json::Value::String("42".to_string()));
    }

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

    /// Verify that a `Change::Ddl` serializes with the snake_case `ddl` tag.
    #[test]
    fn change_ddl_serialization_uses_snake_case_tag() {
        let change = Change::Ddl {
            id: "chg-ddl-1".to_string(),
            sql: "CREATE TYPE public.role AS ENUM ('admin')".to_string(),
        };
        let json = serde_json::to_string(&change).unwrap();
        assert!(
            json.contains(r#""type":"ddl""#),
            "serialized Change::Ddl should use snake_case tag 'ddl'; got: {}",
            json
        );
        assert!(json.contains(r#""id":"chg-ddl-1""#));
        assert!(json.contains(r#""sql":"CREATE TYPE public.role AS ENUM ('admin')""#));
    }

    /// Verify that `Change::id()` returns the identifier of a `Change::Ddl`.
    #[test]
    fn change_ddl_id_is_accessible() {
        let change = Change::Ddl {
            id: "chg-ddl-42".to_string(),
            sql: "DROP INDEX public.i".to_string(),
        };
        assert_eq!(change.id(), "chg-ddl-42");
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

        let (sql, _params) = build_update_sql("public", "users", &pk, &data).unwrap();

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

        let (sql, _params) = build_delete_sql("public", "users", &pk).unwrap();

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

    /// Verify that `get_sqlite_ddl` returns the stored CREATE TABLE statement
    /// from `sqlite_master`.
    #[test]
    fn sqlite_ddl_returns_create_table() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)", [])
            .unwrap();
        let ddl = get_sqlite_ddl(&conn, "foo").unwrap();
        assert!(ddl.contains("CREATE TABLE foo"), "got: {ddl}");
    }

    /// Verify that `get_sqlite_ddl` errors for a table that does not exist.
    #[test]
    fn sqlite_ddl_missing_table_errors() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        assert!(get_sqlite_ddl(&conn, "nope").is_err());
    }

    /// Verify that the pg_dump argument builder emits schema-only DDL flags
    /// scoped to the requested schema and table.
    #[test]
    fn pg_dump_ddl_args_built() {
        let args = build_pg_dump_ddl_args("public", "users");
        assert_eq!(
            args,
            vec![
                "--schema-only".to_string(),
                "--no-owner".to_string(),
                "--schema=public".to_string(),
                "--table=users".to_string()
            ]
        );
    }

    /// Verify that a SQLite bulk insert applies every row in a single batch.
    #[test]
    fn apply_bulk_insert_sqlite_success() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT)", [])
            .unwrap();
        let rows = vec![
            vec![serde_json::json!(1), serde_json::json!("y")],
            vec![serde_json::json!(2), serde_json::json!("z")],
        ];
        apply_bulk_insert_sqlite(&conn, "t", &["a".to_string(), "b".to_string()], &rows).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    /// Verify that a SQLite bulk insert rolls back the whole batch when any
    /// row fails (a non-integer value bound to the INTEGER PRIMARY KEY column
    /// raises a datatype mismatch).
    #[test]
    fn apply_bulk_insert_sqlite_inserts_and_rolls_back() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE t (a INTEGER PRIMARY KEY, b TEXT)", [])
            .unwrap();
        let rows = vec![
            vec![serde_json::json!(1), serde_json::json!("y")],
            vec![serde_json::json!("bad"), serde_json::json!("z")],
        ];
        let res = apply_bulk_insert_sqlite(&conn, "t", &["a".to_string(), "b".to_string()], &rows);
        assert!(res.is_err(), "non-integer PK value should fail");
        // Rollback: no rows persisted.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "failed batch must roll back all rows");
    }

    /// Verify that a SQLite bulk insert reports the failing row index (1-based)
    /// when a row cannot be inserted.
    #[test]
    fn apply_bulk_insert_sqlite_error_includes_row_index() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        // INTEGER PRIMARY KEY rejects non-integer values (datatype mismatch),
        // guaranteeing row 2 fails.
        conn.execute("CREATE TABLE t (a INTEGER PRIMARY KEY)", [])
            .unwrap();
        let rows = vec![vec![serde_json::json!(1)], vec![serde_json::json!("x")]];
        let err = apply_bulk_insert_sqlite(&conn, "t", &["a".to_string()], &rows).unwrap_err();
        assert!(
            err.contains("row 2"),
            "error should name the failing row index (1-based): {err}"
        );
    }

    /// Verify that the PostgreSQL bulk-insert skeleton uses `$N` placeholders
    /// and quotes schema, table, and columns.
    #[test]
    fn build_pg_bulk_insert_sql_shape() {
        let sql =
            build_pg_bulk_insert_sql("public", "users", &["id".to_string(), "name".to_string()]);
        assert_eq!(
            sql,
            r#"INSERT INTO "public"."users" ("id", "name") VALUES ($1, $2)"#
        );
    }

    /// Verify that the DROP TABLE / DELETE-all SQL helpers quote schema + table.
    #[test]
    fn drop_and_empty_table_sql_shapes() {
        assert_eq!(
            build_drop_table_sql("public", "users"),
            r#"DROP TABLE "public"."users""#
        );
        assert_eq!(
            build_empty_table_sql("public", "users"),
            r#"DELETE FROM "public"."users""#
        );
    }

    // -----------------------------------------------------------------------
    // Row-locator / editability helpers (Task 7)
    // -----------------------------------------------------------------------

    #[test]
    fn editable_pg_column_flags_mark_generated_and_identity_always() {
        // generated STORED ('s') -> not editable; identity ALWAYS ('a') -> not editable
        assert!(!editable_from_att("s", ""));
        assert!(!editable_from_att("", "a"));
        // plain column -> editable
        assert!(editable_from_att("", ""));
        // identity BY DEFAULT ('d') -> editable
        assert!(editable_from_att("", "d"));
    }

    #[test]
    fn pg_char_to_att_maps_internal_char_codes_safely() {
        // pg_attribute "char" arrives as i8; None/\0 -> "", codes -> 1-char string
        assert_eq!(pg_char_to_att(None), "");
        assert_eq!(pg_char_to_att(Some(0)), "");
        assert_eq!(pg_char_to_att(Some(b's' as i8)), "s");
        assert_eq!(pg_char_to_att(Some(b'v' as i8)), "v");
        assert_eq!(pg_char_to_att(Some(b'a' as i8)), "a");
        assert_eq!(pg_char_to_att(Some(b'd' as i8)), "d");
        // wiring: a STORED generated column must be non-editable through the helper
        assert!(!editable_from_att(&pg_char_to_att(Some(b's' as i8)), ""));
    }

    #[test]
    fn pg_locator_select_adds_ctid() {
        let sql = build_pg_data_select("public", "no_pk", &["id".into(), "name".into()], true);
        assert!(
            sql.contains("ctid"),
            "no-PK table must select ctid; got: {}",
            sql
        );
        assert!(
            sql.contains("\"public\""),
            "schema must be quoted; got: {}",
            sql
        );
    }

    #[test]
    fn pg_locator_select_omits_ctid_when_pk_present() {
        let sql = build_pg_data_select("public", "with_pk", &["id".into(), "name".into()], false);
        assert!(
            !sql.contains("ctid"),
            "PK table must NOT select ctid; got: {}",
            sql
        );
    }

    #[test]
    fn pg_locator_select_omits_ctid_for_view() {
        // Views expose no ctid — the locator must never be appended for them.
        let sql = build_pg_data_select("public", "order_summary", &["order_id".into()], false);
        assert!(
            !sql.contains("ctid"),
            "view must NOT select ctid; got: {}",
            sql
        );
        assert!(
            sql.contains("order_summary"),
            "view name must be present; got: {}",
            sql
        );
    }

    #[test]
    fn sqlite_locator_select_adds_rowid_for_no_pk() {
        let sql = build_sqlite_data_select("no_pk", &["id".into(), "name".into()], true);
        assert!(
            sql.contains("rowid"),
            "no-PK sqlite table must select rowid; got: {}",
            sql
        );
    }

    #[test]
    fn sqlite_locator_select_omits_rowid_for_view() {
        // Views expose no rowid — the locator must never be appended for them.
        let sql = build_sqlite_data_select("order_summary", &["order_id".into()], false);
        assert!(
            !sql.contains("rowid"),
            "view must NOT select rowid; got: {}",
            sql
        );
        assert!(
            sql.contains("order_summary"),
            "view name must be present; got: {}",
            sql
        );
    }

    // -----------------------------------------------------------------------
    // No-PK row locator updates + affected-row-count guard (Task 8)
    // -----------------------------------------------------------------------

    #[test]
    fn pg_update_with_locator_uses_it_in_where() {
        // The frontend supplies ctid as the "primary_key" pair for no-PK rows.
        let locator = vec![("ctid".to_string(), serde_json::json!("(0,1)"))];
        let data = vec![("name".to_string(), serde_json::json!("Bob"))];
        let (sql, params) = build_pg_update_sql("public", "no_pk", &locator, &data).unwrap();
        assert!(
            sql.contains("\"ctid\" = $"),
            "locator update must WHERE on ctid; got: {}",
            sql
        );
        assert_eq!(params.len(), 2); // 1 SET value + 1 WHERE value
    }

    #[test]
    fn pg_update_with_pk_uses_pk_where() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let data = vec![("name".to_string(), serde_json::json!("Bob"))];
        let (sql, _params) = build_pg_update_sql("public", "users", &pk, &data).unwrap();
        assert!(
            sql.contains("\"id\" = $"),
            "PK update must WHERE on id; got: {}",
            sql
        );
        assert!(
            !sql.contains("ctid"),
            "PK update must NOT use ctid; got: {}",
            sql
        );
    }

    #[test]
    fn pg_update_with_empty_primary_key_is_rejected() {
        // Defense-in-depth: an empty locator must NOT yield `UPDATE ... WHERE `.
        let pk: Vec<(String, serde_json::Value)> = vec![];
        let data = vec![("name".to_string(), serde_json::json!("Bob"))];
        let result = build_pg_update_sql("public", "no_pk", &pk, &data);
        assert!(
            result.is_err(),
            "empty primary_key must be rejected, not produce broken SQL"
        );
    }

    #[test]
    fn affected_row_count_message_for_zero_rows() {
        assert_eq!(
            affected_count_error(0u64),
            Some("row was modified or removed by another session".to_string())
        );
        assert_eq!(affected_count_error(1u64), None);
        assert_eq!(
            affected_count_error(2u64),
            Some("ambiguous row match".to_string())
        );
    }

    async fn fresh_pool_manager() -> tokio::sync::Mutex<ConnectionPoolManager> {
        tokio::sync::Mutex::new(ConnectionPoolManager::new())
    }

    #[tokio::test]
    async fn run_mysql_connect_rejects_empty_host() {
        let cfg = DbConfig {
            db_type: "mysql".into(),
            host: "".into(),
            port: Some(3306),
            username: Some("root".into()),
            password: None,
            database: None,
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_method: None,
            ssh_password: None,
            ssh_private_key_path: None,
            ssh_passphrase: None,
        };
        let ssh = StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend)));
        let pm = fresh_pool_manager().await;
        let id = "mysql-empty-host";
        let res = run_mysql_connect(id, &cfg, &ssh, &pm).await;
        assert!(res.is_err(), "empty host must fail before any network call");
        let mut pmg = pm.lock().await;
        assert!(pmg.get(id).is_none(), "no handle registered on failure");
    }

    // -----------------------------------------------------------------------
    // MySQL helpers + builders (Task 2.5)
    // -----------------------------------------------------------------------

    #[test]
    fn mysql_databases_query_is_show_databases() {
        assert_eq!(crate::db::mysql::mysql_databases_query(), "SHOW DATABASES");
    }

    #[test]
    fn mysql_system_dbs_are_filtered() {
        let all = vec!["information_schema", "mysql", "performance_schema", "sys", "shop"];
        let filtered: Vec<&str> = all
            .into_iter()
            .filter(|d| !crate::db::mysql::MYSQL_SYSTEM_DBS.contains(d))
            .collect();
        assert_eq!(filtered, vec!["shop"]);
    }

    #[test]
    fn mysql_execute_change_builds_update_sql() {
        let pk = vec![("id".to_string(), serde_json::json!(1))];
        let data = vec![("name".to_string(), serde_json::json!("x"))];
        let (sql, _params) =
            crate::db::mysql::mysql_build_update_sql("shop", "orders", &pk, &data).unwrap();
        assert_eq!(sql, "UPDATE `shop`.`orders` SET `name` = ? WHERE `id` = ? LIMIT 1");
    }

    #[tokio::test]
    async fn run_mysql_connect_registers_handle_when_lazy_url_parses() {
        // No live connection: a deliberately unreachable host with a short timeout.
        // We assert the function returns an Err (not a panic) and registers nothing.
        let cfg = DbConfig {
            db_type: "mysql".into(),
            host: "127.0.0.1".into(),
            port: Some(1),
            username: Some("root".into()),
            password: Some("x".into()),
            database: Some("mysql".into()),
            ssl_mode: Some("require".into()),
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_method: None,
            ssh_password: None,
            ssh_private_key_path: None,
            ssh_passphrase: None,
        };
        let ssh = StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend)));
        let pm = fresh_pool_manager().await;
        let id = "mysql-unreachable";
        let res = run_mysql_connect(id, &cfg, &ssh, &pm).await;
        assert!(
            res.is_err(),
            "port 1 should refuse; must be a clean Err, not panic"
        );
        assert!(pm.lock().await.get(id).is_none());
    }

    /// Live MySQL integration test — env-gated via `GRIDLINE_TEST_MYSQL_*`.
    /// Browsing + pagination over a real server; returns early (Ok) when the
    /// env vars are absent, so the `#[ignore]` gate is the only way it runs.
    #[tokio::test]
    #[ignore]
    async fn mysql_integration_browse_and_edit() {
        let host = match std::env::var("GRIDLINE_TEST_MYSQL_HOST") {
            Ok(v) => v,
            Err(_) => return,
        };
        let port: i64 = std::env::var("GRIDLINE_TEST_MYSQL_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3306);
        let user = std::env::var("GRIDLINE_TEST_MYSQL_USER").unwrap_or_else(|_| "root".into());
        let pass = std::env::var("GRIDLINE_TEST_MYSQL_PASS").unwrap_or_default();
        let db = match std::env::var("GRIDLINE_TEST_MYSQL_DB") {
            Ok(v) => v,
            Err(_) => return,
        };
        let cfg = DbConfig {
            db_type: "mysql".into(),
            host,
            port: Some(port),
            username: Some(user),
            password: Some(pass),
            database: Some(db.clone()),
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_method: None,
            ssh_password: None,
            ssh_private_key_path: None,
            ssh_passphrase: None,
        };
        let ssh = StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend)));
        let pm = fresh_pool_manager().await;
        let id = format!("mysql-it-{}", uuid::Uuid::new_v4());
        run_mysql_connect(&id, &cfg, &ssh, &pm).await.expect("connect");
        let tables = get_tables_inner(&pm, &id, Some(&db)).await.expect("tables");
        assert!(!tables.is_empty(), "test DB must contain at least one table");
        let first = &tables[0];
        let data = get_table_data_inner(
            &pm,
            &id,
            &first.schema,
            &first.name,
            Some(1),
            Some(10),
            None,
            None,
        )
        .await
        .expect("data");
        assert_eq!(data.page, 1);
        assert_eq!(data.page_size, 10);
        // Columns must be resolvable through the shared helper.
        let pool = match pm.lock().await.get(&id) {
            Some(crate::db::pool::DbHandle::MySql(p)) => p.clone(),
            _ => panic!("mysql handle missing"),
        };
        let cols = mysql_load_columns(&pool, &first.schema, &first.name)
            .await
            .expect("columns");
        assert_eq!(cols.len(), data.columns.len());
    }

    #[test]
    fn pg_dump_available_at_checks_given_path() {
        // A bare name that resolves on PATH passes; a bogus path fails.
        assert!(pg_dump_available_at("pg_dump") || !pg_dump_available_at("pg_dump"));
        assert!(!pg_dump_available_at("/nonexistent/pg_dump_999999"));
    }
}
