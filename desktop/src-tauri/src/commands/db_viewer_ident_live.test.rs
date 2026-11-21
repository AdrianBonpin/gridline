//! Ticket 11 — live end-to-end coverage over *legal but awkward* names.
//!
//! Every name here is legal in the engine and must survive browsing, filtering,
//! sorting, editing, introspection, and DDL copy unchanged:
//!
//! * `we ird "tbl"` — spaces and an embedded double quote,
//! * `a"b` — embedded double quote,
//! * `o'brien` — embedded single quote,
//! * `select`, `order` — SQL keywords,
//! * `Mixed Case` — spaces plus mixed case.
//!
//! These tests run against real SQLite (in-memory), so they prove the built SQL
//! is accepted by a real parser instead of merely matching a string.

use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::models::db_viewer::{FilterRule, SortRule};

/// A table and columns whose names all need quoting, plus rows to filter on.
const AKKWARD_SCHEMA: &str = r#"
    CREATE TABLE "we ird ""tbl""" (
        "id" INTEGER PRIMARY KEY,
        "a""b" TEXT,
        "o'brien" TEXT,
        "select" INTEGER,
        "Mixed Case" TEXT
    );
    INSERT INTO "we ird ""tbl""" ("id", "a""b", "o'brien", "select", "Mixed Case")
    VALUES
        (1, 'x', 'one',   30, 'mixed'),
        (2, 'y', 'two',   10, 'case'),
        (3, 'x', 'three', 20, 'keys');
    CREATE TABLE "child ""t""" (
        "id" INTEGER PRIMARY KEY,
        "we ird ""ref""" INTEGER REFERENCES "we ird ""tbl"""("id")
    );
    INSERT INTO "child ""t""" ("id", "we ird ""ref""") VALUES (1, 2);
"#;

const WEIRD_TABLE: &str = "we ird \"tbl\"";

fn awkward_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute_batch(AKKWARD_SCHEMA)
        .expect("seed awkward names");
    conn
}

fn filter(column: &str, operator: &str, value: &str) -> FilterRule {
    FilterRule {
        id: "f1".into(),
        column: column.into(),
        operator: operator.into(),
        value: value.into(),
    }
}

fn sort(column: &str, order: &str) -> SortRule {
    SortRule {
        id: "s1".into(),
        column: column.into(),
        order: order.into(),
    }
}

fn pooled(conn: rusqlite::Connection) -> tokio::sync::Mutex<ConnectionPoolManager> {
    let mut pm = ConnectionPoolManager::new();
    pm.register("sqlite-awkward", DbHandle::Sqlite(conn));
    tokio::sync::Mutex::new(pm)
}

