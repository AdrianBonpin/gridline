//! Ticket 12 — foreign-key target resolution and option search.
//!
//! The bug these builders exist to remove: a foreign key that points into
//! another schema used to be followed with the *current* schema substituted, so
//! a same-named table silently answered with the wrong row; and the option
//! dropdown searched only the first small page of the referenced table.

use super::*;

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/// The referenced schema comes from the catalog. A same-named table in the
/// source schema must never win.
#[test]
fn target_from_catalog_keeps_the_referenced_schema() {
    let target = target_from_catalog("public", Some("reporting"), "users", "id")
        .expect("catalog metadata is representable");
    assert_eq!(target.schema, "reporting");
    assert_eq!(target.table, "users");
    assert_eq!(target.column, "id");
    assert_eq!(target.relation(), "reporting.users");
}

/// Only when the catalog reports no schema at all does the source schema apply
/// (SQLite has no schemas; older PG metadata may omit it).
#[test]
fn target_from_catalog_falls_back_to_the_source_schema_only_when_absent() {
    let target =
        target_from_catalog("public", None, "users", "id").expect("source schema is a fallback");
    assert_eq!(target.schema, "public");
    assert_eq!(target.relation(), "public.users");

    let blank =
        target_from_catalog("public", Some(""), "users", "id").expect("blank schema is a fallback");
    assert_eq!(blank.schema, "public");
}

/// An unrepresentable referenced name fails closed instead of resolving to
/// something else.
#[test]
fn target_from_catalog_rejects_unrepresentable_names() {
    let err = target_from_catalog("public", Some("reporting"), "users", "")
        .expect_err("empty referenced column cannot be represented");
    assert!(err.contains("column"), "error must name the part: {err}");
}

// ---------------------------------------------------------------------------
// Preview lookup
// ---------------------------------------------------------------------------

/// The preview statement addresses `schema.table` from the target — the source
/// schema appearing nowhere is what proves a same-named local table is not
/// substituted.
#[test]
fn preview_sql_qualifies_the_referenced_relation() {
    let target = target_from_catalog("public", Some("reporting"), "users", "id").unwrap();

    let pg = preview_sql(Engine::PostgreSql, &target).unwrap();
    assert!(
        pg.contains("\"reporting\".\"users\""),
        "PG preview must address the referenced schema: {pg}"
    );
    assert!(
        !pg.contains("\"public\""),
        "PG preview must never name the source schema: {pg}"
    );
    assert!(pg.contains("WHERE \"id\"::text = $1"), "{pg}");
    assert!(pg.trim_end().ends_with("LIMIT 1"), "{pg}");

    let sqlite = preview_sql(Engine::Sqlite, &target).unwrap();
    assert!(sqlite.contains("\"reporting\".\"users\""), "{sqlite}");
    assert!(sqlite.contains("CAST(\"id\" AS TEXT) = ?"), "{sqlite}");
    assert!(sqlite.trim_end().ends_with("LIMIT 1"), "{sqlite}");

    let mysql = preview_sql(Engine::MySql, &target).unwrap();
    assert!(mysql.contains("`reporting`.`users`"), "{mysql}");
    assert!(mysql.contains("CAST(`id` AS CHAR) = ?"), "{mysql}");
    assert!(mysql.trim_end().ends_with("LIMIT 1"), "{mysql}");
}

/// Legal-but-awkward names are quoted, never rewritten.
#[test]
fn preview_sql_quotes_awkward_identifiers() {
    let target = FkTarget::new("we ird \"s\"", "a\"b", "o'brien");
    let pg = preview_sql(Engine::PostgreSql, &target).unwrap();
    assert!(
        pg.contains("\"we ird \"\"s\"\"\".\"a\"\"b\""),
        "embedded quotes must be doubled, not dropped: {pg}"
    );
    assert!(pg.contains("\"o'brien\"::text = $1"), "{pg}");
}

// ---------------------------------------------------------------------------
// Option search
// ---------------------------------------------------------------------------

