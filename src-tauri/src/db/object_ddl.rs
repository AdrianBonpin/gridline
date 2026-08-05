//! Pure builders for schema DDL, cross-object search, pg_depend lookups,
//! and synthesized object DDL. No DB I/O — deterministic string builders.
use crate::models::db_viewer::{SequenceInfo, EnumInfo, ExtensionInfo, ConstraintInfo};

/// Double-quote an identifier, doubling embedded quotes.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Reject empty / SQL-injection-prone names (mirrors schema_graph::validate_schema_name).
pub fn validate_object_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Name must not be empty".into());
    }
    for bad in [";", "--", "/*", "'", "\"", "\\"] {
        if name.contains(bad) {
            return Err(format!("Name contains forbidden character(s): {bad}"));
        }
    }
    Ok(())
}

pub fn create_schema_sql(name: &str) -> Result<String, String> {
    validate_object_name(name)?;
    Ok(format!("CREATE SCHEMA {}", quote_ident(name)))
}
pub fn rename_schema_sql(old: &str, new: &str) -> Result<String, String> {
    validate_object_name(old)?;
    validate_object_name(new)?;
    Ok(format!("ALTER SCHEMA {} RENAME TO {}", quote_ident(old), quote_ident(new)))
}
pub fn drop_schema_sql(name: &str, cascade: bool) -> Result<String, String> {
    validate_object_name(name)?;
    Ok(format!("DROP SCHEMA {}{}", quote_ident(name), if cascade { " CASCADE" } else { "" }))
}

/// UNION ALL of every browsable object type in `$2` (schema), substring-matching `$1` (needle)
/// via position() — case-insensitive, no wildcard-escaping pitfalls. LIMIT 100.
pub fn pg_object_search_query() -> String {
    "SELECT name, schema, type FROM (
      SELECT table_name AS name, table_schema AS schema, CASE WHEN table_type = 'VIEW' THEN 'VIEW' ELSE 'TABLE' END AS type FROM information_schema.tables WHERE table_schema=$2 AND position(lower($1) in lower(table_name))>0
      UNION ALL
      SELECT matviewname, schemaname, 'MATERIALIZED VIEW' FROM pg_matviews WHERE schemaname=$2 AND position(lower($1) in lower(matviewname))>0
      UNION ALL
      SELECT p.proname, n.nspname, CASE p.prokind WHEN 'f' THEN 'FUNCTION' WHEN 'p' THEN 'PROCEDURE' END FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname=$2 AND position(lower($1) in lower(p.proname))>0
      UNION ALL
      SELECT t.tgname, cn.nspname, 'TRIGGER' FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace cn ON c.relnamespace=cn.oid WHERE cn.nspname=$2 AND NOT t.tgisinternal AND position(lower($1) in lower(t.tgname))>0
      UNION ALL
      SELECT sequence_name, sequence_schema, 'SEQUENCE' FROM information_schema.sequences WHERE sequence_schema=$2 AND position(lower($1) in lower(sequence_name))>0
      UNION ALL
      SELECT t.typname, n.nspname, 'ENUM' FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid WHERE t.typtype='e' AND n.nspname=$2 AND position(lower($1) in lower(t.typname))>0
      UNION ALL
      SELECT e.extname, n.nspname, 'EXTENSION' FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid WHERE n.nspname=$2 AND position(lower($1) in lower(e.extname))>0
      UNION ALL
      SELECT i.relname, ns.nspname, 'INDEX' FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace ns ON t.relnamespace=ns.oid WHERE ns.nspname=$2 AND position(lower($1) in lower(i.relname))>0
      UNION ALL
      SELECT c.conname, ns.nspname, 'CONSTRAINT' FROM pg_constraint c JOIN pg_class cl ON c.conrelid=cl.oid JOIN pg_namespace ns ON cl.relnamespace=ns.oid WHERE ns.nspname=$2 AND c.contype IN ('c','u','x') AND position(lower($1) in lower(c.conname))>0
    ) AS hits ORDER BY type, name LIMIT 100".to_string()
}

/// Resolve a single object oid by type. $1=name, $2=schema. (Overloads: first match — see spec open questions.)
pub fn pg_object_oid_query(object_type: &str) -> String {
    match object_type {
        "table" | "view" | "materialized view" | "sequence" | "index" =>
            "SELECT c.oid FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relname=$1 AND n.nspname=$2 LIMIT 1".to_string(),
        "function" | "procedure" =>
            "SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.proname=$1 AND n.nspname=$2 LIMIT 1".to_string(),
        "trigger" =>
            "SELECT t.oid FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE t.tgname=$1 AND n.nspname=$2 AND NOT t.tgisinternal LIMIT 1".to_string(),
        "enum" =>
            "SELECT t.oid FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid WHERE t.typname=$1 AND n.nspname=$2 AND t.typtype='e' LIMIT 1".to_string(),
        "extension" =>
            "SELECT e.oid FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid WHERE e.extname=$1 AND n.nspname=$2 LIMIT 1".to_string(),
        "constraint" =>
            "SELECT c.oid FROM pg_constraint c JOIN pg_class cl ON c.conrelid=cl.oid JOIN pg_namespace n ON cl.relnamespace=n.oid WHERE c.conname=$1 AND n.nspname=$2 LIMIT 1".to_string(),
        _ => String::new(),
    }
}