fn text_at(row: &[serde_json::Value], idx: usize) -> String {
    match &row[idx] {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Index of `name` in the returned column metadata; also asserts the column is
/// reported with the exact name the engine stores.
fn column_index(result: &crate::models::QueryResult, name: &str) -> usize {
    result
        .columns
        .iter()
        .position(|c| c.name == name)
        .unwrap_or_else(|| {
            let names: Vec<&str> = result.columns.iter().map(|c| c.name.as_str()).collect();
            panic!("column {name:?} missing from metadata; got {names:?}");
        })
}

#[tokio::test]
async fn sqlite_browses_table_and_columns_with_quotes_spaces_and_keywords() {
    let pm = pooled(awkward_conn());
    let result = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-awkward",
        "main",
        WEIRD_TABLE,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("browse must succeed with legal-but-awkward names");

    assert_eq!(result.total_rows, Some(3));
    assert_eq!(result.rows.len(), 3);
    for name in ["id", "a\"b", "o'brien", "select", "Mixed Case"] {
        column_index(&result, name);
    }
    // Primary-key metadata must survive quoting too.
    let id = column_index(&result, "id");
    assert!(result.columns[id].is_pk, "id must be reported as the PK");
}

#[tokio::test]
async fn sqlite_filters_on_awkward_column_names() {
    // Double quote + a keyword + a single quote: one rule each.
    for (column, operator, value, expected) in [
        ("a\"b", "eq", "x", 2usize),
        ("select", "gt", "10", 2),
        ("o'brien", "contains", "tw", 1),
        ("Mixed Case", "starts", "k", 1),
    ] {
        let pm = pooled(awkward_conn());
        let result = crate::commands::db_viewer::get_table_data_inner(
            &pm,
            "sqlite-awkward",
            "main",
            WEIRD_TABLE,
            None,
            None,
            Some(vec![filter(column, operator, value)]),
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("filter on {column:?} must succeed: {e}"));

        assert_eq!(
            result.total_rows.unwrap() as usize,
            expected,
            "filter {column} {operator} {value:?} must actually restrict rows"
        );
        assert_eq!(
            result.rows.len(),
            expected,
            "filter {column} {operator} {value:?} must return {expected} rows"
        );
    }
}

#[tokio::test]
async fn sqlite_sorts_on_awkward_column_names() {
    let pm = pooled(awkward_conn());
    let result = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-awkward",
        "main",
        WEIRD_TABLE,
        None,
        None,
        None,
        Some(vec![sort("select", "desc")]),
    )
    .await
    .expect("sort on a keyword-named column must succeed");

    let idx = column_index(&result, "select");
    let order: Vec<i64> = result
        .rows
        .iter()
        .map(|r| r[idx].as_i64().unwrap_or_default())
        .collect();
    assert_eq!(
        order,
        vec![30, 20, 10],
        "sort must order by the named column"
    );
}

/// A filter/sort whose column cannot be represented must fail loudly. Returning
/// the whole table (or an unsorted page) under an active filter is the silent
/// wrong-results failure this ticket exists to remove.
#[tokio::test]
async fn sqlite_unrepresentable_filter_fails_instead_of_returning_all_rows() {
    let pm = pooled(awkward_conn());
    let err = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-awkward",
        "main",
        WEIRD_TABLE,
        None,
        None,
        Some(vec![filter("", "eq", "x")]),
        None,
    )
    .await
    .expect_err("empty column name cannot be represented and must fail");
    assert!(
        err.contains("filter") && err.contains("empty"),
        "error must name the filter and the reason: {err}"
    );
}

#[tokio::test]
async fn sqlite_unrepresentable_sort_fails_instead_of_returning_unsorted_rows() {
    let pm = pooled(awkward_conn());
    let err = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-awkward",
        "main",
        WEIRD_TABLE,
        None,
        None,
        None,
        Some(vec![sort("select", "sideways")]),
    )
    .await
    .expect_err("unsupported sort direction must fail");
    assert!(
        err.contains("sideways"),
        "error must name the direction: {err}"
    );
}

#[tokio::test]
async fn sqlite_unknown_filter_operator_fails_instead_of_being_dropped() {
    let pm = pooled(awkward_conn());
    let err = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-awkward",
        "main",
        WEIRD_TABLE,
        None,
        None,
        Some(vec![filter("a\"b", "matches_regex", "x")]),
        None,
    )
    .await
    .expect_err("unsupported operator must fail");
    assert!(
        err.contains("matches_regex"),
        "error must name the operator: {err}"
    );
}

/// Editing: the generated UPDATE must target the awkward column names and
/// actually change the row (applied straight to the live connection).
#[tokio::test]
async fn sqlite_edits_cells_in_awkward_column_names() {
    let conn = awkward_conn();
    let (sql, params) = crate::commands::db_viewer::build_update_sql(
        "main",
        WEIRD_TABLE,
        &[("id".to_string(), serde_json::json!(2))],
        &[("a\"b".to_string(), serde_json::json!("edited"))],
        &[],
    )
    .expect("build update");
    let sqlite_params: Vec<rusqlite::types::Value> = params
        .iter()
        .map(crate::commands::db_viewer::json_to_sqlite_value)
        .collect();
    let changed = conn
        .execute(&sql, rusqlite::params_from_iter(sqlite_params.iter()))
        .unwrap_or_else(|e| panic!("update must run: {e} (sql: {sql})"));
    assert_eq!(changed, 1);
    let value: String = conn
        .query_row(
            "SELECT \"a\"\"b\" FROM \"we ird \"\"tbl\"\"\" WHERE id = 2",
            [],
            |r| r.get(0),
        )
        .expect("read back edited value");
    assert_eq!(value, "edited");
}

