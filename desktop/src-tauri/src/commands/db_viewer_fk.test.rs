//! Ticket 12 — following a foreign key that points into another schema, and
//! searching the whole referenced table for an option.
//!
//! The regression these tests pin down:
//!
//! * a preview/option lookup must read the **referenced** relation, never a
//!   same-named table somewhere else (the silent wrong-row bug), and
//! * option search must reach matches past an initial small page. The demo
//!   fixture below puts the only "grace" match at row 120 of a 120-row table,
//!   i.e. far beyond the first 50 rows.
//!
//! SQLite is a real engine here: the statements are parsed and executed, so a
//! quoting or qualification mistake fails instead of merely not matching a
//! string.

use crate::db::fk::FkTarget;
use crate::db::ident::Engine;
use crate::db::pool::{ConnectionPoolManager, DbHandle};

const USERS: usize = 120;

/// `main.users` (120 rows) + `main.orders(user_id → users.id)`, and an attached
/// `aux` database that deliberately contains a **same-named** `users` table with
/// different rows.
const SCHEMA: &str = r#"
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, username TEXT);
    CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id)
    );
"#;

fn seeded_conn() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("open in-memory sqlite");
    conn.execute_batch(SCHEMA).expect("seed fk fixture");
    conn.execute_batch(
        "ATTACH DATABASE ':memory:' AS aux;
         CREATE TABLE aux.users (id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO aux.users (id, name) VALUES (1, 'aux-alice');",
    )
    .expect("attach a same-named table in another schema");
    for i in 1..=USERS {
        let name = if i == USERS {
            // The one match a first-page-only dropdown could never find.
            "Grace Hopper".to_string()
        } else {
            format!("Person {i:03}")
        };
        conn.execute(
            "INSERT INTO users (id, name, username) VALUES (?1, ?2, ?3)",
            rusqlite::params![i as i64, name, format!("user{i:03}")],
        )
        .expect("seed user row");
    }
    conn.execute("INSERT INTO orders (id, user_id) VALUES (1, 120)", [])
        .expect("seed the order that references the last user");
    conn
}

fn pooled(conn: rusqlite::Connection) -> tokio::sync::Mutex<ConnectionPoolManager> {
    let mut pm = ConnectionPoolManager::new();
    pm.register("sqlite-fk", DbHandle::sqlite(conn));
    tokio::sync::Mutex::new(pm)
}

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

fn text_at(row: &[serde_json::Value], idx: usize) -> String {
    match &row[idx] {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------------------
// Same-named table in another schema
// ---------------------------------------------------------------------------

/// The lookup statement is schema-qualified, so asking for `aux.users` returns
/// the `aux` row even though `main.users` has a row with the same key.
#[test]
fn preview_sql_reads_the_referenced_schema_not_a_same_named_local_table() {
    let conn = seeded_conn();

    let main_sql =
        crate::db::fk::preview_sql(Engine::Sqlite, &FkTarget::new("main", "users", "id")).unwrap();
    let aux_sql =
        crate::db::fk::preview_sql(Engine::Sqlite, &FkTarget::new("aux", "users", "id")).unwrap();

    let read = |sql: &str| -> String {
        conn.query_row(sql, rusqlite::params!["1"], |r| r.get::<_, String>(1))
            .unwrap_or_else(|e| panic!("preview query must run: {e} ({sql})"))
    };

    assert_eq!(
        read(&main_sql),
        "Person 001",
        "main.users must answer for the main schema"
    );
    assert_eq!(
        read(&aux_sql),
        "aux-alice",
        "aux.users must answer for the aux schema — a same-named local table is never substituted"
    );
}

/// The same guarantee for option search: a search qualified with `aux` must not
/// return `main`'s 120 rows.
#[test]
fn search_sql_is_scoped_to_the_referenced_schema() {
    let conn = seeded_conn();
    let target = FkTarget::new("aux", "users", "id");
    let columns = vec!["id".to_string(), "name".to_string()];
    let sql = crate::db::fk::search_sql(Engine::Sqlite, &target, &columns, 25, 0).unwrap();

    let mut stmt = conn
        .prepare(&sql.rows)
        .unwrap_or_else(|e| panic!("search must parse: {e} ({})", sql.rows));
    let names: Vec<String> = stmt
        .query_map(rusqlite::params!["person"], |r| r.get::<_, String>(1))
        .expect("run scoped search")
        .filter_map(|r| r.ok())
        .collect();
    assert!(
        names.is_empty(),
        "aux.users holds no 'person' rows, so a schema-scoped search must not see main's: {names:?}"
    );
}

// ---------------------------------------------------------------------------
// Preview resolves the referenced relation from FK metadata
// ---------------------------------------------------------------------------

/// The preview is requested with the *source* column; the referenced relation
/// comes from the engine's FK metadata, so the row is read from `users` and the
/// metadata shown describes `users` (not `orders`).
#[tokio::test]
async fn sqlite_preview_resolves_the_referenced_table_from_fk_metadata() {
    let pm = pooled(seeded_conn());
    let result = crate::commands::db_viewer::get_fk_preview_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "user_id",
        "120",
    )
    .await
    .expect("preview must resolve the FK target");

    assert_eq!(result.rows.len(), 1);
    let name = column_index(&result, "name");
    assert_eq!(text_at(&result.rows[0], name), "Grace Hopper");
    assert!(
        result.columns.iter().all(|c| c.name != "user_id"),
        "the preview must describe the referenced table, not the source one"
    );
}

/// A column without a foreign key cannot be followed; that is an error, not a
/// guess at some other table.
#[tokio::test]
async fn sqlite_preview_fails_closed_for_a_non_fk_column() {
    let pm = pooled(seeded_conn());
    let err = crate::commands::db_viewer::get_fk_preview_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "id",
        "1",
    )
    .await
    .expect_err("a non-FK column has no reference to follow");
    assert!(
        err.contains("id"),
        "error must name the column that is not a foreign key: {err}"
    );
}

