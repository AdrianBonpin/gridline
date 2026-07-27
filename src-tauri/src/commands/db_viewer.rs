//! DB Viewer helper functions.
//!
//! This module provides pure SQL builder functions and pagination helpers
//! for the database viewer. No actual DB connections are needed.
//!
//! **IMPORTANT:** All functions are pure string/value transformers.
//! They do NOT take `State` or connection pools.

use crate::models::db_viewer::TableInfo;

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