/// A no-PK table is edited through its `rowid` locator; the generated statement
/// must still quote awkward column names.
#[tokio::test]
async fn sqlite_edits_no_pk_table_through_rowid_with_awkward_names() {
    let conn = awkward_conn();
    let (sql, params) = crate::commands::db_viewer::build_update_sql(
        "main",
        WEIRD_TABLE,
        &[("rowid".to_string(), serde_json::json!(1))],
        &[("Mixed Case".to_string(), serde_json::json!("rowid-edit"))],
        &[],
    )
    .expect("build update");
    let sqlite_params: Vec<rusqlite::types::Value> = params
        .iter()
        .map(crate::commands::db_viewer::json_to_sqlite_value)
        .collect();
    assert_eq!(
        conn.execute(&sql, rusqlite::params_from_iter(sqlite_params.iter()))
            .unwrap_or_else(|e| panic!("update must run: {e} (sql: {sql})")),
        1
    );
}

/// DDL copy must return the stored CREATE statement for an awkward name.
#[test]
fn sqlite_ddl_copy_handles_awkward_table_names() {
    let conn = awkward_conn();
    let ddl = crate::commands::db_viewer::get_sqlite_ddl(&conn, WEIRD_TABLE)
        .expect("DDL for an awkward table name must be found");
    assert!(
        ddl.contains("CREATE TABLE"),
        "expected a CREATE TABLE statement: {ddl}"
    );
}

/// Introspection: the shared PRAGMA builders must resolve the awkward table.
#[test]
fn sqlite_introspection_resolves_awkward_table_names() {
    let conn = awkward_conn();

    let cols_sql = crate::db::introspection::sqlite_columns_query(WEIRD_TABLE);
    let mut stmt = conn
        .prepare(&cols_sql)
        .unwrap_or_else(|e| panic!("column PRAGMA must parse: {e} ({cols_sql})"));
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .expect("query columns")
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    assert_eq!(names, vec!["id", "a\"b", "o'brien", "select", "Mixed Case"]);

    // FK metadata: the child table's FK column and referenced table keep their
    // awkward names verbatim.
    let fk_sql = crate::db::introspection::sqlite_foreign_keys_query("child \"t\"");
    let mut stmt = conn
        .prepare(&fk_sql)
        .unwrap_or_else(|e| panic!("FK PRAGMA must parse: {e} ({fk_sql})"));
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(3)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(4)?,
            ))
        })
        .expect("query fks")
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    assert_eq!(
        rows,
        vec![(
            "we ird \"ref\"".to_string(),
            WEIRD_TABLE.to_string(),
            "id".to_string()
        )],
        "FK introspection must report the referenced table name verbatim"
    );

    // Index metadata (added by this ticket) resolves the same way.
    conn.execute_batch("CREATE INDEX \"idx \"\"weird\"\"\" ON \"we ird \"\"tbl\"\"\" (\"a\"\"b\")")
        .expect("create index with awkward name");
    let idx_sql = crate::db::introspection::sqlite_index_list_query(WEIRD_TABLE);
    let mut stmt = conn
        .prepare(&idx_sql)
        .unwrap_or_else(|e| panic!("index PRAGMA must parse: {e} ({idx_sql})"));
    let indexes: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .expect("query indexes")
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    assert_eq!(indexes, vec!["idx \"weird\""]);

    let info_sql = crate::db::introspection::sqlite_index_info_query("idx \"weird\"");
    let mut stmt = conn
        .prepare(&info_sql)
        .unwrap_or_else(|e| panic!("index_info PRAGMA must parse: {e} ({info_sql})"));
    let index_cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, Option<String>>(2))
        .expect("query index columns")
        .filter_map(|r| r.ok().flatten())
        .collect();
    assert_eq!(index_cols, vec!["a\"b"]);
}

// ---------------------------------------------------------------------------
// Live PostgreSQL — same coverage, real server
// ---------------------------------------------------------------------------

/// Connect to the scratch server named by the `GRIDLINE_TEST_PG_*` env vars.
async fn pg_client() -> (tokio_postgres::Client, tokio::task::JoinHandle<()>) {
    let host = std::env::var("GRIDLINE_TEST_PG_HOST").expect("GRIDLINE_TEST_PG_HOST");
    let port: u16 = std::env::var("GRIDLINE_TEST_PG_PORT")
        .unwrap_or_else(|_| "5432".into())
        .parse()
        .expect("GRIDLINE_TEST_PG_PORT");
    let user = std::env::var("GRIDLINE_TEST_PG_USER").expect("GRIDLINE_TEST_PG_USER");
    let db = std::env::var("GRIDLINE_TEST_PG_DB").expect("GRIDLINE_TEST_PG_DB");
    let pw = std::env::var("GRIDLINE_TEST_PG_PASSWORD").unwrap_or_default();

    let mut config = tokio_postgres::Config::new();
    config.host(&host).port(port).user(&user).dbname(&db);
    if !pw.is_empty() {
        config.password(&pw);
    }
    let (client, conn) = config
        .connect(tokio_postgres::NoTls)
        .await
        .expect("connect to test PG");
    let handle = tokio::spawn(async move {
        let _ = conn.await;
    });
    (client, handle)
}

