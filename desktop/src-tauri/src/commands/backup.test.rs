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
fn build_pg_tool_status_reflects_resolutions() {
    let dump = ToolResolution {
        resolved: Some(crate::db::tool_resolver::Resolution {
            program: "/opt/homebrew/bin/mariadb-dump".into(),
            source: crate::db::tool_resolver::ToolSource::TrustedDir,
            name: "pg_dump".into(),
        }),
        bundled_path: Some(std::path::PathBuf::from("/app/resources/pg_tools/pg_dump")),
        bundled_available: true,
        version: Some("pg_dump (PostgreSQL) 16.4".into()),
    };
    let status = build_pg_tool_status(&dump, &ToolResolution::none());
    assert!(status.pg_dump_found);
    assert!(!status.pg_restore_found);
    assert_eq!(status.pg_dump_source.as_deref(), Some("system"));
    assert_eq!(status.pg_dump_resolved_name.as_deref(), Some("pg_dump"));
    assert!(status.pg_dump_bundled_available);
    assert!(!status.pg_restore_bundled_available);
}

#[test]
fn build_mysql_tool_status_reports_the_resolved_dump_name() {
    let dump = ToolResolution {
        resolved: Some(crate::db::tool_resolver::Resolution {
            program: "/opt/homebrew/bin/mariadb-dump".into(),
            source: crate::db::tool_resolver::ToolSource::TrustedDir,
            name: "mariadb-dump".into(),
        }),
        bundled_path: Some(std::path::PathBuf::from(
            "/app/resources/mysql_tools/mariadb-dump",
        )),
        bundled_available: true,
        version: Some("mariadb-dump 11.4.5-MariaDB".into()),
    };
    let status = build_mysql_tool_status(&dump, &ToolResolution::none());
    assert!(status.mysqldump_found);
    assert!(!status.mysql_found);
    assert_eq!(
        status.mysqldump_resolved_name.as_deref(),
        Some("mariadb-dump")
    );
    assert!(status.mysqldump_is_mariadb);
    assert!(!status.mysql_bundled_available);
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
        pg_dump_resolved_name: Some("pg_dump".into()),
        pg_restore_resolved_name: None,
        pg_dump_bundled_available: true,
        pg_restore_bundled_available: false,
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
        warning: None,
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
        warning: None,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"failed\""));
    assert!(json.contains("\"connection refused\""));
}

#[test]
fn backup_progress_event_serializes_a_non_fatal_warning() {
    let evt = BackupProgressEvent {
        job_id: "job-warn".into(),
        status: "running".into(),
        progress: Some(0.0),
        output_line: None,
        error: None,
        warning: Some("Client/server version mismatch: …".into()),
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(
        json.contains("\"warning\":\"Client/server version mismatch"),
        "{json}"
    );
}

#[test]
fn backup_progress_event_serializes_a_null_warning_when_absent() {
    let evt = BackupProgressEvent {
        job_id: "job-quiet".into(),
        status: "completed".into(),
        progress: Some(1.0),
        output_line: None,
        error: None,
        warning: None,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"warning\":null"), "{json}");
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
    run_pg_dump(
        &src,
        &dump_opts,
        &PgToolPaths {
            pg_dump: "pg_dump".into(),
            pg_restore: "pg_restore".into(),
            psql: "psql".into(),
        },
    )
    .expect("pg_dump should succeed");

    // --- 2. Restore into target ---
    let restore_opts = RestoreOptions {
        format: "custom".into(),
        file_path: dump_path_str.clone(),
        clean: true,
        schema: None,
    };
    run_pg_restore(
        &tgt,
        &restore_opts,
        &PgToolPaths {
            pg_dump: "pg_dump".into(),
            pg_restore: "pg_restore".into(),
            psql: "psql".into(),
        },
    )
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
    run_db_sync(
        &src,
        &tgt,
        None,
        None,
        &PgToolPaths {
            pg_dump: "pg_dump".into(),
            pg_restore: "pg_restore".into(),
            psql: "psql".into(),
        },
    )
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
    run_pg_dump(
        &src,
        &dump_opts,
        &PgToolPaths {
            pg_dump: "pg_dump".into(),
            pg_restore: "pg_restore".into(),
            psql: "psql".into(),
        },
    )
    .expect("pg_dump (plain) should succeed");

    // --- 2. Restore into target (plain -> psql path) ---
    let restore_opts = RestoreOptions {
        format: "plain".into(),
        file_path: dump_path_str.clone(),
        clean: false,
        schema: None,
    };
    run_pg_restore(
        &tgt,
        &restore_opts,
        &PgToolPaths {
            pg_dump: "pg_dump".into(),
            pg_restore: "pg_restore".into(),
            psql: "psql".into(),
        },
    )
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
    let n: i64 = dst
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 2);
    let blobs: i64 = dst
        .query_row("SELECT COUNT(*) FROM blobs", [], |r| r.get(0))
        .unwrap();
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
    let id: i64 = dst
        .query_row("SELECT id FROM t WHERE v='c'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(id, 3);
}

