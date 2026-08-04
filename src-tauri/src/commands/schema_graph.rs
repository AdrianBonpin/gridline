#[allow(unused_imports)]
use crate::db::pool::DbHandle;
use crate::models::db_viewer::{GraphColumn, Relationship, SchemaGraph, TableNode};
use std::collections::HashMap;
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
    // Uses pg_catalog directly instead of information_schema views.
    // information_schema views are extremely slow on some servers (remote/
    // cloud) because they scan all databases' catalogs. pg_catalog with
    // LATERAL joins is typically 500x+ faster (~200ms vs 120s for 55 tables).
    r#"SELECT
    c.relname AS table_name,
    n.nspname AS table_schema,
    CASE WHEN c.relkind = 'v' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type,
    a.attname AS column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
    NOT a.attnotnull AS is_nullable,
    a.attnum AS ordinal_position,
    COALESCE(pk.is_pk, false) AS is_pk,
    COALESCE(fk.is_fk, false) AS is_fk,
    fk.foreign_table_schema,
    fk.foreign_table_name,
    fk.foreign_column_name,
    COALESCE(uq.is_unique, false) AS is_unique
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
LEFT JOIN LATERAL (
    SELECT true AS is_pk
    FROM pg_catalog.pg_constraint pk2
    WHERE pk2.conrelid = c.oid AND pk2.contype = 'p' AND a.attnum = ANY(pk2.conkey)
    LIMIT 1
) pk ON true
LEFT JOIN LATERAL (
    SELECT true AS is_fk,
           ref_n.nspname AS foreign_table_schema,
           ref_c.relname AS foreign_table_name,
           ref_a.attname AS foreign_column_name
    FROM pg_catalog.pg_constraint fk2
    JOIN pg_catalog.pg_class ref_c ON fk2.confrelid = ref_c.oid
    JOIN pg_catalog.pg_namespace ref_n ON ref_c.relnamespace = ref_n.oid
    JOIN pg_catalog.pg_attribute ref_a
        ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = ANY(fk2.confkey)
    WHERE fk2.conrelid = c.oid AND fk2.contype = 'f'
      AND a.attnum = ANY(fk2.conkey)
    LIMIT 1
) fk ON true
LEFT JOIN LATERAL (
    SELECT true AS is_unique
    FROM pg_catalog.pg_constraint uq2
    WHERE uq2.conrelid = c.oid AND uq2.contype = 'u' AND a.attnum = ANY(uq2.conkey)
    LIMIT 1
) uq ON true
WHERE n.nspname = $1
    AND c.relkind IN ('r', 'v', 'p')
    AND a.attnum > 0
    AND NOT a.attisdropped
ORDER BY c.relname, a.attnum"#
        .to_string()
}

/// Infer relationship cardinality from constraint metadata.
///
/// - `is_pk`: the FK column is also part of the primary key
/// - `is_unique`: the FK column has a UNIQUE constraint
/// - `is_nullable`: the FK column allows NULL values
/// - `is_join_table_fk`: this FK belongs to a join table
pub fn infer_cardinality(
    is_pk: bool,
    is_unique: bool,
    is_nullable: bool,
    is_join_table_fk: bool,
) -> String {
    if is_join_table_fk {
        return "N:M".into();
    }
    let one_side = is_pk || is_unique;
    match (one_side, is_nullable) {
        (true, false) => "1:1".into(),
        (true, true) => "0..1:0..1".into(),
        (false, false) => "1:N".into(),
        (false, true) => "0..N".into(),
    }
}

