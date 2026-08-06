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
             WHERE table_schema = '{}' \
             UNION ALL \
             SELECT matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type \
             FROM pg_matviews WHERE schemaname = '{}' \
             ORDER BY table_name",
            s, s
        ),
        None => {
            "SELECT table_name, table_type, table_schema FROM information_schema.tables \
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
             UNION ALL \
             SELECT matviewname AS table_name, 'MATERIALIZED VIEW' AS table_type, schemaname AS table_schema \
             FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog', 'information_schema') \
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
    CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS data_type,
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
// Object introspection (functions, triggers, sequences, enums, extensions)
// ---------------------------------------------------------------------------

/// Query functions and procedures in a schema.
pub fn pg_functions_query(_schema: &str) -> String {
    format!(
        "SELECT p.proname, n.nspname, \
         pg_catalog.format_type(p.prorettype, NULL) AS return_type, \
         ARRAY(SELECT unnest(p.proargtypes::regtype[]::text[])) AS arg_types, \
         ARRAY(SELECT unnest(p.proargnames::text[])) AS arg_names, \
         ARRAY(SELECT unnest(p.proargmodes::text[])) AS arg_modes, \
         l.lanname, pg_get_functiondef(p.oid) AS source, \
         p.prokind::text \
         FROM pg_proc p \
         JOIN pg_namespace n ON p.pronamespace = n.oid \
         JOIN pg_language l ON p.prolang = l.oid \
         WHERE n.nspname = $1 \
           AND p.prokind IN ('f', 'p') \
         ORDER BY p.proname"
    )
}

/// Query triggers in a schema.
pub fn pg_triggers_query(_schema: &str) -> String {
    format!(
        "SELECT t.tgname, tn.nspname AS trigger_schema, \
         cn.nspname AS table_schema, c.relname AS table_name, \
         CASE \
           WHEN t.tgtype::int2 & 4 = 4 THEN 'INSERT' \
           WHEN t.tgtype::int2 & 8 = 8 THEN 'DELETE' \
           WHEN t.tgtype::int2 & 16 = 16 THEN 'UPDATE' \
           WHEN t.tgtype::int2 & 32 = 32 THEN 'TRUNCATE' \
           ELSE 'UNKNOWN' END AS event, \
         CASE WHEN t.tgtype::int2 & 2 = 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing, \
         CASE WHEN t.tgtype::int2 & 1 = 1 THEN 'ROW' ELSE 'STATEMENT' END AS orientation, \
         pg_get_triggerdef(t.oid) AS definition, \
         t.tgenabled::text \
         FROM pg_trigger t \
         JOIN pg_class c ON t.tgrelid = c.oid \
         JOIN pg_namespace cn ON c.relnamespace = cn.oid \
         CROSS JOIN LATERAL (SELECT nspname FROM pg_namespace WHERE oid = (SELECT pronamespace FROM pg_proc WHERE oid = t.tgfoid)) tn \
         WHERE cn.nspname = $1 AND NOT t.tgisinternal \
         ORDER BY t.tgname"
    )
}

/// Query sequences in a schema via information_schema.
pub fn pg_sequences_query(schema: &str) -> String {
    format!(
        "SELECT sequence_name, '{}' AS schema, \
         COALESCE(start_value::text, '1'), \
         COALESCE(minimum_value::text, '1'), \
         COALESCE(maximum_value::text, '9223372036854775807'), \
         COALESCE(increment::text, '1'), \
         COALESCE(pg_catalog.pg_sequence_last_value(sequence_name::regclass)::text, '0'), \
         COALESCE(cycle_option::text, 'NO') \
         FROM information_schema.sequences \
         WHERE sequence_schema = $1 \
         ORDER BY sequence_name",
        schema
    )
}

/// Query enums in a schema.
pub fn pg_enums_query(_schema: &str) -> String {
    format!(
        "SELECT t.typname, n.nspname, \
         ARRAY(SELECT e.enumlabel FROM pg_enum e \
               WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder) AS labels \
         FROM pg_type t \
         JOIN pg_namespace n ON t.typnamespace = n.oid \
         WHERE t.typtype = 'e' AND n.nspname = $1 \
         ORDER BY t.typname"
    )
}

/// Query installed extensions.
pub fn pg_extensions_query() -> String {
    "SELECT e.extname, n.nspname, e.extversion::text, \
     pg_catalog.obj_description(e.oid, 'pg_extension') AS comment \
     FROM pg_extension e \
     JOIN pg_namespace n ON e.extnamespace = n.oid \
     ORDER BY e.extname"
        .to_string()
}

/// Query available (installable) extensions with default version + comment.
/// Schema-wide: `pg_available_extensions` is not schema-scoped.
pub fn pg_available_extensions_query() -> String {
    "SELECT name, default_version::text AS version, comment \
     FROM pg_available_extensions ORDER BY name"
        .to_string()
}

/// Query indexes in a schema.
///
/// Returns index name, schema, table, definition (`pg_get_indexdef`),
/// uniqueness, access method, columns CSV, size in bytes, and tablespace.
pub fn pg_indexes_query(_schema: &str) -> String {
    format!(
        "SELECT \
           i.relname AS index_name, \
           ns.nspname AS schema, \
           t.relname AS table_name, \
           pg_get_indexdef(ix.indexrelid) AS definition, \
           ix.indisunique AS is_unique, \
           am.amname AS method, \
           (SELECT string_agg(a.attname, ', ' ORDER BY ord.ord) \
            FROM unnest(ix.indkey) WITH ORDINALITY AS ord(attnum, ord) \
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ord.attnum) AS columns, \
           pg_relation_size(i.oid) AS size_bytes, \
           ts.spcname AS tablespace \
         FROM pg_index ix \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_class t ON t.oid = ix.indrelid \
         JOIN pg_namespace ns ON t.relnamespace = ns.oid \
         JOIN pg_am am ON i.relam = am.oid \
         LEFT JOIN pg_tablespace ts ON i.reltablespace = ts.oid \
         WHERE ns.nspname = $1 \
         ORDER BY i.relname"
    )
}

/// Query CHECK / UNIQUE / EXCLUSION constraints in a schema.
///
/// Primary and foreign keys are intentionally excluded — they surface in the
/// table grid. Returns name, schema, table, contype, definition
/// (`pg_get_constraintdef`), deferrability, validation, and columns CSV.
pub fn pg_constraints_query(_schema: &str) -> String {
    format!(
        "SELECT \
           c.conname AS name, \
           ns.nspname AS schema, \
           cl.relname AS table_name, \
           c.contype::text, \
           pg_get_constraintdef(c.oid) AS definition, \
           c.condeferrable, \
           c.convalidated, \
           (SELECT string_agg(a.attname, ', ' ORDER BY ord.ord) \
            FROM unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ord) \
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ord.attnum) AS columns \
         FROM pg_constraint c \
         JOIN pg_class cl ON c.conrelid = cl.oid \
         JOIN pg_namespace ns ON cl.relnamespace = ns.oid \
         WHERE ns.nspname = $1 AND c.contype IN ('c', 'u', 'x') \
         ORDER BY c.conname"
    )
}

// ---------------------------------------------------------------------------
// Roles, privileges, tablespaces, rebuild readiness
// ---------------------------------------------------------------------------

/// List non-system roles with all attributes used by the role form.
pub fn pg_roles_query() -> String {
    "SELECT rolname, rolsuper, rolinherit, rolcreatedb, rolcreaterole, rolcanlogin, \
     rolreplication, rolbypassrls, rolconnlimit::int8, COALESCE(rolvaliduntil::text, '') AS rolvaliduntil \
     FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname"
        .to_string()
}

/// All role-to-role memberships (member/admin/grantor).
pub fn pg_role_memberships_query() -> String {
    "SELECT roleid::regrole::text AS role, member::regrole::text AS member, \
     grantor::regrole::text AS grantor, admin_option \
     FROM pg_auth_members ORDER BY role"
        .to_string()
}

/// Table/view/matview privileges for a grantee, grouped one row per object.
pub fn pg_table_privileges_query(role: &str) -> String {
    format!(
        "SELECT table_schema AS schema, table_name AS name, \
         array_agg(privilege_type::text) AS privileges, \
         bool_or(is_grantable = 'YES') AS grantable \
         FROM information_schema.table_privileges \
         WHERE grantee = '{}' AND table_schema NOT IN ('pg_catalog','information_schema') \
         GROUP BY table_schema, table_name \
         ORDER BY table_schema, table_name",
        role
    )
}

/// Sequence privileges for a grantee, grouped one row per sequence.
/// aclexplode-based (role_sequence_grants was removed in PG 15).
pub fn pg_sequence_privileges_query(role: &str) -> String {
    format!(
        "SELECT n.nspname AS schema, c.relname AS name, \
         array_agg(p.privilege_type::text) AS privileges, \
         bool_or(p.is_grantable) AS grantable \
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, \
         LATERAL aclexplode(c.relacl) p \
         WHERE c.relkind = 'S' AND n.nspname NOT IN ('pg_catalog','information_schema') \
         AND p.grantee = (SELECT oid FROM pg_roles WHERE rolname = '{}') \
         GROUP BY n.nspname, c.relname \
         ORDER BY n.nspname, c.relname",
        role
    )
}

/// Routine (function/procedure) privileges for a grantee.
pub fn pg_routine_privileges_query(role: &str) -> String {
    format!(
        "SELECT routine_schema AS schema, routine_name AS name, \
         array_agg(privilege_type::text) AS privileges, \
         bool_or(is_grantable = 'YES') AS grantable \
         FROM information_schema.routine_privileges \
         WHERE grantee = '{}' \
         GROUP BY routine_schema, routine_name \
         ORDER BY routine_schema, routine_name",
        role
    )
}

/// Schema privileges for a grantee (USAGE/CREATE). aclexplode-based —
/// information_schema has no schema_privileges view.
pub fn pg_schema_privileges_query(role: &str) -> String {
    format!(
        "SELECT n.nspname AS name, \
         array_agg(p.privilege_type::text) AS privileges, \
         bool_or(p.is_grantable) AS grantable \
         FROM pg_namespace n, LATERAL aclexplode(n.nspacl) p \
         WHERE n.nspname NOT IN ('pg_catalog','information_schema') \
         AND p.grantee = (SELECT oid FROM pg_roles WHERE rolname = '{}') \
         GROUP BY n.nspname ORDER BY n.nspname",
        role
    )
}

/// Database privileges for a grantee via aclexplode (broadly compatible; avoids PG15-only view).
pub fn pg_database_privileges_query(role: &str) -> String {
    format!(
        "SELECT d.datname AS name, array_agg(a.privilege_type) AS privileges, \
         bool_or(a.is_grantable) AS grantable \
         FROM pg_database d, LATERAL aclexplode(d.datacl) a \
         WHERE a.grantee = (SELECT oid FROM pg_roles WHERE rolname = '{}') \
           AND d.datistemplate = false \
         GROUP BY d.datname \
         ORDER BY d.datname",
        role
    )
}

/// Non-system tablespaces for the table-options picker.
pub fn pg_tablespaces_query() -> String {
    "SELECT spcname FROM pg_tablespace WHERE spcname !~ '^pg_' ORDER BY spcname".to_string()
}

/// Single query returning boolean blockers for a table rebuild (triggers, policies,
/// inheritance, partitioning, generated/identity columns). Parameterized via $1/$2.
pub fn pg_rebuild_readiness_query() -> String {
    "SELECT \
       EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid \
            JOIN pg_namespace n ON c.relnamespace = n.oid \
            WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal) AS has_triggers, \
       EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON p.polrelid = c.oid \
            JOIN pg_namespace n ON c.relnamespace = n.oid \
            WHERE n.nspname = $1 AND c.relname = $2) AS has_policies, \
       EXISTS(SELECT 1 FROM pg_inherits i JOIN pg_class c ON i.inhrelid = c.oid \
            JOIN pg_namespace n ON c.relnamespace = n.oid \
            WHERE n.nspname = $1 AND c.relname = $2) AS is_inherits, \
       EXISTS(SELECT 1 FROM pg_partitioned_table pt JOIN pg_class c ON pt.partrelid = c.oid \
            JOIN pg_namespace n ON c.relnamespace = n.oid \
            WHERE n.nspname = $1 AND c.relname = $2) AS is_partitioned, \
       EXISTS(SELECT 1 FROM information_schema.columns \
            WHERE table_schema = $1 AND table_name = $2 AND is_generated <> '') AS has_generated"
        .to_string()
}

/// FKs owned by this table (contype='f'). Parameterized $1 schema, $2 table.
pub fn pg_table_fk_out_query() -> String {
    "SELECT c.conname, pg_get_constraintdef(c.oid) AS definition \
     FROM pg_constraint c JOIN pg_class cl ON c.conrelid = cl.oid \
     JOIN pg_namespace n ON cl.relnamespace = n.oid \
     WHERE n.nspname = $1 AND cl.relname = $2 AND c.contype = 'f'".to_string()
}

/// FKs from other tables referencing this table. Parameterized $1 schema, $2 table.
pub fn pg_table_fk_in_query() -> String {
    "SELECT c.conname, cn.nspname AS own_schema, cl.relname AS own_table, \
     pg_get_constraintdef(c.oid) AS definition \
     FROM pg_constraint c JOIN pg_class cl ON c.conrelid = cl.oid \
     JOIN pg_namespace cn ON cl.relnamespace = cn.oid \
     JOIN pg_class r ON c.confrelid = r.oid \
     JOIN pg_namespace rn ON r.relnamespace = rn.oid \
     WHERE rn.nspname = $1 AND r.relname = $2 AND c.contype = 'f'".to_string()
}

/// Grants on this table (all grantees), grouped. Parameterized $1 schema, $2 table.
pub fn pg_table_grants_query() -> String {
    "SELECT grantee, array_agg(privilege_type::text) AS privileges, \
     bool_or(is_grantable = 'YES') AS grantable \
     FROM information_schema.table_privileges \
     WHERE table_schema = $1 AND table_name = $2 AND grantee <> 'PUBLIC' \
     GROUP BY grantee".to_string()
}

/// Sequences owned by this table's columns (via pg_depend). Parameterized $1 schema, $2 table.
pub fn pg_table_owned_sequences_query() -> String {
    "SELECT sn.nspname AS seq_schema, s.relname AS seq_name, a.attname AS column \
     FROM pg_depend d JOIN pg_class s ON d.objid = s.oid \
     JOIN pg_namespace sn ON s.relnamespace = sn.oid \
     JOIN pg_class t ON d.refobjid = t.oid \
     JOIN pg_namespace tn ON t.relnamespace = tn.oid \
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid \
     WHERE tn.nspname = $1 AND t.relname = $2 AND d.classid = 'pg_class'::regclass AND s.relkind = 'S'".to_string()
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

    #[test]
    fn pg_indexes_query_is_parameterized_and_joins() {
        let sql = pg_indexes_query("public");
        assert!(
            sql.contains("$1"),
            "schema must be parameterized; got: {}",
            sql
        );
        assert!(
            sql.contains("pg_indexes") || sql.contains("pg_index"),
            "should query pg_index; got: {}",
            sql
        );
        assert!(
            sql.contains("pg_get_indexdef"),
            "should include index definition"
        );
        assert!(sql.contains("indisunique"), "should include uniqueness");
    }

    #[test]
    fn pg_constraints_query_filters_check_unique_exclusion() {
        let sql = pg_constraints_query("public");
        assert!(
            sql.contains("$1"),
            "schema must be parameterized; got: {}",
            sql
        );
        assert!(
            sql.contains("pg_constraint"),
            "should query pg_constraint; got: {}",
            sql
        );
        assert!(sql.contains("contype"), "should select contype");
        assert!(sql.contains("'c'"), "should filter CHECK ('c')");
        assert!(sql.contains("'u'"), "should filter UNIQUE ('u')");
        assert!(sql.contains("'x'"), "should filter EXCLUSION ('x')");
        assert!(
            sql.contains("pg_get_constraintdef"),
            "should include definition"
        );
    }

    #[test]
    fn pg_tables_query_includes_materialized_views() {
        let sql = pg_tables_query(Some("public"));
        assert!(
            sql.contains("pg_matviews"),
            "matview UNION must source pg_matviews; got: {}",
            sql,
        );
        assert!(
            sql.contains("MATERIALIZED VIEW"),
            "should label materialized views"
        );
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

    // ---------------------------------------------------------------
    // Object introspection
    // ---------------------------------------------------------------

    #[test]
    fn pg_functions_query_has_expected_columns() {
        let sql = pg_functions_query("public");
        assert!(sql.contains("pg_proc"));
        assert!(sql.contains("proname"));
    }

    #[test]
    fn pg_triggers_query_has_expected_columns() {
        let sql = pg_triggers_query("public");
        assert!(sql.contains("pg_trigger"));
        assert!(sql.contains("tgname"));
    }

    #[test]
    fn pg_sequences_query_filters_by_schema() {
        let sql = pg_sequences_query("myschema");
        assert!(sql.contains("myschema"));
    }

    #[test]
    fn pg_enums_query_has_typtype_e() {
        let sql = pg_enums_query("public");
        assert!(sql.contains("typtype = 'e'"));
    }

    #[test]
    fn pg_extensions_query_selects_from_pg_extension() {
        let sql = pg_extensions_query();
        assert!(sql.contains("pg_extension"));
    }

    #[test]
    fn pg_available_extensions_query_has_name_default_version_comment() {
        let sql = pg_available_extensions_query();
        assert!(sql.contains("pg_available_extensions"));
        assert!(sql.contains("default_version"), "should select default version; got: {sql}");
        assert!(sql.contains("comment"), "should select comment; got: {sql}");
        assert!(sql.contains("ORDER BY name"), "should order by name; got: {sql}");
    }

    // ---------------------------------------------------------------
    // Roles, privileges, tablespaces, rebuild readiness
    // ---------------------------------------------------------------

    #[test]
    fn pg_roles_query_filters_pg_prefix() {
        let sql = pg_roles_query();
        assert!(sql.contains("pg_roles"));
        assert!(sql.contains("rolname !~ '^pg_'"));
        assert!(sql.contains("rolcanlogin"));
        assert!(sql.contains("rolconnlimit::int8"));
    }

    #[test]
    fn pg_role_memberships_query_uses_pg_auth_members() {
        let sql = pg_role_memberships_query();
        assert!(sql.contains("pg_auth_members"));
        assert!(sql.contains("admin_option"));
    }

    #[test]
    fn pg_table_privileges_query_filters_grantee_and_aggregates() {
        let sql = pg_table_privileges_query("appuser");
        assert!(sql.contains("information_schema.table_privileges"));
        assert!(sql.contains("grantee = 'appuser'"));
        assert!(sql.contains("array_agg"));
        assert!(sql.contains("GROUP BY"));
    }

    #[test]
    fn pg_database_privileges_query_uses_aclexplode() {
        let sql = pg_database_privileges_query("appuser");
        assert!(sql.contains("aclexplode"));
        assert!(sql.contains("pg_database"));
        assert!(sql.contains("appuser"));
    }

    #[test]
    fn pg_rebuild_readiness_query_checks_blockers() {
        let sql = pg_rebuild_readiness_query();
        assert!(sql.contains("pg_trigger"));
        assert!(sql.contains("pg_policy"));
        assert!(sql.contains("pg_inherits"));
        assert!(sql.contains("pg_partitioned_table"));
        assert!(sql.contains("is_generated"));
    }

    #[test]
    fn pg_tablespaces_query_filters_pg_prefix() {
        let sql = pg_tablespaces_query();
        assert!(sql.contains("pg_tablespace"));
        assert!(sql.contains("spcname !~ '^pg_'"));
    }

    #[test]
    fn pg_table_fk_out_query_uses_pg_constraint_f() {
        let sql = pg_table_fk_out_query();
        assert!(sql.contains("pg_constraint"));
        assert!(sql.contains("contype = 'f'"));
        assert!(sql.contains("$1") && sql.contains("$2"));
    }

    #[test]
    fn pg_table_fk_in_query_finds_referencing_tables() {
        let sql = pg_table_fk_in_query();
        assert!(sql.contains("pg_constraint"));
        assert!(sql.contains("confrel"));
        assert!(sql.contains("$1") && sql.contains("$2"));
    }

    #[test]
    fn pg_table_grants_query_uses_table_privileges() {
        let sql = pg_table_grants_query();
        assert!(sql.contains("information_schema.table_privileges"));
        assert!(sql.contains("$1") && sql.contains("$2"));
        assert!(sql.contains("array_agg"));
    }

    #[test]
    fn pg_table_owned_sequences_query_uses_pg_depend() {
        let sql = pg_table_owned_sequences_query();
        assert!(sql.contains("pg_depend"));
        assert!(sql.contains("pg_class"));
        assert!(sql.contains("$1") && sql.contains("$2"));
    }
}