#[test]
fn sqlite_dump_fail_closed_for_virtual_tables() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch("CREATE VIRTUAL TABLE ft USING fts4(content)")
        .unwrap();
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
    let names: Vec<String> = dst
        .prepare("SELECT name FROM users ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    assert_eq!(names, vec!["Alice".to_string(), "Bob".to_string()]);
}

// ------------------------------------------------------------------
// MySQL dump / restore / sync arg building (Task 2.3)
// ------------------------------------------------------------------

#[test]
fn mysql_dump_args_single_transaction_no_data_routines() {
    let opts = MySqlBackupOptions {
        database: "shop".into(),
        file_path: "/tmp/d.sql".into(),
        single_transaction: true,
        no_data: true,
        routines: true,
        triggers: false,
        events: false,
    };
    let args = build_mysql_dump_args(
        &MySqlConnParams::new("h".into(), 3306, "u".into(), "shop".into(), "p".into()),
        &opts,
        false,
    );
    assert!(args.iter().any(|a| a == "--single-transaction"));
    assert!(args.iter().any(|a| a == "--no-data"));
    assert!(args.iter().any(|a| a == "--routines"));
    // `--databases` is a BOOLEAN flag: the database name must be a separate
    // positional argument. `--databases=shop` is rejected by clients as
    // "invalid value 'shop'".
    let i = args
        .iter()
        .position(|a| a == "--databases")
        .expect("--databases flag");
    assert_eq!(args[i + 1], "shop");
    assert!(
        !args.iter().any(|a| a.starts_with("--databases=")),
        "{args:?}"
    );
    assert!(args.iter().any(|a| a == "--result-file=/tmp/d.sql"));
    // no --password on the command line (uses MYSQL_PWD env)
    assert!(args.iter().all(|a| !a.starts_with("--password")));
}

#[test]
fn mysql_env_uses_mysql_pwd_not_password_arg() {
    let opts = MySqlBackupOptions {
        database: "db".into(),
        file_path: "/tmp/x.sql".into(),
        single_transaction: false,
        no_data: false,
        routines: false,
        triggers: false,
        events: false,
    };
    let args = build_mysql_dump_args(
        &MySqlConnParams::new("h".into(), 3306, "u".into(), "db".into(), "p".into()),
        &opts,
        false,
    );
    assert!(args.iter().all(|a| !a.starts_with("--password")));
}

#[test]
fn mysql_dump_args_omit_column_statistics_for_mariadb_clients() {
    // The bundled client is MariaDB 11.4.5 and rejects the MySQL-8-only option
    // with `unknown option '--skip-column-statistics'`, aborting the dump.
    let opts = MySqlBackupOptions {
        database: "shop".into(),
        file_path: "/tmp/d.sql".into(),
        single_transaction: true,
        no_data: false,
        routines: true,
        triggers: true,
        events: false,
    };
    let conn = MySqlConnParams::new("h".into(), 3306, "u".into(), "shop".into(), "p".into());
    let mariadb = build_mysql_dump_args(&conn, &opts, true);
    assert!(
        !mariadb.iter().any(|a| a == "--skip-column-statistics"),
        "{mariadb:?}"
    );
    let mysql = build_mysql_dump_args(&conn, &opts, false);
    assert!(
        mysql.iter().any(|a| a == "--skip-column-statistics"),
        "{mysql:?}"
    );
}