/// The predicate is a bound case-insensitive substring match, so a search term
/// can never become SQL (or a LIKE wildcard).
#[test]
fn search_sql_matches_the_key_column_and_text_columns() {
    let target = FkTarget::new("reporting", "users", "id");
    let columns = search_columns(
        &target,
        &[
            ("id".into(), "integer".into()),
            ("name".into(), "text".into()),
            ("created_at".into(), "timestamp without time zone".into()),
        ],
    );
    assert_eq!(columns, vec!["id".to_string(), "name".to_string()]);

    let sql = search_sql(Engine::PostgreSql, &target, &columns, 25, 0).unwrap();
    assert!(sql.rows.contains("\"reporting\".\"users\""), "{}", sql.rows);
    assert!(
        sql.rows
            .contains("strpos(lower(CAST(\"id\" AS TEXT)), lower($1)) > 0"),
        "the referenced key column must be searchable: {}",
        sql.rows
    );
    assert!(
        sql.rows
            .contains("strpos(lower(CAST(\"name\" AS TEXT)), lower($1)) > 0"),
        "display text must be searchable: {}",
        sql.rows
    );
    assert!(
        !sql.rows.contains("created_at"),
        "non-text columns are not searched: {}",
        sql.rows
    );
    assert!(!sql.rows.contains("LIKE"), "no LIKE pattern: {}", sql.rows);

    let sqlite = search_sql(Engine::Sqlite, &target, &columns, 25, 0).unwrap();
    assert!(
        sqlite
            .rows
            .contains("instr(lower(CAST(\"name\" AS TEXT)), lower(?1)) > 0"),
        "{}",
        sqlite.rows
    );

    let mysql = search_sql(Engine::MySql, &target, &columns, 25, 0).unwrap();
    assert!(
        mysql
            .rows
            .contains("LOCATE(LOWER(?), LOWER(CAST(`name` AS CHAR))) > 0"),
        "{}",
        mysql.rows
    );
}

/// A page is a real page: the statement asks the server for rows past the first
/// small page instead of returning the head of the table and filtering it in
/// the client.
#[test]
fn search_sql_asks_the_server_for_the_requested_page() {
    let target = FkTarget::new("public", "users", "id");
    let columns = vec!["id".to_string(), "name".to_string()];

    let page_one = search_sql(Engine::PostgreSql, &target, &columns, 25, 0).unwrap();
    assert!(
        page_one.rows.contains("ORDER BY \"id\" ASC"),
        "{}",
        page_one.rows
    );
    assert!(
        page_one.rows.trim_end().ends_with("LIMIT 25 OFFSET 0"),
        "{}",
        page_one.rows
    );

    let later = search_sql(Engine::PostgreSql, &target, &columns, 25, 75).unwrap();
    assert!(
        later.rows.trim_end().ends_with("LIMIT 25 OFFSET 75"),
        "a later page must be asked for with its own offset: {}",
        later.rows
    );
}

/// The count statement uses exactly the same predicate (so pagination describes
/// the matches, not the whole table) and has no ordering or limit.
#[test]
fn search_count_sql_uses_the_same_predicate() {
    let target = FkTarget::new("public", "users", "id");
    let columns = vec!["id".to_string(), "name".to_string()];
    let sql = search_sql(Engine::PostgreSql, &target, &columns, 25, 50).unwrap();

    assert!(
        sql.count
            .starts_with("SELECT COUNT(*) FROM \"public\".\"users\""),
        "{}",
        sql.count
    );
    for fragment in [
        "strpos(lower(CAST(\"id\" AS TEXT)), lower($1)) > 0",
        "strpos(lower(CAST(\"name\" AS TEXT)), lower($1)) > 0",
    ] {
        assert!(sql.count.contains(fragment), "count: {}", sql.count);
    }
    assert!(!sql.count.contains("ORDER BY"), "{}", sql.count);
    assert!(!sql.count.contains("LIMIT"), "{}", sql.count);
}

/// Pagination and column input are validated: dropping an impossible page would
/// silently return the head of the table under an active search.
#[test]
fn search_sql_rejects_impossible_pages_and_unrepresentable_columns() {
    let target = FkTarget::new("public", "users", "id");
    let columns = vec!["id".to_string()];

    for (limit, offset) in [(0i64, 0i64), (501, 0), (25, -1)] {
        let err = search_sql(Engine::PostgreSql, &target, &columns, limit, offset)
            .expect_err("impossible pagination must fail");
        assert!(err.contains("page"), "error must explain pagination: {err}");
    }

    let err = search_sql(Engine::PostgreSql, &target, &["".to_string()], 25, 0)
        .expect_err("empty column name cannot be represented");
    assert!(err.contains("column"), "error must name the column: {err}");
}

