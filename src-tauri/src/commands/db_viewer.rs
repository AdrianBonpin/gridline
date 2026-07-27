//! DB Viewer helper functions and Tauri commands.
//!
//! This module provides pure SQL builder functions, pagination helpers,
//! and Tauri commands for the database viewer.

use crate::db::pool::DbConfig;
use crate::models::db_viewer::{Change, ColumnInfo, QueryResult, TableInfo};
use tauri::State;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/// Calculate the database offset for a given page and page size.
///
/// Uses 1-based page indexing:
/// - page 1, page_size 50 => offset 0
/// - page 2, page_size 50 => offset 50
/// - page 5, page_size 25 => offset 100
pub fn offset(page: i64, page_size: i64) -> i64 {
    (page - 1) * page_size
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

/// Parse JSON query result rows into `TableInfo` structs.
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
/// Tries common PostgreSQL types (String, i64, f64, bool) in order.
/// Falls back to `Null` if no type matches.
///
/// **Note:** This is a simplified approach. Complex types (arrays, JSON, etc.)
/// may not be handled correctly. Future iterations should use proper type
/// mapping via `typeinfo` from `get_table_data`'s column introspection.
fn pg_value_to_json(row: &tokio_postgres::Row, i: usize) -> serde_json::Value {
    if let Ok(Some(v)) = row.try_get::<_, Option<String>>(i) {
        return serde_json::Value::String(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<i64>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<f64>>(i) {
        return serde_json::json!(v);
    }
    if let Ok(Some(v)) = row.try_get::<_, Option<bool>>(i) {
        return serde_json::json!(v);
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

        let conn_str = format!(
            "host={} port={} user={} dbname={} password={}",
            host, port, user, dbname, password
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
            Err(e) => Err(format!("Connection failed: {}", e)),
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
        _ => Err(
            "Connection not found or not supported for listing databases".to_string(),
        ),
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
    state: State<'_, crate::AppState>,
) -> Result<QueryResult, String> {
    let p = page.unwrap_or(1);
    let ps = page_size.unwrap_or(50);
    let off = (p - 1) * ps;

    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(crate::db::pool::DbHandle::Postgresql(client, _)) => {
            // Get total count
            let count_query =
                format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table);
            let count_row = client
                .query_one(&count_query, &[])
                .await
                .map_err(|e| e.to_string())?;
            let total_rows: i64 = count_row.get(0);

            // Get column info
            let col_query = "SELECT column_name, data_type, is_nullable, COALESCE((SELECT true FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY' AND ku.column_name = c.column_name), false) as is_pk, false as is_fk, column_default FROM information_schema.columns c WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position".to_string();
            let col_rows = client
                .query(&col_query, &[&schema, &table])
                .await
                .map_err(|e| e.to_string())?;
            let columns: Vec<ColumnInfo> = col_rows
                .iter()
                .map(|r| ColumnInfo {
                    name: r.get(0),
                    data_type: r.get(1),
                    is_nullable: r.get::<_, String>(2) == "YES",
                    is_pk: r.get(3),
                    is_fk: r.get(4),
                    fk_ref: None,
                    default_value: r.get::<_, Option<String>>(5),
                })
                .collect();

            // Get data
            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
                schema, table, ps, off
            );
            let data_rows = client
                .query(&data_query, &[])
                .await
                .map_err(|e| e.to_string())?;
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
            let count_query =
                format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table);
            let total_rows: i64 = conn
                .query_row(&count_query, [], |r| r.get(0))
                .map_err(|e| e.to_string())?;

            let data_query = format!(
                "SELECT * FROM \"{}\".\"{}\" LIMIT {} OFFSET {}",
                schema, table, ps, off
            );
            let mut stmt = conn.prepare(&data_query).map_err(|e| e.to_string())?;
            let col_count = stmt.column_count();

            let columns: Vec<ColumnInfo> = (0..col_count)
                .map(|i| ColumnInfo {
                    name: stmt.column_name(i).unwrap_or("?").to_string(),
                    data_type: "TEXT".to_string(),
                    is_nullable: true,
                    is_pk: false,
                    is_fk: false,
                    fk_ref: None,
                    default_value: None,
                })
                .collect();

            let rows: Vec<Vec<serde_json::Value>> = stmt
                .query_map([], |row| {
                    let mut vals = Vec::new();
                    for i in 0..col_count {
                        let val: Option<String> = row.get(i).unwrap_or(None);
                        vals.push(
                            val.map(serde_json::Value::String)
                                .unwrap_or(serde_json::Value::Null),
                        );
                    }
                    Ok(vals)
                })
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();

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
pub async fn execute_change(
    connection_id: String,
    change: Change,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // Stub: execution is not yet implemented
    let _ = (connection_id, change, state);
    Err("Not yet implemented".to_string())
}

#[tauri::command]
pub async fn refresh_connection(
    connection_id: String,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    // Stub: re-query and return updated databases/schemas/tables metadata.
    // For now, just acknowledge the request.
    let _ = (connection_id, state);
    Ok(())
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
            json.contains(r#""type":"Update""#),
            "serialized Change::Update should contain type tag 'Update'; got: {}",
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