#[test]
fn mysql_tls_args_map_each_mode_per_client() {
    // MySQL clients speak --ssl-mode.
    assert_eq!(
        mysql_tls_args(false, Some("disable")),
        vec!["--ssl-mode=DISABLED".to_string()]
    );
    assert_eq!(
        mysql_tls_args(false, Some("require")),
        vec!["--ssl-mode=REQUIRED".to_string()]
    );
    assert_eq!(
        mysql_tls_args(false, Some("verify-ca")),
        vec!["--ssl-mode=VERIFY_CA".to_string()]
    );
    assert_eq!(
        mysql_tls_args(false, Some("verify-full")),
        vec!["--ssl-mode=VERIFY_IDENTITY".to_string()]
    );
    // Legacy uppercase form from the pre-fix code path still maps.
    assert_eq!(
        mysql_tls_args(false, Some("REQUIRED")),
        vec!["--ssl-mode=REQUIRED".to_string()]
    );

    // MariaDB clients have no --ssl-mode; --ssl defaults ON, so `require`
    // only needs verification turned off, and verify modes state both flags
    // explicitly (older clients default verification OFF).
    assert_eq!(
        mysql_tls_args(true, Some("disable")),
        vec!["--skip-ssl".to_string()]
    );
    assert_eq!(
        mysql_tls_args(true, Some("require")),
        vec![
            "--ssl".to_string(),
            "--skip-ssl-verify-server-cert".to_string()
        ]
    );
    assert_eq!(
        mysql_tls_args(true, Some("verify-full")),
        vec!["--ssl".to_string(), "--ssl-verify-server-cert".to_string()]
    );

    // No mode at all -> nothing (client default).
    assert!(mysql_tls_args(false, None).is_empty());
    assert!(mysql_tls_args(true, None).is_empty());

    // An unrecognised non-empty mode fails closed to encrypted-but-verified.
    assert_eq!(
        mysql_tls_args(false, Some("bogus")),
        vec!["--ssl-mode=REQUIRED".to_string()]
    );
}

#[test]
fn mysql_sync_dump_args_never_emit_database_creation_or_selection() {
    let source = MySqlConnParams::new(
        "srchost".into(),
        3306,
        "root".into(),
        "source_db".into(),
        "secret".into(),
    );
    let args = build_mysql_sync_dump_args(&source, true, Some("require"));
    // #47: --databases emits CREATE DATABASE + USE, which would redirect the
    // restore into a source-named schema on the target server.
    assert!(
        !args.iter().any(|a| a == "--databases"),
        "must not use --databases: {args:?}"
    );
    assert!(
        !args.iter().any(|a| a.starts_with("--databases=")),
        "must not use --databases=<db>: {args:?}"
    );
    assert_eq!(
        args.last(),
        Some(&"source_db".to_string()),
        "db name goes positionally last"
    );
    assert!(args.iter().any(|a| a == "--single-transaction"));
    assert!(args.iter().any(|a| a == "--add-drop-table"));
    assert!(
        !args.iter().any(|a| a.contains("secret")),
        "password stays in MYSQL_PWD"
    );
}

#[test]
fn mysql_sync_dump_args_omit_column_statistics_for_mariadb_clients() {
    let source = MySqlConnParams::new("h".into(), 3306, "root".into(), "db".into(), "p".into());
    let mariadb = build_mysql_sync_dump_args(&source, true, None);
    assert!(!mariadb.iter().any(|a| a == "--skip-column-statistics"));
    let mysql = build_mysql_sync_dump_args(&source, false, None);
    assert!(mysql.iter().any(|a| a == "--skip-column-statistics"));
}

#[test]
fn mysql_sync_restore_args_target_the_target_database_only() {
    let target = MySqlConnParams::new(
        "tgthost".into(),
        3307,
        "root".into(),
        "target_db".into(),
        "secret".into(),
    );
    let args = mysql_sync_restore_args(&target, false, Some("verify-full"));
    assert!(
        args.iter().any(|a| a == "--database=target_db"),
        "got: {args:?}"
    );
    assert!(args.iter().any(|a| a == "--host=tgthost"));
    assert!(args.iter().any(|a| a == "--port=3307"));
    assert!(args.iter().any(|a| a == "--ssl-mode=VERIFY_IDENTITY"));
    assert!(!args.iter().any(|a| a == "--databases"));
}

#[test]
fn client_is_mariadb_reads_the_version_banner() {
    // A program that cannot be executed must not panic — it reports false
    // (keep the MySQL-only flags), and the dump fails at spawn anyway.
    assert!(!client_is_mariadb("/nonexistent/definitely-not-a-tool"));
}

