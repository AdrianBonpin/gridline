#[allow(unused_imports)]
use crate::models::db_viewer::{SchemaGraph, TableNode, GraphColumn, Relationship};
use tauri::State;

/// Validate a schema name for safe use in parameterized queries.
/// Rejects empty strings and names containing SQL metacharacters.
pub fn validate_schema_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Schema name cannot be empty".into());
    }
    if name.contains(';')
        || name.contains("--")
        || name.contains("/*")
        || name.contains('\'')
        || name.contains('"')
        || name.contains('\\')
    {
        return Err(format!("Invalid schema name: {}", name));
    }
    Ok(())
}

/// Build a parameterized query that fetches all tables, columns, and
/// PK/FK/UNIQUE metadata for a PostgreSQL schema in a single round-trip.
pub fn build_pg_schema_graph_query(_schema: &str) -> String {
    r#"SELECT
      t.table_name,
      t.table_schema,
      t.table_type,
      c.column_name,
      CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS data_type,
      c.is_nullable,
      c.ordinal_position,
      COALESCE(pk.is_pk, false) AS is_pk,
      COALESCE(fk.is_fk, false) AS is_fk,
      fk.foreign_table_schema,
      fk.foreign_table_name,
      fk.foreign_column_name,
      COALESCE(uq.is_unique, false) AS is_unique
  FROM information_schema.tables t
  JOIN information_schema.columns c
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  LEFT JOIN (
      SELECT ku.table_schema, ku.table_name, ku.column_name, true AS is_pk
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
          ON tc.constraint_catalog = ku.constraint_catalog
          AND tc.constraint_schema = ku.constraint_schema
          AND tc.constraint_name = ku.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
  ) pk ON c.table_schema = pk.table_schema
      AND c.table_name = pk.table_name
      AND c.column_name = pk.column_name
  LEFT JOIN (
      SELECT ku.table_schema, ku.table_name, ku.column_name, true AS is_fk,
             ccu.table_schema AS foreign_table_schema,
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
  ) fk ON c.table_schema = fk.table_schema
      AND c.table_name = fk.table_name
      AND c.column_name = fk.column_name
  LEFT JOIN (
      SELECT ku.table_schema, ku.table_name, ku.column_name, true AS is_unique
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
          ON tc.constraint_catalog = ku.constraint_catalog
          AND tc.constraint_schema = ku.constraint_schema
          AND tc.constraint_name = ku.constraint_name
      WHERE tc.constraint_type = 'UNIQUE'
  ) uq ON c.table_schema = uq.table_schema
      AND c.table_name = uq.table_name
      AND c.column_name = uq.column_name
  WHERE t.table_schema = $1
      AND t.table_type IN ('BASE TABLE', 'VIEW')
  ORDER BY t.table_name, c.ordinal_position"#.to_string()
}

/// Infer relationship cardinality from constraint metadata.
pub fn infer_cardinality(is_pk: bool, is_unique: bool, is_join_table_fk: bool) -> String {
    if is_join_table_fk {
        "N:M".into()
    } else if is_pk || is_unique {
        "1:1".into()
    } else {
        "1:N".into()
    }
}

#[tauri::command]
pub async fn get_schema_graph(
    _connection_id: String,
    schema: Option<String>,
    _state: State<'_, crate::AppState>,
) -> Result<SchemaGraph, String> {
    let schema = schema.unwrap_or_else(|| "public".to_string());
    validate_schema_name(&schema)?;

    // Placeholder: return empty graph for now
    Ok(SchemaGraph {
        tables: vec![],
        relationships: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_schema_name_rejects_empty() {
        assert!(validate_schema_name("").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_semicolon() {
        assert!(validate_schema_name("public; DROP TABLE users").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_sql_comment() {
        assert!(validate_schema_name("public--comment").is_err());
        assert!(validate_schema_name("public/*comment*/").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_quotes() {
        assert!(validate_schema_name("pub'lic").is_err());
        assert!(validate_schema_name("pub\"lic").is_err());
    }

    #[test]
    fn validate_schema_name_rejects_backslash() {
        assert!(validate_schema_name("public\\schema").is_err());
    }

    #[test]
    fn validate_schema_name_accepts_valid_names() {
        assert!(validate_schema_name("public").is_ok());
        assert!(validate_schema_name("my_schema").is_ok());
        assert!(validate_schema_name("schema123").is_ok());
        assert!(validate_schema_name("auth").is_ok());
    }

    #[test]
    fn build_pg_schema_graph_query_is_parameterized() {
        let sql = build_pg_schema_graph_query("public");
        // Must use $1 for schema parameter (parameterized)
        assert!(sql.contains("$1"), "query should use $1 placeholder; got: {}", sql);
        // Must not interpolate schema name directly in a potentially unsafe way
        assert!(!sql.contains("'public'"), "query should not use literal 'public'");
    }

    #[test]
    fn build_pg_schema_graph_query_queries_columns() {
        let sql = build_pg_schema_graph_query("myschema");
        assert!(sql.contains("information_schema.columns"), "should query columns");
        assert!(sql.contains("information_schema.tables"), "should query tables");
        assert!(sql.contains("constraint_type"), "should include constraint info");
    }

    #[test]
    fn infer_cardinality_one_to_one_pk() {
        assert_eq!(infer_cardinality(true, false, false), "1:1");
    }

    #[test]
    fn infer_cardinality_one_to_one_unique() {
        assert_eq!(infer_cardinality(false, true, false), "1:1");
    }

    #[test]
    fn infer_cardinality_one_to_many() {
        assert_eq!(infer_cardinality(false, false, false), "1:N");
    }

    #[test]
    fn infer_cardinality_many_to_many() {
        assert_eq!(infer_cardinality(false, false, true), "N:M");
    }
}