pub fn parse_pg_schema_rows(
    rows: &[Vec<serde_json::Value>],
) -> (Vec<TableNode>, Vec<Relationship>) {
    let mut table_map: HashMap<(String, String), (String, Vec<GraphColumn>)> = HashMap::new();
    let mut relationships: Vec<Relationship> = Vec::new();

    for row in rows {
        let table_name = row[0].as_str().unwrap_or_default().to_string();
        let table_schema = row[1].as_str().unwrap_or_default().to_string();
        let table_type = row[2].as_str().unwrap_or_default().to_string();
        let col_name = row[3].as_str().unwrap_or_default().to_string();
        let data_type = row[4].as_str().unwrap_or_default().to_string();
        let is_nullable = row[5].as_bool().unwrap_or(false);
        let is_pk = row[7].as_bool().unwrap_or(false);
        let is_fk = row[8].as_bool().unwrap_or(false);
        let fk_schema = row[9].as_str().map(String::from);
        let fk_table = row[10].as_str().map(String::from);
        let fk_column = row[11].as_str().map(String::from);
        let is_unique = row[12].as_bool().unwrap_or(false);

        let fk_ref = if is_fk {
            match (&fk_schema, &fk_table, &fk_column) {
                (Some(s), Some(t), Some(c)) => Some((s.clone(), t.clone(), c.clone())),
                _ => None,
            }
        } else {
            None
        };

        let col = GraphColumn {
            name: col_name.clone(),
            data_type,
            is_pk,
            is_fk,
            is_unique: is_unique || is_pk,
            is_nullable,
            fk_ref: fk_ref.clone(),
        };

        let key = (table_schema.clone(), table_name.clone());
        table_map
            .entry(key)
            .or_insert_with(|| (table_type.clone(), Vec::new()))
            .1
            .push(col);

        if let Some((ref_schema, ref_table, ref_column)) = fk_ref {
            relationships.push(Relationship {
                source_schema: table_schema.clone(),
                source_table: table_name.clone(),
                source_column: col_name,
                target_schema: ref_schema,
                target_table: ref_table,
                target_column: ref_column,
                cardinality: String::new(),
            });
        }
    }

    // Detect N:M join tables: tables where ALL PK columns are also FK columns
    let join_table_keys: Vec<(String, String)> = table_map
        .iter()
        .filter(|(_, (_, cols))| {
            let pk_cols: Vec<&GraphColumn> = cols.iter().filter(|c| c.is_pk).collect();
            !pk_cols.is_empty() && pk_cols.iter().all(|c| c.is_fk)
        })
        .map(|(k, _)| k.clone())
        .collect();

    // Assign cardinality to each relationship
    for rel in &mut relationships {
        let source_key = (rel.source_schema.clone(), rel.source_table.clone());
        let is_join = join_table_keys.contains(&source_key);
        let (is_pk_or_unique, is_nullable) = table_map
            .get(&source_key)
            .and_then(|(_, cols)| cols.iter().find(|c| c.name == rel.source_column))
            .map(|c| (c.is_pk || c.is_unique, c.is_nullable))
            .unwrap_or((false, false));
        rel.cardinality = infer_cardinality(is_pk_or_unique, is_pk_or_unique, is_nullable, is_join);
    }

    let mut tables: Vec<TableNode> = table_map
        .into_iter()
        .map(|((schema, name), (table_type, columns))| TableNode {
            name,
            schema,
            table_type,
            columns,
        })
        .collect();
    tables.sort_by(|a, b| a.name.cmp(&b.name));

    (tables, relationships)
}