/// Regression guard for the bundled fallback path: the args we generate must be
/// *accepted* by the real bundled MariaDB client. It spawns the staged binary
/// against a closed port and requires the failure to be a CONNECTION error —
/// never an option-parsing error. No live server needed.
///
/// The binaries are gitignored (the release workflow downloads them), so when
/// they are not staged this test logs loudly and returns instead of failing.
#[test]
fn bundled_mariadb_dump_accepts_our_generated_args() {
    let bundled = std::path::PathBuf::from(format!(
        "{}/resources/mysql_tools",
        env!("CARGO_MANIFEST_DIR")
    ))
    .join(crate::db::tool_resolver::bundled_bin_name("mariadb-dump"));
    if !bundled.is_file() {
        eprintln!(
            "SKIPPED bundled_mariadb_dump_accepts_our_generated_args: {bundled:?} is not staged \
             (run the release workflow's tool-staging step to enable this guard)"
        );
        return;
    }

    let conn = MySqlConnParams::new(
        "127.0.0.1".into(),
        1,
        "root".into(),
        "mysql".into(),
        "unused".into(),
    );
    let opts = MySqlBackupOptions {
        database: "mysql".into(),
        file_path: std::env::temp_dir()
            .join("gridline_args_guard.sql")
            .to_string_lossy()
            .to_string(),
        single_transaction: true,
        no_data: false,
        routines: true,
        triggers: true,
        events: false,
    };
    assert!(
        client_is_mariadb(bundled.to_str().unwrap()),
        "the bundled dump tool must be MariaDB's"
    );

    let mut args = build_mysql_dump_args(&conn, &opts, true);
    args.extend(mysql_tls_args(true, Some("require")));

    let out = std::process::Command::new(&bundled)
        .args(&args)
        .output()
        .unwrap();
    let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
    // "unknown option" covers `--skip-column-statistics`; "unknown variable"
    // covers `--ssl-mode` (MariaDB's own wording for the same class of mistake).
    assert!(
        !err.contains("unknown option"),
        "bundled client rejected an option: {err}"
    );
    assert!(
        !err.contains("unknown variable"),
        "bundled client rejected an option: {err}"
    );
    assert!(
        !err.contains("invalid value"),
        "bundled client rejected an option value: {err}"
    );
    assert!(
        err.contains("2002") || err.contains("can't connect") || err.contains("connection refused"),
        "expected a connection failure (port 1 is closed), got: {err}"
    );
}

// ── native MySQL restore: error reporting contract ──────────────────

#[test]
fn restore_failure_names_the_statement_position() {
    // The user must be able to find the offending statement in their file.
    let err = format_restore_statement_error(3, 10, "syntax error near 'CREAT'");
    assert_eq!(err, "Statement 3 of 10 failed: syntax error near 'CREAT'");
}

#[test]
fn restore_progress_total_counts_the_clean_phase() {
    // clean adds one progress unit (the drop phase) so the bar never resets.
    assert_eq!(restore_progress_total(5, false), 5);
    assert_eq!(restore_progress_total(5, true), 6);
}

