use super::*;

// ------------------------------------------------------------------
// build_args_for_test  (unit tests for arg construction logic)
// ------------------------------------------------------------------

#[test]
fn build_pg_dump_args_plain_format() {
    let args = build_args_for_test(
        "pg_dump",
        "mydb",
        "plain",
        "/tmp/dump.sql",
        true,
        None,
        None,
    );
    assert!(
        args.iter().any(|a| a.contains("--no-owner")),
        "should include --no-owner"
    );
    assert!(
        args.iter().any(|a| a == "--file=/tmp/dump.sql"),
        "should include --file flag"
    );
    // plain format should NOT add a --format flag
    assert!(
        !args.iter().any(|a| a.starts_with("--format")),
        "plain format should not emit --format"
    );
}

#[test]
fn build_pg_dump_args_custom_format() {
    let args = build_args_for_test(
        "pg_dump",
        "mydb",
        "custom",
        "/tmp/dump.bak",
        true,
        Some("public"),
        None,
    );
    assert!(
        args.iter().any(|a| a == "--format=c"),
        "custom format should emit --format=c"
    );
    assert!(
        args.iter().any(|a| a == "--schema=public"),
        "should include --schema flag"
    );
}

#[test]
fn build_pg_dump_args_tar_format() {
    let args = build_args_for_test(
        "pg_dump",
        "testdb",
        "tar",
        "/tmp/test.tar",
        false,
        None,
        None,
    );
    assert!(
        args.iter().any(|a| a == "--format=t"),
        "should emit --format=t"
    );
    assert!(
        !args.iter().any(|a| a.contains("--no-owner")),
        "should NOT include --no-owner when false"
    );
}

#[test]
fn build_pg_dump_args_directory_format() {
    let args = build_args_for_test(
        "pg_dump",
        "proddb",
        "directory",
        "/tmp/dumpdir",
        false,
        None,
        Some(vec!["users", "orders"]),
    );
    assert!(
        args.iter().any(|a| a == "--format=d"),
        "should emit --format=d"
    );
    assert!(args.iter().any(|a| a == "--table=users"));
    assert!(args.iter().any(|a| a == "--table=orders"));
}

#[test]
fn build_pg_restore_args() {
    let args = build_args_for_test(
        "pg_restore",
        "targetdb",
        "custom",
        "/tmp/dump.bak",
        false,
        None,
        None,
    );
    // pg_restore should NOT emit --file=, it should pass the path as positional
    assert!(
        !args.iter().any(|a| a.starts_with("--file")),
        "pg_restore should not use --file flag"
    );
    assert!(
        args.iter().any(|a| a == "/tmp/dump.bak"),
        "pg_restore should include file path as positional arg"
    );
}

#[test]
fn build_pg_restore_args_with_schema() {
    let args = build_args_for_test(
        "pg_restore",
        "mydb",
        "plain",
        "/tmp/dump.sql",
        false,
        Some("public"),
        None,
    );
    assert!(args.iter().any(|a| a == "--schema=public"));
}

// ------------------------------------------------------------------
// detect_pg_tools
// ------------------------------------------------------------------

#[test]
fn detect_pg_tools_does_not_panic() {
    // detect_pg_tools needs a Tauri AppHandle; the headless core keeps the
    // status-shaping logic testable without one.
    let status = build_pg_tool_status("pg_dump", "pg_restore", None, None);
    // May or may not find tools, but the call itself must not panic
    let _ = status.pg_dump_found;
    let _ = status.pg_restore_found;
    let _ = status.pg_dump_version;
    let _ = status.pg_restore_version;
}

#[test]
fn pg_tool_status_serialization() {
    let status = PgToolStatus {
        pg_dump_found: true,
        pg_restore_found: false,
        pg_dump_version: Some("pg_dump (PostgreSQL) 16.0".into()),
        pg_restore_version: None,
        pg_dump_source: None,
        pg_restore_source: None,
    };
    let json = serde_json::to_string(&status).unwrap();
    assert!(json.contains("pg_dump_found"));
    assert!(json.contains("pg_restore_found"));
    assert!(json.contains("pg_dump (PostgreSQL) 16.0"));
}