/// `search_columns` always includes the referenced key column first, then the
/// table's text-like columns, without duplicates.
#[test]
fn search_columns_keeps_the_key_column_first_and_deduplicates() {
    let target = FkTarget::new("public", "users", "username");
    let columns = search_columns(
        &target,
        &[
            ("id".into(), "integer".into()),
            ("username".into(), "character varying(80)".into()),
            ("note".into(), "varchar".into()),
            ("payload".into(), "jsonb".into()),
            ("amount".into(), "numeric".into()),
        ],
    );
    assert_eq!(
        columns,
        vec!["username".to_string(), "note".to_string()],
        "the key column is searched once, in front"
    );
}

#[test]
fn is_text_like_covers_character_types_only() {
    for t in [
        "text",
        "character varying",
        "character varying(80)",
        "varchar",
        "char(4)",
        "bpchar",
        "uuid",
        "citext",
        "TEXT",
    ] {
        assert!(is_text_like(t), "{t} must be searchable as text");
    }
    for t in [
        "integer",
        "bigint",
        "numeric",
        "boolean",
        "timestamp without time zone",
        "date",
        "jsonb",
        "bytea",
        "double precision",
    ] {
        assert!(!is_text_like(t), "{t} must not be treated as text");
    }
}

// ---------------------------------------------------------------------------
// Catalog lookups
// ---------------------------------------------------------------------------

/// PostgreSQL resolution goes through `pg_constraint`, pairing each referencing
/// attribute with exactly its referenced one, and binds the names instead of
/// splicing them.
#[test]
fn pg_fk_target_query_binds_names_and_pairs_composite_columns() {
    let q = pg_fk_target_query();
    for placeholder in ["$1", "$2", "$3"] {
        assert!(q.contains(placeholder), "must bind {placeholder}: {q}");
    }
    assert!(q.contains("con.contype = 'f'"), "{q}");
    assert!(
        q.contains("unnest(con.conkey, con.confkey)"),
        "composite FKs must pair attributes: {q}"
    );
    assert!(q.contains("ra.attnum = k.refattnum"), "{q}");
    assert!(
        !q.contains("'public'") && !q.contains("\"users\""),
        "no name may be spliced into the catalog query: {q}"
    );
}

#[test]
fn mysql_fk_target_query_binds_names_and_selects_the_referenced_schema() {
    let q = mysql_fk_target_query();
    assert!(q.contains("referenced_table_schema"), "{q}");
    assert!(q.contains("column_name = ?"), "{q}");
    assert_eq!(q.matches('?').count(), 3, "three bound names: {q}");
}

/// The SQLite FK list is a PRAGMA whose argument is an identifier, so it is
/// quoted through the shared helper.
#[test]
fn sqlite_fk_target_query_quotes_the_table() {
    assert_eq!(
        sqlite_fk_target_query("we ird \"t\""),
        "PRAGMA foreign_key_list(\"we ird \"\"t\"\"\")"
    );
    assert_eq!(
        sqlite_fk_target_query("orders"),
        "PRAGMA foreign_key_list(\"orders\")"
    );
}

/// A table with several foreign keys resolves the one declared on the requested
/// column; an unknown column is an error, never the first FK's target.
#[test]
fn sqlite_fk_target_picks_the_fk_declared_on_the_column() {
    let rows = vec![
        ("users".to_string(), "user_id".to_string(), "id".to_string()),
        (
            "reporting.users".to_string(),
            "reviewer_id".to_string(),
            "id".to_string(),
        ),
    ];
    let target = sqlite_fk_target(&rows, "reviewer_id").expect("FK declared on reviewer_id");
    assert_eq!(target.schema, "main");
    assert_eq!(target.table, "reporting.users");
    assert_eq!(target.column, "id");

    let err = sqlite_fk_target(&rows, "not_a_fk").expect_err("unknown column must fail closed");
    assert!(
        err.contains("not_a_fk"),
        "error must name the column: {err}"
    );
}
