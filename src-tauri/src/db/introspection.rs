//! Schema introspection query builders.
//!
//! This module provides pure functions that generate SQL query strings
//! for database schema introspection. No actual DB connections are needed
//! for testing — all functions are deterministic string builders.

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

/// Approximate row count for a table via `pg_class.reltuples`.
pub fn pg_reltuples_query(schema: &str, table: &str) -> String {
    format!(
        "SELECT reltuples::bigint AS count FROM pg_class \
         WHERE relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = '{}') \
         AND relname = '{}'",
        schema, table
    )
}

/// List tables and views in a schema (or all non-system schemata).
///
/// When `schema` is `None` all schemata except the built-in system schemata
/// (`pg_catalog`, `information_schema`) are included.
pub fn pg_tables_query(schema: Option<&str>) -> String {
    match schema {
        Some(s) => format!(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = '{}' ORDER BY table_name",
            s
        ),
        None => {
            "SELECT table_name, table_type, table_schema FROM information_schema.tables \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
             ORDER BY table_schema, table_name"
                .to_string()
        }
    }
}

/// List all non-system schemata.
pub fn pg_schemas_query() -> String {
    "SELECT schema_name FROM information_schema.schemata \
     WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
     ORDER BY schema_name"
        .to_string()
}

/// List non-template databases.
pub fn pg_databases_query() -> String {
    "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname".to_string()
}