// ------------------------------------------------------------------
// BackupProgressEvent serialization
// ------------------------------------------------------------------

#[test]
fn backup_progress_event_completed() {
    let evt = BackupProgressEvent {
        job_id: "job-1".into(),
        status: "completed".into(),
        progress: Some(1.0),
        output_line: None,
        error: None,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"completed\""));
    assert!(json.contains("\"progress\":1.0"));
}

#[test]
fn backup_progress_event_failed() {
    let evt = BackupProgressEvent {
        job_id: "job-2".into(),
        status: "failed".into(),
        progress: None,
        output_line: None,
        error: Some("connection refused".into()),
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"failed\""));
    assert!(json.contains("\"connection refused\""));
}

// ------------------------------------------------------------------
// Integration tests (headless, against live DBs)
//
// These exercise the real dump/restore/sync code path (run_pg_dump,
// run_pg_restore, run_db_sync) with passwords passed directly — the
// only thing skipped is the OS-keychain lookup, which is a thin,
// separately-tested concern.
//
// They are #[ignore]d by default so they don't run in normal `cargo test`.
// Run them explicitly with:
//
//   GRIDLINE_TEST_SRC_HOST=... GRIDLINE_TEST_SRC_PORT=... \
//   GRIDLINE_TEST_SRC_USER=... GRIDLINE_TEST_SRC_DB=... \
//   GRIDLINE_TEST_SRC_PASSWORD=... \
//   GRIDLINE_TEST_TGT_HOST=... GRIDLINE_TEST_TGT_PORT=... \
//   GRIDLINE_TEST_TGT_USER=... GRIDLINE_TEST_TGT_DB=... \
//   GRIDLINE_TEST_TGT_PASSWORD=... \
//   cargo test --lib backup -- --ignored
// ------------------------------------------------------------------

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("missing env var {name}"))
}

// Serializes the live-DB integration tests so they don't clobber each other
// when cargo runs them in parallel.
static INTEGRATION_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn conn_from_env(prefix: &str) -> PgConnParams {
    PgConnParams::new(
        env(&format!("{prefix}_HOST")),
        env(&format!("{prefix}_PORT")).parse().unwrap(),
        env(&format!("{prefix}_USER")),
        env(&format!("{prefix}_DB")),
        env(&format!("{prefix}_PASSWORD")),
    )
}