// ---------------------------------------------------------------------------
// Option search past the first small page
// ---------------------------------------------------------------------------

/// The only "grace" row is #120. A dropdown that searched the first 50 rows in
/// the client could not find it; a server-side search must.
#[tokio::test]
async fn sqlite_fk_option_search_finds_a_match_beyond_the_first_page() {
    let pm = pooled(seeded_conn());
    let result = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "user_id",
        "grace",
        Some(1),
        Some(25),
    )
    .await
    .expect("search must succeed");

    assert_eq!(
        result.total_rows,
        Some(1),
        "exactly one row matches 'grace'"
    );
    assert_eq!(result.rows.len(), 1);
    let id = column_index(&result, "id");
    let name = column_index(&result, "name");
    assert_eq!(result.rows[0][id].as_i64(), Some(120));
    assert_eq!(text_at(&result.rows[0], name), "Grace Hopper");
}

/// Paging is real: every page is a separate server-side query, and the pages
/// past the first are reachable.
#[tokio::test]
async fn sqlite_fk_option_search_pages_past_the_initial_page() {
    let pm = pooled(seeded_conn());

    let page_one = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "user_id",
        "person",
        Some(1),
        Some(25),
    )
    .await
    .expect("page 1");
    // Every "person" row except the deliberately different last one.
    let expected_matches = (USERS - 1) as i64;
    assert_eq!(page_one.total_rows, Some(expected_matches));
    assert_eq!(page_one.rows.len(), 25);

    let page_three = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "user_id",
        "person",
        Some(3),
        Some(25),
    )
    .await
    .expect("page 3");
    assert_eq!(page_three.total_rows, Some(expected_matches));
    assert_eq!(page_three.rows.len(), 25);

    let id = column_index(&page_three, "id");
    assert_eq!(
        page_three.rows[0][id].as_i64(),
        Some(51),
        "page 3 of 25 must start at row 51, not repeat the head of the table"
    );
    assert_eq!(page_three.rows[24][id].as_i64(), Some(75));
}

/// An empty search still returns a first page (the dropdown's initial options)
/// rather than nothing or the whole table.
#[tokio::test]
async fn sqlite_fk_option_search_without_a_term_returns_the_first_page() {
    let pm = pooled(seeded_conn());
    let result = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "sqlite-fk",
        "main",
        "orders",
        "user_id",
        "",
        Some(1),
        Some(25),
    )
    .await
    .expect("empty search");
    assert_eq!(result.total_rows, Some(USERS as i64));
    assert_eq!(result.rows.len(), 25);
}

