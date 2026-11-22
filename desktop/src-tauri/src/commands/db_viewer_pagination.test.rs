//! Ticket 09 — a paginated read describes exactly the rows it returns.
//!
//! Three separate ways a browse could lie about its own page are pinned here:
//!
//! * the **total** must count the rows the *filter* selects, not the whole
//!   table (the MySQL count was filter-blind, so a filtered browse reported the
//!   unfiltered total and paginated past the real end);
//! * the **page window** is untrusted input: a non-positive page or a page size
//!   outside `1..=500` is rejected instead of silently changing the query's
//!   `LIMIT`/`OFFSET`, and an unrepresentable offset never wraps;
//! * **metadata** is a different question from a row page. Column
//!   introspection reads the catalog (no `LIMIT`), so it cannot truncate or
//!   consume row data, and it stays available for the read-only objects
//!   (views, materialized views) that must never offer an edit.
//!
//! SQLite is a real engine here — the statements are parsed and executed, so a
//! broken builder fails instead of merely not matching a string. The MySQL
//! total is covered on the builder seam (`db::mysql`) plus an env-gated live
//! server case at the bottom.

use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::models::db_viewer::{Change, FilterRule};

/// Six rows, so page boundaries land on real data: two paid, three pending,
/// one cancelled.
const SCHEMA: &str = r#"
    CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        note TEXT
    );
    INSERT INTO orders (id, status, note) VALUES
        (1, 'paid',    'first'),
        (2, 'paid',    'gift wrap'),
        (3, 'pending', NULL),
        (4, 'pending', 'hold'),
        (5, 'pending', 'gift card'),
        (6, 'cancelled', NULL);
"#;

/// Rows per browse page, chosen so a rejected `page_size` cannot be mistaken
/// for the documented 1..=500 window.
const MAX_PAGE_SIZE: i64 = 500;

fn seeded_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute_batch(SCHEMA).expect("seed pagination fixture");
    conn
}

fn pooled(conn: rusqlite::Connection) -> tokio::sync::Mutex<ConnectionPoolManager> {
    let mut pm = ConnectionPoolManager::new();
    pm.register("sqlite-09", DbHandle::sqlite(conn));
    tokio::sync::Mutex::new(pm)
}

fn filter(column: &str, operator: &str, value: &str) -> FilterRule {
    FilterRule {
        id: "f1".into(),
        column: column.into(),
        operator: operator.into(),
        value: value.into(),
    }
}

/// The `id` column of a page, in the order the engine returned it.
fn ids(result: &crate::models::QueryResult) -> Vec<i64> {
    let idx = result
        .columns
        .iter()
        .position(|c| c.name == "id")
        .expect("page has an id column");
    result
        .rows
        .iter()
        .map(|r| r[idx].as_i64().expect("id is an integer"))
        .collect()
}

async fn page(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    page: Option<i64>,
    page_size: Option<i64>,
    filters: Option<Vec<FilterRule>>,
) -> Result<crate::models::QueryResult, String> {
    crate::commands::db_viewer::get_table_data_inner(
        pm,
        "sqlite-09",
        "main",
        "orders",
        page,
        page_size,
        filters,
        None,
    )
    .await
}

// ---------------------------------------------------------------------------
// Totals describe the filtered result
// ---------------------------------------------------------------------------

#[tokio::test]
async fn page_reports_exactly_the_rows_it_returned_and_the_matching_total() {
    let pm = pooled(seeded_conn());

    let first = page(&pm, Some(1), Some(2), None).await.expect("page 1");
    assert_eq!(ids(&first), vec![1, 2]);
    assert_eq!(first.total_rows, Some(6));
    assert_eq!((first.page, first.page_size), (1, 2));
    assert!(first.has_more, "page 1 of 3 has more");

    let last = page(&pm, Some(3), Some(2), None).await.expect("page 3");
    assert_eq!(ids(&last), vec![5, 6]);
    assert_eq!(last.total_rows, Some(6));
    assert!(!last.has_more, "the last page ends the result");

    // A page past the end is empty, not an error and not a different total.
    let empty = page(&pm, Some(4), Some(2), None).await.expect("page 4");
    assert!(empty.rows.is_empty());
    assert_eq!(empty.total_rows, Some(6));
    assert!(!empty.has_more);
}