#[tokio::test]
#[ignore]
async fn mysql_native_restore_applies_a_script_and_honours_clean() {
    use sqlx::ConnectOptions;
    use sqlx::Connection;

    let host = match std::env::var("GRIDLINE_TEST_MYSQL_HOST") {
        Ok(v) => v,
        Err(_) => return,
    };
    let port: u16 = std::env::var("GRIDLINE_TEST_MYSQL_PORT")
        .unwrap_or_else(|_| "3306".into())
        .parse()
        .unwrap();
    let user = std::env::var("GRIDLINE_TEST_MYSQL_USER").unwrap_or_else(|_| "root".into());
    let pass = std::env::var("GRIDLINE_TEST_MYSQL_PASS").unwrap_or_default();
    let db = match std::env::var("GRIDLINE_TEST_MYSQL_DB") {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut conn = sqlx::mysql::MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&user)
        .password(&pass)
        .database(&db)
        .ssl_mode(sqlx::mysql::MySqlSslMode::Disabled)
        .disable_statement_logging()
        .connect()
        .await
        .expect("connect");

    // Scratch table, removed again at the end, so the live DB is never harmed.
    let table = "gl_restore_probe";
    sqlx::query(&format!("DROP TABLE IF EXISTS `{db}`.`{table}`"))
        .execute(&mut conn)
        .await
        .expect("pre-clean");

    let script = format!(
        "CREATE TABLE `{table}` (id INT PRIMARY KEY, name VARCHAR(20));\n\
         INSERT INTO `{table}` VALUES (1, 'first');"
    );
    let statements = crate::db::sql_split::split_statements(&script);

    let mut events: Vec<(usize, usize)> = Vec::new();
    let mut on_progress = |done: usize, total: usize| events.push((done, total));
    let never = || false;

    run_mysql_restore_on(
        &mut conn,
        MySqlRestoreRun {
            database: &db,
            statements: &statements,
            clean: true,
        },
        &mut on_progress,
        &never,
    )
    .await
    .expect("first restore");

    let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM `{db}`.`{table}`"))
        .fetch_one(&mut conn)
        .await
        .expect("count");
    assert_eq!(count, 1);
    assert_eq!(
        events.last().copied(),
        Some((statements.len() + 1, statements.len() + 1))
    );

    // Second run with clean: the table must be dropped and recreated, so the
    // insert cannot collide with the existing primary key.
    let mut events2: Vec<(usize, usize)> = Vec::new();
    let mut on_progress2 = |done: usize, total: usize| events2.push((done, total));
    run_mysql_restore_on(
        &mut conn,
        MySqlRestoreRun {
            database: &db,
            statements: &statements,
            clean: true,
        },
        &mut on_progress2,
        &never,
    )
    .await
    .expect("clean restore must not hit a duplicate key");

    let count2: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM `{db}`.`{table}`"))
        .fetch_one(&mut conn)
        .await
        .expect("count2");
    assert_eq!(count2, 1, "clean restore must replace, not append");

    // A statement that cannot succeed must fail and name its position.
    let bad =
        crate::db::sql_split::split_statements("SELECT 1;\nSELECT * FROM gl_no_such_table_xyz;");
    let mut noop = |_: usize, _: usize| {};
    let err = run_mysql_restore_on(
        &mut conn,
        MySqlRestoreRun {
            database: &db,
            statements: &bad,
            clean: false,
        },
        &mut noop,
        &never,
    )
    .await
    .expect_err("must fail");
    assert!(err.starts_with("Statement 2 of 2 failed:"), "got {err:?}");

    let _ = conn.close().await;
    let mut cleanup = sqlx::mysql::MySqlConnectOptions::new()
        .host(&host)
        .port(port)
        .username(&user)
        .password(&pass)
        .database(&db)
        .ssl_mode(sqlx::mysql::MySqlSslMode::Disabled)
        .disable_statement_logging()
        .connect()
        .await
        .expect("reconnect");
    sqlx::query(&format!("DROP TABLE IF EXISTS `{db}`.`{table}`"))
        .execute(&mut cleanup)
        .await
        .expect("cleanup");
    let _ = cleanup.close().await;
}

// ── restore file-size cap ───────────────────────────────────────────

#[test]
fn restore_size_cap_accepts_a_file_at_the_limit() {
    assert!(check_restore_file_size(MAX_RESTORE_FILE_BYTES, MAX_RESTORE_FILE_BYTES).is_ok());
}

#[test]
fn restore_size_cap_rejects_a_file_over_the_limit_and_states_both_sizes() {
    let err = check_restore_file_size(MAX_RESTORE_FILE_BYTES + 1, MAX_RESTORE_FILE_BYTES)
        .expect_err("must reject");
    assert!(
        err.contains("100 MB"),
        "error must state the limit in MB; got {err:?}"
    );
    assert!(
        err.contains("MB"),
        "error must state the actual size in MB; got {err:?}"
    );
}

// ── live MySQL dump: system tool vs. bundled tool ───────────────────
//
// Issue #44: the app reported "mysqldump not found" even with MySQL
// client tools installed. These two #[ignore]d tests exercise the real
// `run_mysql_dump` against a live server — once via a tool the shared
// resolver found as a *system* client, once via the *bundled* MariaDB
// client — so both provenance paths are covered end to end.
//
// Run with:
//
//   GRIDLINE_TEST_MYSQL_HOST=... GRIDLINE_TEST_MYSQL_PORT=... \
//   GRIDLINE_TEST_MYSQL_USER=... GRIDLINE_TEST_MYSQL_DB=... \
//   GRIDLINE_TEST_MYSQL_PASSWORD=... \
//   cargo test --lib live_mysql_dump -- --ignored --nocapture

fn mysql_conn_from_env(prefix: &str) -> MySqlConnParams {
    MySqlConnParams::new(
        env(&format!("{prefix}_HOST")),
        env(&format!("{prefix}_PORT")).parse().unwrap(),
        env(&format!("{prefix}_USER")),
        env(&format!("{prefix}_DB")),
        env(&format!("{prefix}_PASSWORD")),
    )
}