fn psql_exec(conn: &PgConnParams, sql: &str) {
    let out = Command::new("psql")
        .env("PGPASSWORD", &conn.password)
        .args([
            format!("--host={}", conn.host),
            format!("--port={}", conn.port),
            format!("--username={}", conn.username),
            format!("--dbname={}", conn.database),
            "-tA".into(),
            "-c".into(),
            sql.into(),
        ])
        .output()
        .expect("psql should run");
    assert!(
        out.status.success(),
        "psql failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn psql_count(conn: &PgConnParams, query: &str) -> i64 {
    let out = Command::new("psql")
        .env("PGPASSWORD", &conn.password)
        .args([
            format!("--host={}", conn.host),
            format!("--port={}", conn.port),
            format!("--username={}", conn.username),
            format!("--dbname={}", conn.database),
            "-tA".into(),
            "-c".into(),
            query.into(),
        ])
        .output()
        .expect("psql should run");
    assert!(
        out.status.success(),
        "psql failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap()
}

#[test]
#[ignore]
fn integration_dump_restore_sync() {
    let _guard = INTEGRATION_LOCK.lock().unwrap();
    let src = conn_from_env("GRIDLINE_TEST_SRC");
    let tgt = conn_from_env("GRIDLINE_TEST_TGT");

    // Unique temp file per run to avoid collisions.
    let dump_path = std::env::temp_dir().join(format!(
        "gridline_it_dump_{}_{}.bak",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let dump_path_str = dump_path.to_str().unwrap().to_string();

    // --- 1. Dump source (custom format — the only format pg_restore can read) ---
    let dump_opts = BackupOptions {
        format: "custom".into(),
        file_path: dump_path_str.clone(),
        schema: None,
        tables: None,
        no_owner: true,
    };
    run_pg_dump(&src, &dump_opts, &PgToolPaths { pg_dump: "pg_dump".into(), pg_restore: "pg_restore".into(), psql: "psql".into() })
        .expect("pg_dump should succeed");

    // --- 2. Restore into target ---
    let restore_opts = RestoreOptions {
        format: "custom".into(),
        file_path: dump_path_str.clone(),
        clean: true,
        schema: None,
    };
    run_pg_restore(&tgt, &restore_opts, &PgToolPaths { pg_dump: "pg_dump".into(), pg_restore: "pg_restore".into(), psql: "psql".into() })
        .expect("pg_restore should succeed");

    // --- 3. Verify data landed in target ---
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.products;"),
        3,
        "products should be restored"
    );
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.orders;"),
        3,
        "orders should be restored"
    );

    // --- 4. Sync source -> target (target already has tables from the restore
    // above — db_sync now passes --clean --if-exists, so it must succeed into a
    // non-empty target). ---
    run_db_sync(&src, &tgt, None, None, &PgToolPaths { pg_dump: "pg_dump".into(), pg_restore: "pg_restore".into(), psql: "psql".into() })
        .expect("db_sync should succeed");
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.products;"),
        3,
        "sync should re-copy products"
    );
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.orders;"),
        3,
        "sync should re-copy orders"
    );

    // --- Cleanup ---
    let _ = std::fs::remove_file(&dump_path);
}

#[test]
#[ignore]
fn integration_plain_dump_restore() {
    let _guard = INTEGRATION_LOCK.lock().unwrap();
    let src = conn_from_env("GRIDLINE_TEST_SRC");
    let tgt = conn_from_env("GRIDLINE_TEST_TGT");

    // psql can't DROP-before-CREATE, so start from a clean target.
    psql_exec(
        &tgt,
        "DROP TABLE IF EXISTS public.orders, public.products CASCADE;",
    );

    let dump_path = std::env::temp_dir().join(format!(
        "gridline_it_plain_{}_{}.sql",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let dump_path_str = dump_path.to_str().unwrap().to_string();

    // --- 1. Dump source in plain format ---
    let dump_opts = BackupOptions {
        format: "plain".into(),
        file_path: dump_path_str.clone(),
        schema: None,
        tables: None,
        no_owner: true,
    };
    run_pg_dump(&src, &dump_opts, &PgToolPaths { pg_dump: "pg_dump".into(), pg_restore: "pg_restore".into(), psql: "psql".into() })
        .expect("pg_dump (plain) should succeed");

    // --- 2. Restore into target (plain -> psql path) ---
    let restore_opts = RestoreOptions {
        format: "plain".into(),
        file_path: dump_path_str.clone(),
        clean: false,
        schema: None,
    };
    run_pg_restore(&tgt, &restore_opts, &PgToolPaths { pg_dump: "pg_dump".into(), pg_restore: "pg_restore".into(), psql: "psql".into() })
        .expect("pg_restore (plain/psql) should succeed");

    // --- 3. Verify data landed in target ---
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.products;"),
        3,
        "plain restore should load products"
    );
    assert_eq!(
        psql_count(&tgt, "SELECT count(*) FROM public.orders;"),
        3,
        "plain restore should load orders"
    );

    let _ = std::fs::remove_file(&dump_path);
}

// ------------------------------------------------------------------
// Tool resolution (Task 2.1: system-first, bundled-fallback)
// ------------------------------------------------------------------

#[test]
fn pick_tool_prefers_system_then_bundled_then_bare() {
    assert_eq!(pick_tool(true, None, "pg_dump"), ("pg_dump".to_string(), Some("system".into())));
    assert_eq!(pick_tool(false, Some("/r/pg_dump"), "pg_dump"), ("/r/pg_dump".to_string(), Some("bundled".into())));
    assert_eq!(pick_tool(false, None, "pg_dump"), ("pg_dump".to_string(), None));
}

#[test]
fn bundled_bin_name_appends_exe_on_windows() {
    let name = bundled_bin_name("pg_dump");
    if cfg!(windows) { assert_eq!(name, "pg_dump.exe"); } else { assert_eq!(name, "pg_dump"); }
}

// ------------------------------------------------------------------
// SQLite .dump / restore / sync core (Task 2.2)
// ------------------------------------------------------------------

use rusqlite::Connection;
use std::io::Cursor;

fn seed_sqlite() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch(
        "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
         CREATE INDEX users_name ON users(name);
         INSERT INTO users (name) VALUES ('Alice'),('Bob');
         CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB);
         INSERT INTO blobs VALUES (1, x'010203');",
    )
    .unwrap();
    c
}

