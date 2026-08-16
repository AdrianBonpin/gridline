use super::*;
use crate::commands::db_viewer::build_sqlite_data_select;

/// Open an in-memory SQLite database seeded with the demo schema.
fn seed_demo() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(&get_demo_schema()).unwrap();
    conn
}

/// Count rows in a table/view.
fn count(conn: &rusqlite::Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}

#[test]
fn demo_schema_creates_expected_objects() {
    let conn = seed_demo();
    let mut stmt = conn
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap();
    let objects: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let expected: Vec<(&str, &str)> = vec![
        ("addresses", "table"),
        ("app_settings", "table"),
        ("audit_log", "table"),
        ("categories", "table"),
        ("files", "table"),
        ("marketing_campaigns", "table"),
        ("order_items", "table"),
        ("order_summary", "view"),
        ("orders", "table"),
        ("page_views", "table"),
        ("products", "table"),
        ("users", "table"),
    ];
    assert_eq!(
        objects,
        expected
            .into_iter()
            .map(|(n, t)| (n.to_string(), t.to_string()))
            .collect::<Vec<_>>(),
        "demo schema must contain exactly the expected tables + view"
    );
}

#[test]
fn demo_schema_seeds_expected_rows() {
    let conn = seed_demo();
    assert_eq!(count(&conn, "users"), 20);
    assert_eq!(count(&conn, "categories"), 6);
    assert_eq!(count(&conn, "products"), 24);
    assert_eq!(count(&conn, "addresses"), 23);
    assert_eq!(count(&conn, "orders"), 50);
    assert_eq!(count(&conn, "order_items"), 105);
    assert_eq!(
        count(&conn, "audit_log"),
        500,
        "audit_log must seed 500 rows for pagination/virtualization demos"
    );
    assert_eq!(count(&conn, "files"), 8);
    assert_eq!(count(&conn, "page_views"), 100);
    assert_eq!(count(&conn, "app_settings"), 6);
    assert_eq!(
        count(&conn, "marketing_campaigns"),
        0,
        "marketing_campaigns must stay empty to demo the Empty Table change"
    );
    assert_eq!(
        count(&conn, "order_summary"),
        50,
        "view must return one row per order"
    );
}

#[test]
fn demo_schema_is_idempotent() {
    let conn = seed_demo();
    // Re-running the full schema (e.g. on a fresh file after a partial seed)
    // must not duplicate rows.
    conn.execute_batch(&get_demo_schema()).unwrap();
    assert_eq!(count(&conn, "users"), 20);
    assert_eq!(count(&conn, "audit_log"), 500);
    assert_eq!(count(&conn, "page_views"), 100);
    assert_eq!(count(&conn, "products"), 24);
}

#[test]
fn demo_schema_sets_user_version() {
    let conn = seed_demo();
    let v: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        v, DEMO_SCHEMA_VERSION,
        "demo file must stamp PRAGMA user_version for upgrade detection"
    );
}

#[test]
fn demo_json_columns_hold_valid_json() {
    let conn = seed_demo();
    // Every non-NULL value in a `json`-declared column must parse as JSON so
    // the grid's JSON popover can format it.
    for (table, column) in [
        ("users", "preferences"),
        ("products", "attributes"),
        ("audit_log", "details"),
    ] {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .unwrap();
        let values: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(
            !values.is_empty(),
            "{table}.{column} should have non-null values"
        );
        for v in &values {
            assert!(
                serde_json::from_str::<serde_json::Value>(v).is_ok(),
                "{table}.{column} must hold valid JSON, got: {v}"
            );
        }
    }
    // And the declared type must be lowercase `json` so the frontend's
    // `data_type === "json"` check triggers the JSON cell popover.
    for (table, column) in [
        ("users", "preferences"),
        ("products", "attributes"),
        ("audit_log", "details"),
    ] {
        let dt: String = conn
            .query_row(
                &format!("SELECT type FROM pragma_table_info('{table}') WHERE name = '{column}'"),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            dt, "json",
            "{table}.{column} must be declared lowercase json"
        );
    }
}