/// Column details with primary-key and foreign-key annotations.
///
/// Joins `information_schema.columns` with constraint metadata so that
/// each row includes PK / FK information when applicable.
pub fn pg_columns_query(schema: &str, table: &str) -> String {
    format!(
        r#"SELECT
    c.column_name,
    c.data_type,
    c.is_nullable,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    c.column_default,
    c.ordinal_position,
    pk.constraint_type,
    fk.foreign_table_schema,
    fk.foreign_table_name,
    fk.foreign_column_name
FROM information_schema.columns c
LEFT JOIN (
    SELECT kcu.column_name, kcu.table_schema, kcu.table_name, 'PRIMARY KEY' AS constraint_type
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_catalog = kcu.constraint_catalog
        AND tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON c.table_schema = pk.table_schema AND c.table_name = pk.table_name AND c.column_name = pk.column_name
LEFT JOIN (
    SELECT
        kcu.column_name,
        kcu.table_schema,
        kcu.table_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_catalog = kcu.constraint_catalog
        AND tc.constraint_schema = kcu.constraint_schema
        AND tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_catalog = ccu.constraint_catalog
        AND tc.constraint_schema = ccu.constraint_schema
        AND tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
) fk ON c.table_schema = fk.table_schema AND c.table_name = fk.table_name AND c.column_name = fk.column_name
WHERE c.table_schema = '{}' AND c.table_name = '{}'
ORDER BY c.ordinal_position"#,
        schema, table
    )
}

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

/// List tables (and views) in the given schema.
///
/// When `schema` is `None` all non-system schemata are included (excluding
/// `information_schema`, `performance_schema`, `mysql`, and `sys`).
pub fn mysql_tables_query(schema: Option<&str>) -> String {
    match schema {
        Some(s) => format!(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = '{}' ORDER BY table_name",
            s
        ),
        None => {
            "SELECT table_name, table_type, table_schema FROM information_schema.tables \
             WHERE table_schema NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
             ORDER BY table_schema, table_name"
                .to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

/// List tables and views from `sqlite_master`.
pub fn sqlite_tables_query() -> String {
    "SELECT name AS table_name, type AS table_type FROM sqlite_master \
     WHERE type IN ('table', 'view') ORDER BY name"
        .to_string()
}

/// Column metadata via `PRAGMA table_info`.
pub fn sqlite_columns_query(table: &str) -> String {
    format!("PRAGMA table_info('{}')", table)
}

/// Foreign-key metadata via `PRAGMA foreign_key_list`.
pub fn sqlite_foreign_keys_query(table: &str) -> String {
    format!("PRAGMA foreign_key_list('{}')", table)
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/// Build a paginated `SELECT` query.
///
/// Returns the SQL string (with `$1` / `$2` placeholders for `LIMIT` and
/// `OFFSET`) together with a vector of the corresponding `i64` parameter
/// values `[page_size, page * page_size]`.
///
/// When `columns` is empty the query uses `*`.
pub fn build_select_query(
    schema: &str,
    table: &str,
    columns: &[String],
    page: i64,
    page_size: i64,
) -> (String, Vec<i64>) {
    let cols = if columns.is_empty() {
        "*".to_string()
    } else {
        let mut buf = String::new();
        for (i, col) in columns.iter().enumerate() {
            if i > 0 {
                buf.push_str(", ");
            }
            buf.push('"');
            buf.push_str(col);
            buf.push('"');
        }
        buf
    };

    let sql = format!(
        "SELECT {} FROM \"{}\".\"{}\" LIMIT $1 OFFSET $2",
        cols, schema, table
    );

    let params = vec![page_size, page * page_size];

    (sql, params)
}

/// Build a `COUNT(*)` query.
pub fn build_count_query(schema: &str, table: &str) -> String {
    format!("SELECT COUNT(*) FROM \"{}\".\"{}\"", schema, table)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---------------------------------------------------------------
    // PostgreSQL
    // ---------------------------------------------------------------

    #[test]
    fn pg_count_approximation_query_is_valid() {
        let sql = pg_reltuples_query("public", "users");
        assert!(
            sql.contains("pg_class"),
            "should query pg_class for row estimates; got: {}",
            sql
        );
        assert!(sql.contains("public"), "should contain schema name");
        assert!(sql.contains("users"), "should contain table name");
    }

    #[test]
    fn pg_table_list_query_is_valid() {
        let sql = pg_tables_query(Some("public"));
        assert!(
            sql.contains("information_schema.tables"),
            "should query information_schema.tables; got: {}",
            sql
        );
        assert!(sql.contains("public"), "should contain the given schema");

        // Without schema filter — should exclude system schemata
        let all_sql = pg_tables_query(None);
        assert!(
            all_sql.contains("information_schema.tables"),
            "should query information_schema.tables"
        );
        assert!(
            all_sql.contains("pg_catalog"),
            "should exclude pg_catalog via NOT IN"
        );
    }

    #[test]
    fn pg_column_query_is_valid() {
        let sql = pg_columns_query("public", "orders");
        assert!(
            sql.contains("information_schema.columns"),
            "should query information_schema.columns; got: {}",
            sql
        );
        assert!(sql.contains("public"), "should contain schema name");
        assert!(sql.contains("orders"), "should contain table name");
        assert!(
            sql.contains("FOREIGN KEY"),
            "should include FK constraint metadata"
        );
        assert!(
            sql.contains("PRIMARY KEY"),
            "should include PK constraint metadata"
        );
    }

    #[test]
    fn pg_schemas_query_is_valid() {
        let sql = pg_schemas_query();
        assert!(sql.contains("information_schema.schemata"));
        assert!(sql.contains("pg_catalog"));
    }

    #[test]
    fn pg_databases_query_is_valid() {
        let sql = pg_databases_query();
        assert!(sql.contains("pg_database"));
        assert!(sql.contains("datistemplate"));
    }

    // ---------------------------------------------------------------
    // MySQL
    // ---------------------------------------------------------------

    #[test]
    fn mysql_table_list_query_is_valid() {
        let sql = mysql_tables_query(Some("mydb"));
        assert!(
            sql.contains("information_schema.tables"),
            "should query information_schema.tables; got: {}",
            sql
        );
        assert!(sql.contains("mydb"), "should contain the given schema");

        let all_sql = mysql_tables_query(None);
        assert!(all_sql.contains("information_schema.tables"));
        assert!(all_sql.contains("performance_schema"));
    }

    // ---------------------------------------------------------------
    // SQLite
    // ---------------------------------------------------------------

    #[test]
    fn sqlite_table_list_query_is_valid() {
        let sql = sqlite_tables_query();
        assert!(
            sql.contains("sqlite_master"),
            "should query sqlite_master; got: {}",
            sql
        );
    }

    #[test]
    fn sqlite_columns_query_is_valid() {
        let sql = sqlite_columns_query("users");
        assert!(
            sql.contains("PRAGMA table_info"),
            "should use PRAGMA table_info; got: {}",
            sql
        );
        assert!(sql.contains("users"), "should contain table name");
    }

    #[test]
    fn sqlite_foreign_keys_query_is_valid() {
        let sql = sqlite_foreign_keys_query("orders");
        assert!(
            sql.contains("PRAGMA foreign_key_list"),
            "should use PRAGMA foreign_key_list; got: {}",
            sql
        );
        assert!(sql.contains("orders"), "should contain table name");
    }

    // ---------------------------------------------------------------
    // Generic helpers
    // ---------------------------------------------------------------

    #[test]
    fn build_paginated_query_with_limits() {
        let columns = vec!["id".to_string(), "name".to_string()];
        let (sql, params) = build_select_query("public", "users", &columns, 2, 25);

        assert!(
            sql.contains("LIMIT"),
            "should contain LIMIT clause; got: {}",
            sql
        );
        assert!(
            sql.contains("OFFSET"),
            "should contain OFFSET clause; got: {}",
            sql
        );
        assert!(sql.contains("public"), "should contain schema name");
        assert!(sql.contains("users"), "should contain table name");
        assert!(sql.contains("\"id\""), "should quote column names");
        assert!(sql.contains("\"name\""), "should quote column names");

        // page=2, page_size=25 => offset = 50
        assert_eq!(params, vec![25, 50], "params should be [page_size, offset]");
    }

    #[test]
    fn build_paginated_query_empty_columns_uses_star() {
        let (sql, _) = build_select_query("public", "users", &[], 0, 10);
        assert!(
            sql.contains('*'),
            "empty columns should produce SELECT *; got: {}",
            sql
        );
    }

    #[test]
    fn build_count_query_is_valid() {
        let sql = build_count_query("public", "orders");
        assert!(
            sql.contains("COUNT(*)"),
            "should contain COUNT(*); got: {}",
            sql
        );
        assert!(sql.contains("public"), "should contain schema name");
        assert!(sql.contains("orders"), "should contain table name");
    }
}