#[test]
fn sqlite_dump_and_restore_roundtrip() {
    let src = seed_sqlite();
    let mut buf: Vec<u8> = Vec::new();
    let mut cur = std::io::Cursor::new(&mut buf);
    dump_sqlite_to(&src, &mut cur, |_| {}).unwrap();
    let text = String::from_utf8(buf).unwrap();
    assert!(text.contains("PRAGMA foreign_keys=OFF"));
    assert!(text.contains("BEGIN TRANSACTION"));
    assert!(text.contains("CREATE TABLE users"));
    assert!(text.contains("INSERT INTO \"users\""));
    assert!(text.contains("X'010203'"), "BLOB must be hex-literal");
    assert!(text.contains("CREATE INDEX users_name"));

    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    let n: i64 = dst.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 2);
    let blobs: i64 = dst.query_row("SELECT COUNT(*) FROM blobs", [], |r| r.get(0)).unwrap();
    assert_eq!(blobs, 1);
}

#[test]
fn sqlite_dump_preserves_autoincrement_sequence() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT); INSERT INTO t(v) VALUES ('a'),('b');").unwrap();
    let mut buf = Vec::new();
    dump_sqlite_to(&src, &mut Cursor::new(&mut buf), |_| {}).unwrap();
    let text = String::from_utf8(buf).unwrap();
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    dst.execute("INSERT INTO t(v) VALUES ('c')", []).unwrap();
    let id: i64 = dst.query_row("SELECT id FROM t WHERE v='c'", [], |r| r.get(0)).unwrap();
    assert_eq!(id, 3);
}

#[test]
fn sqlite_dump_fail_closed_for_virtual_tables() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch("CREATE VIRTUAL TABLE ft USING fts4(content)").unwrap();
    let mut buf = Vec::new();
    let err = dump_sqlite_to(&src, &mut Cursor::new(&mut buf), |_| {}).unwrap_err();
    assert!(err.to_lowercase().contains("virtual table"), "got: {err}");
}

#[test]
fn sqlite_restore_clean_drops_existing() {
    let src = seed_sqlite();
    let mut buf = Vec::new();
    dump_sqlite_to(&src, &mut Cursor::new(&mut buf), |_| {}).unwrap();
    let text = String::from_utf8(buf).unwrap();
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users VALUES (99,'old');").unwrap();
    restore_sqlite(&dst, &text, true).unwrap();
    let names: Vec<String> = dst.prepare("SELECT name FROM users ORDER BY id").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().filter_map(|r| r.ok()).collect();
    assert_eq!(names, vec!["Alice".to_string(), "Bob".to_string()]);
}