#[test]
fn demo_view_is_queryable() {
    let conn = seed_demo();
    let mut stmt = conn.prepare("SELECT order_id, customer_name, item_count, order_total, status FROM order_summary ORDER BY order_id").unwrap();
    let rows: Vec<(i64, String, i64, f64, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(rows.len(), 50);
    let first = &rows[0];
    assert_eq!(first.0, 1);
    assert_eq!(first.1, "Sarah Chen");
    assert_eq!(first.4, "processing");
    // order 1 is populated by generated line items; just ensure it has at least one.
    assert!(first.2 >= 1, "order 1 should have at least one line item");
}

#[test]
fn demo_view_loads_through_table_data_path() {
    // Regression: a view tab used to fail with "no such column: rowid" because
    // the data SELECT appended the rowid locator (views have no PK → has_pk
    // false → locator appended → views expose no rowid). This mirrors the
    // SQLite branch of get_table_data exactly.
    let conn = seed_demo();
    let is_view: bool = conn
        .query_row(
            "SELECT type = 'view' FROM sqlite_master WHERE name = ?1 AND type IN ('table', 'view')",
            ["order_summary"],
            |r| r.get::<_, bool>(0),
        )
        .unwrap();
    assert!(is_view, "order_summary must be a view");

    let mut pragma_stmt = conn.prepare("PRAGMA table_info('order_summary')").unwrap();
    let col_meta: Vec<(String, bool)> = pragma_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, bool>(5)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    let has_pk = col_meta.iter().any(|(_, pk)| *pk);
    assert!(!has_pk, "views report no PK from PRAGMA table_info");

    let visible_names: Vec<String> = col_meta.iter().map(|(n, _)| n.clone()).collect();
    let data_query = format!(
        "{} WHERE 1=1 LIMIT 50 OFFSET 0",
        build_sqlite_data_select("order_summary", &visible_names, !has_pk && !is_view)
    );
    assert!(
        !data_query.contains("rowid"),
        "view data SELECT must not select rowid; got: {}",
        data_query
    );
    let mut stmt = conn.prepare(&data_query).unwrap();
    let col_count = stmt.column_count();
    let rows: Vec<Vec<rusqlite::types::Value>> = stmt
        .query_map([], |row| {
            let mut vals = Vec::new();
            for i in 0..col_count {
                vals.push(row.get::<_, rusqlite::types::Value>(i)?);
            }
            Ok(vals)
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    let expected: i64 = conn
        .query_row("SELECT COUNT(*) FROM \"main\".\"order_summary\"", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        rows.len() as i64,
        expected,
        "view data query must return every view row (count = {expected})"
    );
    assert!(!rows.is_empty(), "seeded view must not be empty");
}

#[test]
fn demo_foreign_keys_are_consistent() {
    let conn = seed_demo();
    // PRAGMA foreign_key_check reports any orphaned child rows.
    let violations: Vec<(String, i64, String, i64)> = conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert!(
        violations.is_empty(),
        "seed data must satisfy every FK: {violations:?}"
    );
    // audit_log.user_id must be NULL or reference an existing user.
    let orphans: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(orphans, 0);
}

#[test]
fn demo_tables_exercise_key_constraint_shapes() {
    let conn = seed_demo();
    // order_items: composite PRIMARY KEY across two columns. SQLite reports
    // pk as the 1-based position within the key, so both columns are > 0.
    let composite: Vec<(String, bool)> = conn
        .prepare("SELECT name, pk FROM pragma_table_info('order_items') WHERE pk > 0 ORDER BY pk")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(
        composite
            .iter()
            .map(|(n, _)| n.as_str())
            .collect::<Vec<_>>(),
        vec!["order_id", "product_id"]
    );
    // page_views: no primary key at all (rowid row-locator editing demo).
    let pk_cols: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('page_views') WHERE pk > 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        pk_cols, 0,
        "page_views must have no PK so the rowid locator kicks in"
    );
    // app_settings: TEXT primary key.
    let text_pk: String = conn
        .query_row(
            "SELECT name FROM pragma_table_info('app_settings') WHERE pk > 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(text_pk, "key");
    // categories: self-referencing FK.
    let self_fk: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_foreign_key_list('categories') WHERE \"table\" = 'categories'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(self_fk, 1);
}

#[test]
fn demo_file_is_recreated_when_stale() {
    // A file stamped with an older user_version must be recreated by
    // ensure_demo_file; a current file must be left untouched.
    let dir = std::env::temp_dir().join(format!("gridline-demo-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("demo.db");

    // Stale file: old version, old schema.
    let stale = rusqlite::Connection::open(&path).unwrap();
    stale
        .execute_batch("PRAGMA user_version = 1; CREATE TABLE legacy (id INTEGER PRIMARY KEY);")
        .unwrap();
    drop(stale);
    ensure_demo_file(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    let v: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        v, DEMO_SCHEMA_VERSION,
        "stale demo file must be recreated with the current version"
    );
    assert_eq!(
        count(&conn, "users"),
        20,
        "recreated file must be fully seeded"
    );
    drop(conn);

    // Current file: ensure_demo_file must not touch it.
    ensure_demo_file(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        count(&conn, "users"),
        20,
        "current demo file must not be reseeded"
    );

    // Regenerate flow: the file is deleted entirely, then recreated from
    // scratch with the current schema (what `regenerate_demo_db` does).
    drop(conn);
    std::fs::remove_file(&path).unwrap();
    ensure_demo_file(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    let v: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(v, DEMO_SCHEMA_VERSION);
    assert_eq!(count(&conn, "users"), 20);
    assert_eq!(count(&conn, "audit_log"), 500);

    std::fs::remove_dir_all(&dir).ok();
}