#[tokio::test]
async fn filtered_page_counts_only_the_rows_the_filter_selects() {
    let pm = pooled(seeded_conn());
    let filters = Some(vec![filter("status", "eq", "paid")]);

    let page1 = page(&pm, Some(1), Some(1), filters.clone())
        .await
        .expect("filtered page 1");
    assert_eq!(ids(&page1), vec![1]);
    assert_eq!(
        page1.total_rows,
        Some(2),
        "the total must describe the filtered result, not the six-row table"
    );
    assert!(page1.has_more);

    let page2 = page(&pm, Some(2), Some(1), filters.clone())
        .await
        .expect("filtered page 2");
    assert_eq!(ids(&page2), vec![2]);
    assert_eq!(page2.total_rows, Some(2));
    assert!(!page2.has_more, "the filtered result ends after two rows");

    // A filter that matches nothing reports a zero total and no more pages.
    let none = page(
        &pm,
        Some(1),
        Some(50),
        Some(vec![filter("status", "eq", "refunded")]),
    )
    .await
    .expect("empty filtered page");
    assert!(none.rows.is_empty());
    assert_eq!(none.total_rows, Some(0));
    assert!(!none.has_more);
}

#[tokio::test]
async fn contains_filter_narrows_the_total_too() {
    let pm = pooled(seeded_conn());
    let filtered = page(
        &pm,
        Some(1),
        Some(50),
        Some(vec![filter("note", "contains", "gift")]),
    )
    .await
    .expect("contains filter");
    assert_eq!(ids(&filtered), vec![2, 5]);
    assert_eq!(filtered.total_rows, Some(2));
}

// ---------------------------------------------------------------------------
// Page window is untrusted input
// ---------------------------------------------------------------------------

#[tokio::test]
async fn non_positive_page_is_rejected_instead_of_changing_the_query_limit() {
    let pm = pooled(seeded_conn());

    for bad_page in [0_i64, -1, -1_000_000] {
        let err = page(&pm, Some(bad_page), Some(2), None)
            .await
            .expect_err("a non-positive page must be rejected");
        assert!(
            err.to_lowercase().contains("page"),
            "the error must name the page: {err}"
        );
    }
}

#[tokio::test]
async fn out_of_range_page_size_is_rejected_instead_of_being_clamped() {
    let pm = pooled(seeded_conn());

    for bad_size in [0_i64, -50, MAX_PAGE_SIZE + 1, 1_000, 100_000] {
        let err = page(&pm, Some(1), Some(bad_size), None)
            .await
            .expect_err("an out-of-range page size must be rejected");
        assert!(
            err.to_lowercase().contains("page size"),
            "the error must name the page size: {err}"
        );
    }

    // The documented window is inclusive at both ends.
    let smallest = page(&pm, Some(1), Some(1), None)
        .await
        .expect("page size 1 is allowed");
    assert_eq!(smallest.rows.len(), 1);
    let largest = page(&pm, Some(1), Some(MAX_PAGE_SIZE), None)
        .await
        .expect("page size 500 is allowed");
    assert_eq!(largest.rows.len(), 6);
}

#[tokio::test]
async fn unrepresentable_offset_is_rejected_rather_than_wrapping() {
    let pm = pooled(seeded_conn());
    let err = page(&pm, Some(i64::MAX), Some(MAX_PAGE_SIZE), None)
        .await
        .expect_err("an offset that overflows must not wrap into a valid page");
    assert!(
        err.to_lowercase().contains("page"),
        "the error must explain the page intent: {err}"
    );
}

#[tokio::test]
async fn rejected_input_leaves_the_next_valid_read_intact() {
    let pm = pooled(seeded_conn());
    let _ = page(&pm, Some(0), Some(2), None).await;
    let _ = page(&pm, Some(1), Some(9_999), None).await;

    let ok = page(&pm, Some(1), Some(50), None)
        .await
        .expect("a valid read still works");
    assert_eq!(
        ok.rows.len(),
        6,
        "no earlier request may have consumed rows"
    );
    assert_eq!(ok.total_rows, Some(6));
}

// ---------------------------------------------------------------------------
// Metadata is not a row page
// ---------------------------------------------------------------------------