/// Objects that depend on `$1` (the target oid). Excludes internal/pinned deps; resolves readable name per classid.
pub fn pg_depend_query() -> String {
    "SELECT d.deptype::text AS deptype, d.classid::regclass::text AS class,
      CASE
        WHEN d.classid='pg_class'::regclass THEN (SELECT relname FROM pg_class WHERE oid=d.objid)
        WHEN d.classid='pg_proc'::regclass THEN (SELECT proname FROM pg_proc WHERE oid=d.objid)
        WHEN d.classid='pg_trigger'::regclass THEN (SELECT tgname FROM pg_trigger WHERE oid=d.objid)
        WHEN d.classid='pg_type'::regclass THEN (SELECT typname FROM pg_type WHERE oid=d.objid)
        WHEN d.classid='pg_constraint'::regclass THEN (SELECT conname FROM pg_constraint WHERE oid=d.objid)
        WHEN d.classid='pg_rewrite'::regclass THEN (SELECT ev_class::regclass::text FROM pg_rewrite WHERE oid=d.objid)
        ELSE ''
      END AS name
    FROM pg_depend d
    WHERE d.refobjid = $1 AND d.deptype IN ('n', 'a')
    ORDER BY d.deptype, name".to_string()
}

/// Objects contained in a schema (for the schema-drop dependency warning). $1=schema.
pub fn pg_schema_contents_query() -> String {
    "SELECT c.relname, c.relkind::text FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname=$1 AND c.relkind IN ('r','v','m','S','i','c') ORDER BY c.relkind, c.relname".to_string()
}