fn live_mysql_dump_opts(conn: &MySqlConnParams, file_name: &str) -> MySqlBackupOptions {
    MySqlBackupOptions {
        database: conn.database.clone(),
        file_path: std::env::temp_dir()
            .join(file_name)
            .to_string_lossy()
            .to_string(),
        single_transaction: true,
        no_data: false,
        routines: true,
        triggers: true,
        events: false,
    }
}

/// Requires GRIDLINE_TEST_MYSQL_{HOST,PORT,USER,DB,PASSWORD} and a system
/// mariadb-dump/mysqldump on this machine.
#[test]
#[ignore]
fn live_mysql_dump_with_a_system_tool() {
    let conn = mysql_conn_from_env("GRIDLINE_TEST_MYSQL");
    let opts = live_mysql_dump_opts(&conn, "gridline_live_mysql_system.sql");
    let req = crate::db::tool_resolver::mysql_dump_request();
    let trusted = crate::db::tool_resolver::trusted_dirs();
    let resolved = crate::db::tool_resolver::resolve_with(
        &req,
        &trusted,
        &crate::db::tool_resolver::path_lookup,
        None,
        crate::db::tool_resolver::probe,
    )
    .expect("no system mariadb-dump/mysqldump resolved");
    eprintln!(
        "resolved: {} ({})",
        resolved.program,
        resolved.source.as_str()
    );
    let tools = MySqlToolPaths {
        mysqldump: resolved.program.clone(),
        mysql: resolved.program.clone(),
    };
    run_mysql_dump(&conn, &opts, &tools, None).expect("dump failed");
    let len = std::fs::metadata(&opts.file_path).unwrap().len();
    assert!(len > 0, "dump file is empty");
    let _ = std::fs::remove_file(&opts.file_path);
}

/// Requires GRIDLINE_TEST_MYSQL_* and a staged `resources/mysql_tools` tree.
#[test]
#[ignore]
fn live_mysql_dump_with_the_bundled_tool() {
    let conn = mysql_conn_from_env("GRIDLINE_TEST_MYSQL");
    let opts = live_mysql_dump_opts(&conn, "gridline_live_mysql_bundled.sql");
    let bundled = std::path::PathBuf::from(format!(
        "{}/resources/mysql_tools",
        env!("CARGO_MANIFEST_DIR")
    ))
    .join(crate::db::tool_resolver::bundled_bin_name("mariadb-dump"));
    assert!(
        bundled.is_file(),
        "bundled mariadb-dump not staged at {bundled:?}"
    );
    assert!(
        crate::db::tool_resolver::probe(&bundled),
        "bundled mariadb-dump does not run"
    );
    let tools = MySqlToolPaths {
        mysqldump: bundled.to_string_lossy().to_string(),
        mysql: bundled.to_string_lossy().to_string(),
    };
    run_mysql_dump(&conn, &opts, &tools, None).expect("bundled dump failed");
    let len = std::fs::metadata(&opts.file_path).unwrap().len();
    assert!(len > 0, "bundled dump file is empty");
    let _ = std::fs::remove_file(&opts.file_path);
}

// ------------------------------------------------------------------
// Stop-at-first-error arg shapes (issue #49)
// ------------------------------------------------------------------

#[test]
fn psql_restore_args_stop_on_error_and_ignore_psqlrc() {
    let conn = PgConnParams::new(
        "localhost".into(),
        5432,
        "postgres".into(),
        "app".into(),
        "secret".into(),
    );
    let args = build_psql_restore_args(&conn, "/tmp/dump.sql");
    assert!(
        args.iter().any(|a| a == "--no-psqlrc"),
        "missing --no-psqlrc: {args:?}"
    );
    assert!(args.iter().any(|a| a == "-v"), "missing -v: {args:?}");
    assert!(
        args.iter().any(|a| a == "ON_ERROR_STOP=1"),
        "missing ON_ERROR_STOP=1: {args:?}"
    );
    assert!(
        args.iter().any(|a| a == "--file=/tmp/dump.sql"),
        "missing --file: {args:?}"
    );
    // -v must be immediately followed by its value or psql mis-parses it.
    let v_pos = args.iter().position(|a| a == "-v").unwrap();
    assert_eq!(args[v_pos + 1], "ON_ERROR_STOP=1");
    assert!(
        !args.iter().any(|a| a.contains("secret")),
        "password must never be in argv"
    );
}