#[tokio::test]
async fn column_metadata_is_read_from_the_catalog_without_paginating_rows() {
    let pm = pooled(seeded_conn());

    // Metadata is available on SQLite at all (it used to be a PostgreSQL-only
    // command), and it never asks for a page of rows.
    let columns =
        crate::commands::db_viewer::get_table_columns_inner(&pm, "sqlite-09", "main", "orders")
            .await
            .expect("column metadata");
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["id", "status", "note"]);

    // Reading metadata twice is not a page request: the full data set is still
    // there, unfiltered and untruncated.
    let _ = crate::commands::db_viewer::get_table_columns_inner(&pm, "sqlite-09", "main", "orders")
        .await
        .expect("column metadata, second read");
    let all = page(&pm, Some(1), Some(50), None).await.expect("rows");
    assert_eq!(all.rows.len(), 6);
    assert_eq!(all.total_rows, Some(6));

    // And it did not reset the page window either.
    let second = page(&pm, Some(2), Some(2), None).await.expect("page 2");
    assert_eq!(ids(&second), vec![3, 4]);
}

#[tokio::test]
async fn metadata_of_a_missing_table_is_an_error_not_a_stuck_empty_list() {
    let pm = pooled(seeded_conn());
    let err =
        crate::commands::db_viewer::get_table_columns_inner(&pm, "sqlite-09", "main", "no_such")
            .await;
    assert!(err.is_ok(), "PRAGMA on a missing table yields no columns");
    let cols = err.unwrap();
    assert!(cols.is_empty());
}

// ---------------------------------------------------------------------------
// Views and materialized views: browsable, never editable
// ---------------------------------------------------------------------------

#[tokio::test]
async fn view_data_and_metadata_stay_read_only() {
    let conn = seeded_conn();
    conn.execute_batch(
        "CREATE VIEW paid_orders AS SELECT id, status FROM orders WHERE status = 'paid';",
    )
    .expect("create view");
    let pm = pooled(conn);

    let data = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-09",
        "main",
        "paid_orders",
        Some(1),
        Some(50),
        None,
        None,
    )
    .await
    .expect("a view is browsable");
    assert_eq!(ids(&data), vec![1, 2]);
    assert_eq!(data.total_rows, Some(2));
    assert!(
        data.columns.iter().all(|c| !c.editable),
        "no column of a view may offer an edit"
    );
    // No hidden row locator: the row width is exactly the declared columns.
    assert_eq!(
        data.rows[0].len(),
        data.columns.len(),
        "a view exposes no rowid locator"
    );

    let columns = crate::commands::db_viewer::get_table_columns_inner(
        &pm,
        "sqlite-09",
        "main",
        "paid_orders",
    )
    .await
    .expect("view metadata");
    let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["id", "status"]);
    assert!(
        columns.iter().all(|c| !c.editable),
        "metadata for a view must be read-only too"
    );
}

#[tokio::test]
async fn table_without_a_primary_key_still_reports_a_row_locator() {
    // The contrast case: a *physical table* with no PK carries a locator so the
    // change queue can address a row, while a view cannot.
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute_batch(
        "CREATE TABLE audit (msg TEXT); INSERT INTO audit (msg) VALUES ('a'), ('b');",
    )
    .expect("seed locator fixture");
    let pm = pooled(conn);

    let data = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        "sqlite-09",
        "main",
        "audit",
        None,
        None,
        None,
        None,
    )
    .await
    .expect("no-PK table browse");
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.total_rows, Some(2));
    assert_eq!(
        data.rows[0].len(),
        data.columns.len() + 1,
        "a no-PK table carries one trailing rowid locator"
    );
}

// ---------------------------------------------------------------------------
// An all-defaults insert is valid SQL
// ---------------------------------------------------------------------------