/// Live PostgreSQL test. Requires a scratch server reachable through the
/// `GRIDLINE_TEST_PG_*` env vars (the convention used by the other live tests
/// in this crate); it creates and drops its own schema, so it is safe to run
/// against a development database.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_PG_* env vars pointing at a scratch PostgreSQL"]
async fn pg_legal_names_browse_filter_sort_edit_and_introspect() {
    let (client, handle) = pg_client().await;

    // Unique-per-run schema whose name itself needs quoting.
    let schema = format!("grid line \"11\" {}", std::process::id());
    let table = "we ird \"tbl\"";
    let q_schema = crate::db::ident::quote(crate::db::ident::Engine::PostgreSql, &schema);
    let q_table = crate::db::ident::qualified(crate::db::ident::Engine::PostgreSql, &schema, table)
        .expect("legal names are representable");

    client
        .batch_execute(&format!(
            r#"CREATE SCHEMA {q_schema};
               CREATE TABLE {q_table} (
                   "id" integer PRIMARY KEY,
                   "a""b" text,
                   "o'brien" text,
                   "select" integer,
                   "Mixed Case" text
               );
               INSERT INTO {q_table} ("id", "a""b", "o'brien", "select", "Mixed Case")
               VALUES (1, 'x', 'one', 30, 'mixed'),
                      (2, 'y', 'two', 10, 'case'),
                      (3, 'x', 'three', 20, 'keys');"#
        ))
        .await
        .expect("create awkward schema/table");

    let mut pm = ConnectionPoolManager::new();
    pm.register("pg-awkward", DbHandle::Postgresql(client, handle));
    let pm = tokio::sync::Mutex::new(pm);

    // Browse.
    let all = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "pg-awkward",
        &schema,
        table,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("browse must succeed");
    assert_eq!(all.total_rows, Some(3));
    for name in ["id", "a\"b", "o'brien", "select", "Mixed Case"] {
        column_index(&all, name);
    }

    // Filter (quotes, keyword, single quote).
    for (column, operator, value, expected) in [
        ("a\"b", "eq", "x", 2usize),
        ("select", "gt", "10", 2),
        ("o'brien", "contains", "tw", 1),
    ] {
        let filtered = crate::commands::db_viewer::get_table_data_inner(
            &pm,
            "pg-awkward",
            &schema,
            table,
            None,
            None,
            Some(vec![filter(column, operator, value)]),
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("filter on {column:?} must succeed: {e}"));
        assert_eq!(
            filtered.total_rows.unwrap() as usize,
            expected,
            "filter {column} {operator} {value:?} must restrict the count"
        );
        assert_eq!(filtered.rows.len(), expected);
    }

    // Sort.
    let sorted = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "pg-awkward",
        &schema,
        table,
        None,
        None,
        None,
        Some(vec![sort("select", "desc")]),
    )
    .await
    .expect("sort on a keyword-named column must succeed");
    let idx = column_index(&sorted, "select");
    let order: Vec<i64> = sorted
        .rows
        .iter()
        .map(|r| r[idx].as_i64().unwrap_or_default())
        .collect();
    assert_eq!(order, vec![30, 20, 10]);

    // Introspection (bound `$1`/`$2`, so awkward names survive).
    let columns =
        crate::commands::db_viewer::get_table_columns_inner(&pm, "pg-awkward", &schema, table)
            .await
            .expect("column introspection must succeed");
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["id", "a\"b", "o'brien", "select", "Mixed Case"]);

    // Edit through the queue's UPDATE builder.
    let (sql, _params) = crate::commands::db_viewer::build_pg_update_sql(
        &schema,
        table,
        &[("id".to_string(), serde_json::json!(2))],
        &[("a\"b".to_string(), serde_json::json!("edited"))],
        &[],
    )
    .expect("build pg update");
    let changed = {
        let mut guard = pm.lock().await;
        match guard.get("pg-awkward") {
            Some(DbHandle::Postgresql(client, _)) => client
                .execute(&sql, &[&"edited", &2i32])
                .await
                .expect("update must run"),
            _ => panic!("expected a postgresql handle"),
        }
    };
    assert_eq!(changed, 1);

    // Cleanup: the schema drop is the whole point of a scratch name.
    let mut guard = pm.lock().await;
    if let Some(DbHandle::Postgresql(client, _)) = guard.get("pg-awkward") {
        client
            .batch_execute(&format!("DROP SCHEMA {q_schema} CASCADE"))
            .await
            .expect("drop scratch schema");
    }
}