/// Impossible pagination fails instead of silently returning page one.
#[tokio::test]
async fn sqlite_fk_option_search_rejects_impossible_pagination() {
    for (page, size) in [
        (Some(0i64), Some(25i64)),
        (Some(1), Some(0)),
        (Some(1), Some(501)),
    ] {
        let pm = pooled(seeded_conn());
        let err = crate::commands::db_viewer::search_fk_options_inner(
            &pm,
            "sqlite-fk",
            "main",
            "orders",
            "user_id",
            "person",
            page,
            size,
        )
        .await
        .expect_err("impossible pagination must fail");
        assert!(err.contains("page"), "error must explain pagination: {err}");
    }
}

// ---------------------------------------------------------------------------
// Live PostgreSQL — a real cross-schema foreign key
// ---------------------------------------------------------------------------

/// Both schemas hold a table named `people`. `public.orders.person_id` points at
/// `reporting.people.id`, so following it must read the `reporting` row — the
/// `public` row with the same key must never be substituted.
#[tokio::test]
#[ignore = "needs GRIDLINE_TEST_PG_* env vars pointing at a scratch PostgreSQL"]
async fn pg_cross_schema_fk_preview_and_search_use_the_referenced_schema() {
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

    let suffix = std::process::id().to_string();
    let reporting = format!("gridline_t12_reporting_{suffix}");
    let public = format!("gridline_t12_public_{suffix}");
    let q_reporting = crate::db::ident::quote(Engine::PostgreSql, &reporting);
    let q_public = crate::db::ident::quote(Engine::PostgreSql, &public);

    client
        .batch_execute(&format!(
            r#"CREATE SCHEMA {q_reporting};
               CREATE SCHEMA {q_public};
               CREATE TABLE {q_reporting}.people (id integer PRIMARY KEY, name text);
               CREATE TABLE {q_public}.people (id integer PRIMARY KEY, name text);
               CREATE TABLE {q_public}.orders (
                   id integer PRIMARY KEY,
                   person_id integer REFERENCES {q_reporting}.people(id)
               );
               INSERT INTO {q_reporting}.people VALUES (1, 'reporting-alice');
               INSERT INTO {q_public}.people VALUES (1, 'public-alice');
               INSERT INTO {q_public}.orders VALUES (1, 1);"#
        ))
        .await
        .expect("seed cross-schema fixture");

    let mut pm = ConnectionPoolManager::new();
    pm.register("pg-fk", DbHandle::postgresql(client, handle));
    let pm = tokio::sync::Mutex::new(pm);

    // Column metadata reports the referenced schema.
    let columns =
        crate::commands::db_viewer::get_table_columns_inner(&pm, "pg-fk", &public, "orders")
            .await
            .expect("introspect orders");
    let person = columns
        .iter()
        .find(|c| c.name == "person_id")
        .expect("person_id column");
    assert!(person.is_fk);
    assert_eq!(
        person.fk_ref,
        Some((reporting.clone(), "people".to_string(), "id".to_string())),
        "FK metadata must carry the referenced schema"
    );

    // Preview: the row comes from the referenced schema.
    let preview = crate::commands::db_viewer::get_fk_preview_inner(
        &pm,
        "pg-fk",
        &public,
        "orders",
        "person_id",
        "1",
    )
    .await
    .expect("preview");
    assert_eq!(preview.rows.len(), 1);
    let name = column_index(&preview, "name");
    assert_eq!(
        text_at(&preview.rows[0], name),
        "reporting-alice",
        "following the FK must read the referenced schema's row"
    );

    // Search: scoped to the referenced schema, and reaches past a first page.
    let found = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "pg-fk",
        &public,
        "orders",
        "person_id",
        "reporting",
        Some(1),
        Some(25),
    )
    .await
    .expect("search");
    assert_eq!(found.total_rows, Some(1));
    assert_eq!(text_at(&found.rows[0], name), "reporting-alice");

    let decoy = crate::commands::db_viewer::search_fk_options_inner(
        &pm,
        "pg-fk",
        &public,
        "orders",
        "person_id",
        "public-alice",
        Some(1),
        Some(25),
    )
    .await
    .expect("search for the decoy");
    assert_eq!(
        decoy.total_rows,
        Some(0),
        "a same-named local table's row must never answer for the referenced one"
    );

    let mut guard = pm.lock().await;
    if let Some(DbHandle::Postgresql(client, _)) = guard.acquire("pg-fk") {
        let client = client.lock().await;
        client
            .batch_execute(&format!(
                "DROP SCHEMA {q_reporting} CASCADE; DROP SCHEMA {q_public} CASCADE"
            ))
            .await
            .expect("drop scratch schemas");
    }
}