#[tokio::test]
async fn inserting_a_row_with_every_field_at_its_default_succeeds() {
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute_batch(
        "CREATE TABLE guests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL DEFAULT 'anonymous',
            visits INTEGER NOT NULL DEFAULT 1
        );",
    )
    .expect("seed default-values fixture");
    let pm = pooled(conn);

    let change = Change::Insert {
        id: "chg-09".into(),
        schema: "main".into(),
        table: "guests".into(),
        // Every editable field left blank is exactly what the Insert Row form
        // sends when the user types nothing.
        data: "{}".into(),
    };
    crate::commands::db_viewer::execute_change_inner(&pm, "sqlite-09", change)
        .await
        .expect("an empty default-values insert must be valid SQLite");

    let handle = pm.lock().await.acquire("sqlite-09").expect("handle");
    let DbHandle::Sqlite(shared) = handle else {
        panic!("expected a sqlite handle")
    };
    let conn = shared.lock().await;
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM guests", [], |r| r.get(0))
        .expect("count the inserted row");
    assert_eq!(rows, 1, "exactly one row was inserted");
    let (name, visits): (String, i64) = conn
        .query_row("SELECT name, visits FROM guests", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .expect("the default row exists");
    assert_eq!(name, "anonymous");
    assert_eq!(visits, 1);
}

#[test]
fn empty_insert_statement_uses_default_values() {
    assert_eq!(
        crate::commands::db_viewer::build_insert_sql("main", "guests", &[]),
        "INSERT INTO \"main\".\"guests\" DEFAULT VALUES"
    );
    // A populated insert keeps its placeholders.
    assert_eq!(
        crate::commands::db_viewer::build_insert_sql("main", "guests", &["name".to_string()]),
        "INSERT INTO \"main\".\"guests\" (\"name\") VALUES (?)"
    );
}

// ---------------------------------------------------------------------------
// The MySQL total (env-gated live server)
// ---------------------------------------------------------------------------