#[test]
fn pg_restore_args_include_exit_on_error() {
    let conn = PgConnParams::new(
        "localhost".into(),
        5432,
        "postgres".into(),
        "app".into(),
        "secret".into(),
    );
    let options = RestoreOptions {
        format: "custom".into(),
        file_path: "/tmp/dump.bak".into(),
        clean: true,
        schema: None,
    };
    let args = build_restore_args(&conn, &options);
    assert!(
        args.iter().any(|a| a == "--exit-on-error"),
        "missing --exit-on-error: {args:?}"
    );
    assert!(args.iter().any(|a| a == "--clean"));
    assert!(args.iter().any(|a| a == "--if-exists"));
    assert!(args.iter().any(|a| a == "--format=c"));
}

#[test]
fn pg_sync_restore_args_stop_on_error_and_keep_clean() {
    let target = PgConnParams::new(
        "targethost".into(),
        5432,
        "postgres".into(),
        "targetdb".into(),
        "secret".into(),
    );
    let args = build_pg_sync_restore_args(&target);
    assert!(
        args.iter().any(|a| a == "--exit-on-error"),
        "missing --exit-on-error: {args:?}"
    );
    assert!(args.iter().any(|a| a == "--clean"));
    assert!(args.iter().any(|a| a == "--if-exists"));
    assert!(args.iter().any(|a| a == "--no-owner"));
    assert!(
        args.iter().any(|a| a == "--dbname=targetdb"),
        "must target the TARGET db: {args:?}"
    );
}

// ------------------------------------------------------------------
// Atomic SQLite restore (issue #48)
// ------------------------------------------------------------------

/// #48 repro: a malformed dump must not destroy the existing target.
#[test]
fn sqlite_restore_rolls_back_a_malformed_dump() {
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch(
        "CREATE TABLE preserved (id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO preserved VALUES (1,'keep');",
    )
    .unwrap();

    let err = restore_sqlite(
        &dst,
        "BEGIN; CREATE TABLE replacement (id INTEGER); THIS IS NOT SQL; COMMIT;",
        true,
    )
    .unwrap_err();
    assert!(err.contains("failed"), "got: {err}");

    let mut objects: Vec<String> = dst
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    objects.sort();
    assert_eq!(
        objects,
        vec!["preserved".to_string()],
        "clean phase must roll back"
    );
    let rows: i64 = dst
        .query_row("SELECT COUNT(*) FROM preserved", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1);
}

#[test]
fn sqlite_restore_rolls_back_a_failing_middle_statement() {
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch("CREATE TABLE preserved (id INTEGER);")
        .unwrap();

    let err = restore_sqlite(
        &dst,
        "CREATE TABLE before_error (id INTEGER);\nSELECT * FROM missing_table;",
        true,
    )
    .unwrap_err();
    assert!(err.starts_with("Statement 2 of 2 failed"), "got: {err}");

    let leaked: i64 = dst
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='before_error'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(leaked, 0, "earlier statements must roll back too");
    let preserved: i64 = dst
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='preserved'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(preserved, 1);
}

#[test]
fn sqlite_restore_rejects_statements_that_cannot_run_in_a_transaction() {
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch("CREATE TABLE preserved (id INTEGER);")
        .unwrap();
    for dump in [
        "VACUUM;",
        "ATTACH DATABASE '/tmp/gridline_other.db' AS aux;",
        "DETACH DATABASE aux;",
    ] {
        let err = restore_sqlite(&dst, dump, true).unwrap_err();
        assert!(
            err.contains("cannot run inside the restore transaction"),
            "{dump} -> {err}"
        );
    }
    let preserved: i64 = dst
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='preserved'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(preserved, 1, "rejection must happen before any mutation");
}

#[test]
fn sqlite_restore_rejects_a_dump_with_no_statements() {
    let dst = Connection::open_in_memory().unwrap();
    assert_eq!(
        restore_sqlite(&dst, "", false).unwrap_err(),
        "restore found no SQL statements"
    );
    assert_eq!(
        restore_sqlite(&dst, "/* nothing */\n-- nothing\n", false).unwrap_err(),
        "restore found no SQL statements"
    );
}