// --- Synthesized DDL ---
pub fn sequence_ddl(s: &SequenceInfo) -> String {
    format!("CREATE SEQUENCE {}.{}\n  INCREMENT BY {}\n  MINVALUE {}\n  MAXVALUE {}\n  START WITH {}\n  {}",
        quote_ident(&s.schema), quote_ident(&s.name), s.increment, s.min_value, s.max_value, s.start_value,
        if s.cycle { "CYCLE" } else { "NO CYCLE" })
}
pub fn enum_ddl(e: &EnumInfo) -> String {
    let labels: Vec<String> = e.labels.iter().map(|l| format!("'{}'", l.replace('\'', "''"))).collect();
    format!("CREATE TYPE {}.{} AS ENUM ({});", quote_ident(&e.schema), quote_ident(&e.name), labels.join(", "))
}
pub fn extension_ddl(x: &ExtensionInfo) -> String {
    format!("CREATE EXTENSION IF NOT EXISTS {} WITH SCHEMA {} VERSION '{}';", quote_ident(&x.name), quote_ident(&x.schema), x.version.replace('\'', "''"))
}
pub fn view_ddl(schema: &str, name: &str, selectdef: &str) -> String {
    format!("CREATE OR REPLACE VIEW {}.{} AS\n{}", quote_ident(schema), quote_ident(name), selectdef)
}
pub fn matview_ddl(schema: &str, name: &str, selectdef: &str) -> String {
    format!("CREATE MATERIALIZED VIEW {}.{} AS\n{}", quote_ident(schema), quote_ident(name), selectdef)
}
pub fn constraint_ddl(c: &ConstraintInfo) -> String {
    format!("ALTER TABLE {}.{} ADD CONSTRAINT {} {}",
        quote_ident(&c.schema), quote_ident(&c.table), quote_ident(&c.name), c.definition)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_ident_doubles_embedded_quotes() {
        assert_eq!(quote_ident("public"), "\"public\"");
        assert_eq!(quote_ident("a\"b"), "\"a\"\"b\"");
    }

    #[test]
    fn validate_object_name_rejects_dangerous_chars() {
        assert!(validate_object_name("public").is_ok());
        assert!(validate_object_name("").is_err());
        assert!(validate_object_name("a; DROP").is_err());
        assert!(validate_object_name("a--b").is_err());
        assert!(validate_object_name("a'b").is_err());
        assert!(validate_object_name("a\"b").is_err());
        assert!(validate_object_name("a\\b").is_err());
        assert!(validate_object_name("/*x*/").is_err());
    }

    #[test]
    fn create_schema_sql_quotes_name() {
        assert_eq!(create_schema_sql("my_schema").unwrap(), "CREATE SCHEMA \"my_schema\"");
        assert!(create_schema_sql("bad; name").is_err());
    }

    #[test]
    fn rename_schema_sql_quotes_both() {
        assert_eq!(
        rename_schema_sql("old", "new").unwrap(),
        "ALTER SCHEMA \"old\" RENAME TO \"new\""
        );
    }

    #[test]
    fn drop_schema_sql_cascade_flag() {
        assert_eq!(drop_schema_sql("s", false).unwrap(), "DROP SCHEMA \"s\"");
        assert_eq!(drop_schema_sql("s", true).unwrap(), "DROP SCHEMA \"s\" CASCADE");
    }

    #[test]
    fn object_search_query_unions_types_and_uses_position_match() {
        let sql = pg_object_search_query();
        assert!(sql.contains("position(lower($1) in lower("), "case-insensitive substring, no wildcard escaping: {sql}");
        assert!(sql.contains("$2"), "schema is $2");
        // covers every browsable type
        for t in ["'TABLE'", "'VIEW'", "'MATERIALIZED VIEW'", "'FUNCTION'", "'PROCEDURE'", "'TRIGGER'", "'SEQUENCE'", "'ENUM'", "'EXTENSION'", "'INDEX'", "'CONSTRAINT'"] {
            assert!(sql.contains(t), "search must cover {t}");
        }
        assert!(sql.contains("LIMIT 100"));
    }

    #[test]
    fn object_oid_query_branches_per_type() {
        assert!(pg_object_oid_query("table").contains("pg_class"));
        assert!(pg_object_oid_query("function").contains("pg_proc"));
        assert!(pg_object_oid_query("trigger").contains("pg_trigger"));
        assert!(pg_object_oid_query("enum").contains("pg_type"));
        assert!(pg_object_oid_query("extension").contains("pg_extension"));
        assert!(pg_object_oid_query("constraint").contains("pg_constraint"));
    }

    #[test]
    fn depend_query_filters_internal_and_resolves_names() {
        let sql = pg_depend_query();
        assert!(sql.contains("refobjid = $1"));
        assert!(sql.contains("deptype IN ('n', 'a')"), "exclude internal 'i' / pinned 'p'");
        assert!(sql.contains("pg_proc'::regclass"));
        assert!(sql.contains("pg_trigger'::regclass"));
        assert!(sql.contains("pg_constraint'::regclass"));
    }

    #[test]
    fn sequence_ddl_is_synthesized() {
        let s = SequenceInfo { name: "users_id_seq".into(), schema: "public".into(),
            start_value: "1".into(), min_value: "1".into(), max_value: "9".into(),
            increment: "1".into(), current_value: "5".into(), cycle: false };
        let ddl = sequence_ddl(&s);
        assert!(ddl.starts_with("CREATE SEQUENCE \"public\".\"users_id_seq\""));
        assert!(ddl.contains("INCREMENT BY 1"));
        assert!(ddl.contains("NO CYCLE"));
    }

    #[test]
    fn enum_ddl_lists_labels_quoted() {
        let e = EnumInfo { name: "role".into(), schema: "public".into(), labels: vec!["admin".into(), "user's".into()] };
        let ddl = enum_ddl(&e);
        assert!(ddl.starts_with("CREATE TYPE \"public\".\"role\" AS ENUM ("));
        assert!(ddl.contains("'admin'"));
        assert!(ddl.contains("'user''s'"), "single quotes doubled");
    }

    #[test]
    fn extension_ddl_is_synthesized() {
        let x = ExtensionInfo { name: "pgcrypto".into(), schema: "public".into(), version: "1.3".into(), comment: None };
        let ddl = extension_ddl(&x);
        assert!(ddl.contains("CREATE EXTENSION IF NOT EXISTS \"pgcrypto\""));
        assert!(ddl.contains("WITH SCHEMA \"public\""));
        assert!(ddl.contains("VERSION '1.3'"));
    }

    #[test]
    fn view_ddl_wraps_selectdef() {
        assert_eq!(view_ddl("public", "v_users", "SELECT * FROM users"),
            "CREATE OR REPLACE VIEW \"public\".\"v_users\" AS\nSELECT * FROM users");
    }

    #[test]
    fn constraint_ddl_wraps_definition() {
        let c = ConstraintInfo { name: "ck_pos".into(), schema: "public".into(), table: "orders".into(),
            contype: "CHECK".into(), definition: "CHECK (amount > 0)".into(), deferrable: false, validated: true, columns: vec!["amount".into()] };
        let ddl = constraint_ddl(&c);
        assert_eq!(ddl, "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"ck_pos\" CHECK (amount > 0)");
    }
}