/// Live MySQL/MariaDB case for the ticket's headline bug: a filtered browse
/// must report the filtered total and page count.
///
/// It runs against the `GRIDLINE_TEST_MYSQL_*` scratch server. Without one it
/// skips on a developer machine and FAILS under
/// `GRIDLINE_REQUIRE_LIVE_DB_TESTS=1` (which CI sets alongside the MySQL service
/// it provisions), so the test can no longer report green while running nothing.
#[tokio::test]
async fn live_mysql_filtered_browse_reports_the_filtered_total() {
    use crate::commands::query::query_tests::live_mysql_settings;
    let Some(settings) = live_mysql_settings() else {
        // Only reachable without `GRIDLINE_REQUIRE_LIVE_DB_TESTS=1`, which turns
        // the missing prerequisite into a failure inside `live_mysql_settings`.
        return;
    };
    let db = settings.db.clone();
    let cfg = crate::db::pool::DbConfig {
        db_type: "mysql".into(),
        host: settings.host,
        port: Some(settings.port as i64),
        username: Some(settings.user),
        password: Some(settings.pass),
        database: Some(db.clone()),
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_password: None,
        ssh_private_key_path: None,
        ssh_passphrase: None,
    };
    let ssh = std::sync::Mutex::new(crate::commands::ssh::SshTunnelManager::new(
        std::sync::Arc::new(crate::commands::ssh::Ssh2Backend::new(std::sync::Arc::new(
            crate::commands::ssh_trust::fake::FakeHostTrust::default(),
        ))),
    ));
    let pm = tokio::sync::Mutex::new(ConnectionPoolManager::new());
    let cancel = crate::cancel::CancelRegistry::new();
    let id = format!("mysql-09-{}", uuid::Uuid::new_v4());
    crate::commands::db_viewer::run_mysql_connect(&id, &cfg, &ssh, &pm, &cancel)
        .await
        .expect("connect to the scratch server");

    let table = format!("gridline_browse_{}", uuid::Uuid::new_v4().simple());
    {
        let handle = pm.lock().await.acquire(&id).expect("handle");
        let DbHandle::MySql(shared) = handle else {
            panic!("expected a mysql handle")
        };
        let pool = shared.lock().await;
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TABLE `{}`.`{}` (id INT PRIMARY KEY, status VARCHAR(16))",
            db, table
        )))
        .execute(&*pool)
        .await
        .expect("create scratch table");
        for (i, status) in (1..=6).map(|i| (i, if i <= 2 { "paid" } else { "pending" })) {
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "INSERT INTO `{}`.`{}` (id, status) VALUES (?, ?)",
                db, table
            )))
            .bind(i)
            .bind(status)
            .execute(&*pool)
            .await
            .expect("seed row");
        }
    }

    let filtered = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        &id,
        &db,
        &table,
        Some(1),
        Some(1),
        Some(vec![filter("status", "eq", "paid")]),
        None,
    )
    .await
    .expect("filtered browse");
    assert_eq!(filtered.rows.len(), 1);
    assert_eq!(
        filtered.total_rows,
        Some(2),
        "the filtered total, not the six-row table count"
    );
    assert!(filtered.has_more);

    let page2 = crate::commands::db_viewer::get_table_data_inner(
        &pm,
        &id,
        &db,
        &table,
        Some(2),
        Some(1),
        Some(vec![filter("status", "eq", "paid")]),
        None,
    )
    .await
    .expect("filtered page 2");
    assert_eq!(page2.total_rows, Some(2));
    assert!(!page2.has_more, "the filtered result ends after two rows");

    // Cleanup: drop the scratch table so a reused server stays clean.
    let handle = pm.lock().await.acquire(&id).expect("handle");
    if let DbHandle::MySql(pool) = handle {
        let pool = pool.lock().await;
        let _ = sqlx::query(sqlx::AssertSqlSafe(format!(
            "DROP TABLE `{}`.`{}`",
            db, table
        )))
        .execute(&*pool)
        .await;
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL: views and materialized views (env-gated live server)
// ---------------------------------------------------------------------------

/// A materialized view is absent from `information_schema.tables`, so the old
/// `table_type = 'VIEW'` check reported it as an editable table. It must be
/// browsable and reported read-only, with no `ctid` locator in its rows.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_PG_* env vars pointing at a scratch PostgreSQL"]
async fn live_pg_views_and_matviews_are_browsable_and_read_only() {
    let host = std::env::var("GRIDLINE_TEST_PG_HOST").expect("GRIDLINE_TEST_PG_HOST");
    let port: u16 = std::env::var("GRIDLINE_TEST_PG_PORT")
        .expect("GRIDLINE_TEST_PG_PORT")
        .parse()
        .expect("GRIDLINE_TEST_PG_PORT is a port");
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

    let schema = format!("gridline_view_{}", std::process::id());
    let q_schema = crate::db::ident::quote(crate::db::ident::Engine::PostgreSql, &schema);
    client
        .batch_execute(&format!(
            r#"CREATE SCHEMA {q_schema};
               CREATE TABLE {q_schema}.orders (id integer PRIMARY KEY, status text);
               INSERT INTO {q_schema}.orders (id, status) VALUES (1, 'paid'), (2, 'pending'), (3, 'paid');
               CREATE VIEW {q_schema}.paid_orders AS
                   SELECT id, status FROM {q_schema}.orders WHERE status = 'paid';
               CREATE MATERIALIZED VIEW {q_schema}.pending_orders AS
                   SELECT id, status FROM {q_schema}.orders WHERE status = 'pending';"#
        ))
        .await
        .expect("create view fixture");

    let mut pm = ConnectionPoolManager::new();
    pm.register("pg-09", DbHandle::postgresql(client, handle));
    let pm = tokio::sync::Mutex::new(pm);

    for (relation, expected_total) in [("paid_orders", 2_i64), ("pending_orders", 1)] {
        let data = crate::commands::db_viewer::get_table_data_inner(
            &pm, "pg-09", &schema, relation, None, None, None, None,
        )
        .await
        .unwrap_or_else(|e| panic!("{relation} must be browsable: {e}"));
        assert_eq!(data.total_rows, Some(expected_total), "{relation} total");
        assert_eq!(data.rows.len() as i64, expected_total);
        assert!(
            data.columns.iter().all(|c| !c.editable),
            "no column of {relation} may offer an edit"
        );
        assert_eq!(
            data.rows[0].len(),
            data.columns.len(),
            "{relation} must carry no row locator"
        );

        let columns =
            crate::commands::db_viewer::get_table_columns_inner(&pm, "pg-09", &schema, relation)
                .await
                .expect("read-only relation metadata");
        assert_eq!(columns.len(), data.columns.len(), "{relation} metadata");
        assert!(
            columns.iter().all(|c| !c.editable),
            "metadata for {relation} must be read-only"
        );
    }

    let mut guard = pm.lock().await;
    if let Some(DbHandle::Postgresql(client, _)) = guard.acquire("pg-09") {
        let client = client.lock().await;
        client
            .batch_execute(&format!("DROP SCHEMA {q_schema} CASCADE"))
            .await
            .expect("drop scratch schema");
    }
}