#[test]
fn sqlite_restore_restores_the_foreign_keys_pragma_on_every_path() {
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE t (id INTEGER);")
        .unwrap();

    restore_sqlite(&dst, "CREATE TABLE u (id INTEGER);", false).unwrap();
    let fk: i64 = dst
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign_keys must be restored after success");

    let _ = restore_sqlite(&dst, "THIS IS NOT SQL;", false).unwrap_err();
    let fk: i64 = dst
        .pragma_query_value(None, "foreign_keys", |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign_keys must be restored after failure");
}

#[test]
fn sqlite_restore_keeps_views_and_indexes_on_a_clean_restore() {
    let src = seed_sqlite();
    let mut buf = Vec::new();
    dump_sqlite_to(&src, &mut Cursor::new(&mut buf), |_| {}).unwrap();
    let text = String::from_utf8(buf).unwrap();

    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch(
        "CREATE TABLE stale (id INTEGER);
         CREATE VIEW stale_view AS SELECT 1 AS one;
         INSERT INTO stale VALUES (1);",
    )
    .unwrap();

    restore_sqlite(&dst, &text, true).unwrap();

    let mut names: Vec<String> = dst
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    names.sort();
    assert_eq!(names, vec!["blobs".to_string(), "users".to_string()]);
    let indexes: i64 = dst
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='users_name'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(indexes, 1, "the dump's index must be recreated");
    let stale_view: i64 = dst
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='stale_view'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(stale_view, 0, "clean restore replaces the view too");
}

// ------------------------------------------------------------------
// MySQL sync failure propagation (#47 repro, needs no server)
// ------------------------------------------------------------------

/// Write an executable shell script and return its path.
#[cfg(unix)]
fn write_fake_tool(dir: &std::path::Path, name: &str, body: &str) -> String {
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt as _;
    let path = dir.join(name);
    let mut file = std::fs::File::create(&path).unwrap();
    file.write_all(body.as_bytes()).unwrap();
    file.flush().unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();
    path.to_string_lossy().to_string()
}

#[cfg(unix)]
fn sync_temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("gridline_{tag}_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(unix)]
fn sync_params(database: &str) -> MySqlConnParams {
    MySqlConnParams::new(
        "h".into(),
        3306,
        "root".into(),
        database.into(),
        "secret".into(),
    )
}

/// #47: a failing dump must fail the sync even when the restore exits 0.
#[cfg(unix)]
#[test]
fn mysql_sync_fails_when_the_dump_fails_even_if_the_restore_succeeds() {
    let dir = sync_temp_dir("sync_dumpfail");
    let dump = write_fake_tool(&dir, "mariadb-dump", "#!/bin/sh\nexit 1\n");
    let restore = write_fake_tool(&dir, "mariadb", "#!/bin/sh\ncat >/dev/null\nexit 0\n");
    let tools = MySqlToolPaths {
        mysqldump: dump,
        mysql: restore,
    };

    let err = run_mysql_sync(
        &sync_params("source_db"),
        &sync_params("target_db"),
        &tools,
        None,
        None,
    )
    .unwrap_err();

    assert!(err.starts_with("dump failed"), "got: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The dump's stderr must reach the user — swallowing it makes the failure
/// undiagnosable.
#[cfg(unix)]
#[test]
fn mysql_sync_surfaces_the_dump_error_output() {
    let dir = sync_temp_dir("sync_dumpstderr");
    let dump = write_fake_tool(
        &dir,
        "mariadb-dump",
        "#!/bin/sh\necho 'boom: access denied' >&2\nexit 2\n",
    );
    let restore = write_fake_tool(&dir, "mariadb", "#!/bin/sh\ncat >/dev/null\nexit 0\n");
    let tools = MySqlToolPaths {
        mysqldump: dump,
        mysql: restore,
    };

    let err = run_mysql_sync(
        &sync_params("source_db"),
        &sync_params("target_db"),
        &tools,
        None,
        None,
    )
    .unwrap_err();

    assert!(err.contains("boom: access denied"), "got: {err}");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The happy path must still report success.
#[cfg(unix)]
#[test]
fn mysql_sync_succeeds_when_both_processes_succeed() {
    let dir = sync_temp_dir("sync_ok");
    let dump = write_fake_tool(
        &dir,
        "mariadb-dump",
        "#!/bin/sh\necho 'CREATE TABLE t (id INT);'\nexit 0\n",
    );
    let restore = write_fake_tool(&dir, "mariadb", "#!/bin/sh\ncat >/dev/null\nexit 0\n");
    let tools = MySqlToolPaths {
        mysqldump: dump,
        mysql: restore,
    };

    run_mysql_sync(
        &sync_params("source_db"),
        &sync_params("target_db"),
        &tools,
        None,
        None,
    )
    .unwrap();

    let _ = std::fs::remove_dir_all(&dir);
}