fn build_sqlite_schema_graph(
    conn: &rusqlite::Connection,
    schema: &str,
) -> Result<SchemaGraph, String> {
    if schema != "main" {
        return Err(format!(
            "SQLite only supports schema 'main', got: {}",
            schema
        ));
    }

    let mut stmt = conn
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .map_err(|e| e.to_string())?;
    let table_rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    let mut tables: Vec<TableNode> = Vec::new();
    let mut relationships: Vec<Relationship> = Vec::new();

    for (table_name, table_type) in &table_rows {
        let pragma_sql = format!("PRAGMA table_info('{}')", table_name);
        let mut ps = conn.prepare(&pragma_sql).map_err(|e| e.to_string())?;
        let col_meta: Vec<(String, String, bool, bool)> = ps
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, bool>(3)?,
                    row.get::<_, bool>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        let fk_sql = format!("PRAGMA foreign_key_list('{}')", table_name);
        let fk_cols: HashMap<String, (String, String)> = if let Ok(mut fs) = conn.prepare(&fk_sql) {
            fs.query_map([], |row| {
                Ok((
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .map(|(col, ref_t, ref_c)| (col, (ref_t, ref_c)))
            .collect()
        } else {
            HashMap::new()
        };

        let columns: Vec<GraphColumn> = col_meta
            .iter()
            .map(|(name, dtype, _nn, is_pk)| {
                let fk = fk_cols.get(name);
                let is_fk = fk.is_some();
                let fk_ref = fk.map(|(t, c)| ("main".into(), t.clone(), c.clone()));
                if let Some((ref_t, ref_c)) = fk {
                    relationships.push(Relationship {
                        source_schema: "main".into(),
                        source_table: table_name.clone(),
                        source_column: name.clone(),
                        target_schema: "main".into(),
                        target_table: ref_t.clone(),
                        target_column: ref_c.clone(),
                        cardinality: infer_cardinality(*is_pk, false, !_nn, false),
                    });
                }
                GraphColumn {
                    name: name.clone(),
                    data_type: if dtype.is_empty() {
                        "TEXT".into()
                    } else {
                        dtype.clone()
                    },
                    is_pk: *is_pk,
                    is_fk,
                    is_unique: *is_pk,
                    is_nullable: !_nn,
                    fk_ref: fk_ref.map(|(s, t, c)| (s, t, c)),
                }
            })
            .collect();

        tables.push(TableNode {
            name: table_name.clone(),
            schema: "main".into(),
            table_type: table_type.to_uppercase(),
            columns,
        });
    }

    Ok(SchemaGraph {
        tables,
        relationships,
    })
}

#[tauri::command]
pub async fn get_schema_graph(
    connection_id: String,
    schema: Option<String>,
    state: State<'_, crate::AppState>,
) -> Result<SchemaGraph, String> {
    let schema = schema.unwrap_or_else(|| "public".to_string());
    validate_schema_name(&schema)?;

    let mut pm = state.pool_manager.lock().await;
    match pm.get(&connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let query = build_pg_schema_graph_query(&schema);
            let rows = client
                .query(&query, &[&schema])
                .await
                .map_err(|e| crate::commands::db_viewer::pg_error_message(&e))?;

            let json_rows: Vec<Vec<serde_json::Value>> = rows
                .iter()
                .map(|row| {
                    (0..row.len())
                        .map(|i| crate::commands::db_viewer::pg_value_to_json(row, i))
                        .collect()
                })
                .collect();

            let (tables, relationships) = parse_pg_schema_rows(&json_rows);
            Ok(SchemaGraph {
                tables,
                relationships,
            })
        }
        Some(DbHandle::Sqlite(conn)) => build_sqlite_schema_graph(conn, &schema),
        None => Err("Connection not found".into()),
    }
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
        assert!(
            sql.contains("$1"),
            "query should use $1 placeholder; got: {}",
            sql
        );
        // Must not interpolate schema name directly in a potentially unsafe way
        assert!(
            !sql.contains("'public'"),
            "query should not use literal 'public'"
        );
    }

    #[test]
    fn build_pg_schema_graph_query_queries_columns() {
        let sql = build_pg_schema_graph_query("myschema");
        assert!(sql.contains("pg_catalog.pg_class"), "should query pg_class");
        assert!(
            sql.contains("pg_catalog.pg_attribute"),
            "should query pg_attribute"
        );
        assert!(
            sql.contains("pg_catalog.pg_constraint"),
            "should include constraint info"
        );
    }

    #[test]
    fn infer_cardinality_one_to_one_pk() {
        assert_eq!(infer_cardinality(true, false, false, false), "1:1");
    }

    #[test]
    fn infer_cardinality_zero_or_one() {
        // UNIQUE + nullable → 0..1:0..1
        assert_eq!(infer_cardinality(false, true, true, false), "0..1:0..1");
    }

    #[test]
    fn infer_cardinality_one_to_many() {
        assert_eq!(infer_cardinality(false, false, false, false), "1:N");
    }

    #[test]
    fn infer_cardinality_zero_or_many() {
        // not PK, not UNIQUE, nullable → 0..N
        assert_eq!(infer_cardinality(false, false, true, false), "0..N");
    }

    #[test]
    fn infer_cardinality_many_to_many() {
        assert_eq!(infer_cardinality(false, false, false, true), "N:M");
    }

    #[test]
    fn parse_pg_schema_rows_builds_correct_graph() {
        let rows: Vec<Vec<serde_json::Value>> = vec![
            // users.id (PK)
            vec![
                serde_json::json!("users"),
                serde_json::json!("public"),
                serde_json::json!("BASE TABLE"),
                serde_json::json!("id"),
                serde_json::json!("integer"),
                serde_json::json!("NO"),
                serde_json::json!(1),
                serde_json::json!(true),
                serde_json::json!(false),
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::json!(true),
            ],
            // users.email (non-key)
            vec![
                serde_json::json!("users"),
                serde_json::json!("public"),
                serde_json::json!("BASE TABLE"),
                serde_json::json!("email"),
                serde_json::json!("text"),
                serde_json::json!("NO"),
                serde_json::json!(2),
                serde_json::json!(false),
                serde_json::json!(false),
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::json!(true),
            ],
            // orders.id (PK)
            vec![
                serde_json::json!("orders"),
                serde_json::json!("public"),
                serde_json::json!("BASE TABLE"),
                serde_json::json!("id"),
                serde_json::json!("integer"),
                serde_json::json!("NO"),
                serde_json::json!(1),
                serde_json::json!(true),
                serde_json::json!(false),
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::Value::Null,
                serde_json::json!(true),
            ],
            // orders.user_id (FK → users.id)
            vec![
                serde_json::json!("orders"),
                serde_json::json!("public"),
                serde_json::json!("BASE TABLE"),
                serde_json::json!("user_id"),
                serde_json::json!("integer"),
                serde_json::json!("NO"),
                serde_json::json!(2),
                serde_json::json!(false),
                serde_json::json!(true),
                serde_json::json!("public"),
                serde_json::json!("users"),
                serde_json::json!("id"),
                serde_json::json!(false),
            ],
        ];

        let (tables, relationships) = parse_pg_schema_rows(&rows);

        assert_eq!(tables.len(), 2, "should have 2 tables");
        assert_eq!(relationships.len(), 1, "should have 1 relationship");

        let users = tables.iter().find(|t| t.name == "users").unwrap();
        assert_eq!(users.columns.len(), 2);
        assert!(users.columns[0].is_pk);

        let orders = tables.iter().find(|t| t.name == "orders").unwrap();
        assert_eq!(orders.columns.len(), 2);

        let rel = &relationships[0];
        assert_eq!(rel.source_table, "orders");
        assert_eq!(rel.target_table, "users");
        assert_eq!(rel.source_column, "user_id");
        assert_eq!(rel.target_column, "id");
        assert_eq!(rel.cardinality, "1:N");
    }

    #[test]
    fn parse_pg_schema_rows_empty_yields_empty_graph() {
        let rows: Vec<Vec<serde_json::Value>> = vec![];
        let (tables, relationships) = parse_pg_schema_rows(&rows);
        assert!(tables.is_empty());
        assert!(relationships.is_empty());
    }
}