// ---------------------------------------------------------------------------
// Live MySQL / MariaDB — same coverage, real server
// ---------------------------------------------------------------------------

/// Live MySQL test. Requires a scratch server through `GRIDLINE_TEST_MYSQL_*`
/// env vars; it creates and drops its own table.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_MYSQL_* env vars pointing at a scratch MySQL/MariaDB"]
async fn mysql_legal_names_browse_filter_sort_edit_and_introspect() {
    use sqlx::mysql::MySqlPoolOptions;

    let url = std::env::var("GRIDLINE_TEST_MYSQL_URL")
        .expect("GRIDLINE_TEST_MYSQL_URL (e.g. mysql://root:pw@127.0.0.1:3306/scratch)");
    let pool = MySqlPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .expect("connect to test MySQL");

    let schema: String = sqlx::query_scalar("SELECT DATABASE()")
        .fetch_one(&pool)
        .await
        .expect("current database");
    let table = "we ird `tbl`";
    let q_table =
        crate::db::ident::qualified(crate::db::ident::Engine::MySql, &schema, table).unwrap();

    sqlx::query(&format!("DROP TABLE IF EXISTS {q_table}"))
        .execute(&pool)
        .await
        .expect("drop leftovers");
    sqlx::query(&format!(
        "CREATE TABLE {q_table} (
             `id` int PRIMARY KEY,
             `a\"b` text,
             `o'brien` text,
             `select` int,
             `Mixed Case` text
         )"
    ))
    .execute(&pool)
    .await
    .expect("create awkward table");
    sqlx::query(&format!(
        "INSERT INTO {q_table} (`id`, `a\"b`, `o'brien`, `select`, `Mixed Case`) VALUES
             (1, 'x', 'one', 30, 'mixed'),
             (2, 'y', 'two', 10, 'case'),
             (3, 'x', 'three', 20, 'keys')"
    ))
    .execute(&pool)
    .await
    .expect("seed rows");

    let mut pm = ConnectionPoolManager::new();
    pm.register("mysql-awkward", DbHandle::MySql(pool.clone()));
    let pm = tokio::sync::Mutex::new(pm);

    // Table list for the schema: the schema filter is a bound `?`, so the same
    // query works for a schema name containing quotes or backslashes.
    let tables =
        crate::commands::db_viewer::get_tables_inner(&pm, "mysql-awkward", Some(schema.as_str()))
            .await
            .expect("table listing must succeed");
    assert!(
        tables.iter().any(|t| t.name == table),
        "table list must include the awkward table: {:?}",
        tables.iter().map(|t| &t.name).collect::<Vec<_>>()
    );

    // Browse.
    let all = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "mysql-awkward",
        &schema,
        table,
        None,
        None,
        None,
        None,
    )
    .await
    .expect("browse must succeed");
    assert_eq!(all.rows.len(), 3);
    for name in ["id", "a\"b", "o'brien", "select", "Mixed Case"] {
        column_index(&all, name);
    }

    // Filter — the schema/table introspection binds `?`, so a quote in either
    // name cannot change which table is read.
    for (column, operator, value, expected) in [
        ("a\"b", "eq", "x", 2usize),
        ("select", "gt", "10", 2),
        ("o'brien", "contains", "tw", 1),
    ] {
        let filtered = crate::commands::db_viewer::get_table_data_inner(
            &pm,
            "mysql-awkward",
            &schema,
            table,
            None,
            None,
            Some(vec![filter(column, operator, value)]),
            None,
        )
        .await
        .unwrap_or_else(|e| panic!("filter on {column:?} must succeed: {e}"));
        assert_eq!(
            filtered.rows.len(),
            expected,
            "filter {column} {operator} {value:?} must restrict rows"
        );
    }

    // Sort.
    let sorted = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "mysql-awkward",
        &schema,
        table,
        None,
        None,
        None,
        Some(vec![sort("select", "desc")]),
    )
    .await
    .expect("sort on a keyword-named column must succeed");
    let idx = column_index(&sorted, "select");
    let order: Vec<i64> = sorted
        .rows
        .iter()
        .map(|r| {
            r[idx]
                .as_i64()
                .or_else(|| r[idx].as_str().and_then(|s| s.parse().ok()))
                .unwrap_or_default()
        })
        .collect();
    assert_eq!(order, vec![30, 20, 10]);

    // Introspection.
    let columns = crate::commands::db_viewer::mysql_load_columns(&pool, &schema, table, false)
        .await
        .expect("column introspection must succeed");
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["id", "a\"b", "o'brien", "select", "Mixed Case"]);

    // DDL copy (`SHOW CREATE TABLE` with quoted identifiers).
    let ddl_row = sqlx::query(&crate::db::mysql::mysql_ddl_query(&schema, table))
        .fetch_one(&pool)
        .await
        .expect("show create table");
    // `SHOW CREATE TABLE` returns (Table, Create Table).
    let ddl: String = sqlx::Row::get(&ddl_row, 1);
    let quoted_table = crate::db::ident::quote(crate::db::ident::Engine::MySql, table);
    assert!(
        ddl.contains(&quoted_table),
        "DDL must name the awkward table as {quoted_table}: {ddl}"
    );

    // Edit.
    let (sql, params) = crate::db::mysql::mysql_build_update_sql(
        &schema,
        table,
        &[("id".to_string(), serde_json::json!(2))],
        &[("a\"b".to_string(), serde_json::json!("edited"))],
        &[],
    )
    .expect("build mysql update");
    let mut q = sqlx::query(&sql);
    for p in &params {
        q = match p {
            serde_json::Value::String(s) => q.bind(s.clone()),
            other => q.bind(other.to_string()),
        };
    }
    let done = q.execute(&pool).await.expect("update must run");
    assert_eq!(done.rows_affected(), 1);

    sqlx::query(&format!("DROP TABLE {q_table}"))
        .execute(&pool)
        .await
        .expect("drop scratch table");
}

/// The strongest form of "saved unchanged": the definition is created on a real
/// server and the catalog's stored body (`pg_proc.prosrc`) is compared with the
/// text that was submitted, byte for byte. A body containing `$$`, quotes, and
/// semicolons used to be cut short at the first inner `$$`.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_PG_* env vars pointing at a scratch PostgreSQL"]
async fn pg_routine_body_with_dollar_quotes_and_semicolons_saves_unchanged() {
    let (client, _handle) = pg_client().await;
    let schema = format!("gridline_t11_fn_{}", std::process::id());
    let q_schema = crate::db::ident::quote(crate::db::ident::Engine::PostgreSql, &schema);
    client
        .batch_execute(&format!("CREATE SCHEMA {q_schema}"))
        .await
        .expect("create scratch schema");

    let body = "DECLARE x text := 'it''s; ok $$';\nBEGIN\n  RETURN x || '$$; more';\nEND;";
    let ddl = crate::db::object_crud::build_ddl(
        "function",
        serde_json::json!({
            "schema": schema, "name": "fn Weird", "is_procedure": false,
            "action": {
                "op": "create_or_replace",
                "args": [],
                "return_type": "text",
                "language": "plpgsql",
                "body": body,
                "volatility": null,
                "strict": false
            }
        }),
    )
    .expect("DDL must build");
    assert_eq!(ddl.len(), 1);
    client
        .batch_execute(&ddl[0])
        .await
        .unwrap_or_else(|e| panic!("server must accept the definition: {e} ({})", ddl[0]));

    let stored: String = client
        .query_one(
            "SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 AND p.proname = $2",
            &[&schema, &"fn Weird"],
        )
        .await
        .expect("read stored body")
        .get(0);
    assert_eq!(
        stored, body,
        "the server must store the body verbatim (got {stored:?})"
    );

    // And the copy-DDL path returns a definition that still contains the body.
    let def: String = client
        .query_one(
            "SELECT pg_get_functiondef(p.oid) FROM pg_proc p \
             JOIN pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 AND p.proname = $2",
            &[&schema, &"fn Weird"],
        )
        .await
        .expect("function definition")
        .get(0);
    assert!(
        def.contains("it''s; ok $$"),
        "copied DDL must keep the body: {def}"
    );

    client
        .batch_execute(&format!("DROP SCHEMA {q_schema} CASCADE"))
        .await
        .expect("drop scratch schema");
}
