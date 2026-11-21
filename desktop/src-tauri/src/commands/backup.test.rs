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
        pg_dump_probe_error: None,
        pg_restore_probe_error: None,
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

// ------------------------------------------------------------------
// SQLite dump destination safety (ticket 32)
// ------------------------------------------------------------------

/// Every temporary sibling a dump left behind in `dir` (it must leave none).
fn partial_siblings(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".gridline-partial-"))
        .collect()
}

fn write_seed_db(path: &std::path::Path) {
    let conn = Connection::open(path).unwrap();
    conn.execute_batch(
        "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
         INSERT INTO items (name) VALUES ('one'),('two');",
    )
    .unwrap();
}

/// Dumping onto the database being read would truncate it. The refusal is by
/// resolved file identity, not by comparing strings.
#[test]
fn sqlite_dump_refuses_the_connection_file_as_its_destination() {
    let dir = job_temp_dir("sqlite_dump_self");
    let db = dir.join("app.db");
    write_seed_db(&db);
    let before = std::fs::read(&db).unwrap();

    let err = dump_sqlite_to_path(db.to_str().unwrap(), db.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("same file") || err.to_lowercase().contains("source database"),
        "the refusal must say why, got: {err}"
    );
    assert_eq!(
        before,
        std::fs::read(&db).unwrap(),
        "the source database must be untouched"
    );
    assert!(
        partial_siblings(&dir).is_empty(),
        "a refused dump leaves nothing behind"
    );

    // The same file spelled differently is still the same file.
    let spelled = dir.join(".").join("app.db");
    assert!(dump_sqlite_to_path(db.to_str().unwrap(), spelled.to_str().unwrap()).is_err());
    assert_eq!(before, std::fs::read(&db).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}

/// A symlink to the source resolves to the source, so `File::create`-style
/// writes through it would truncate the database.
#[test]
#[cfg(unix)]
fn sqlite_dump_refuses_a_symlinked_destination_that_names_the_source() {
    let dir = job_temp_dir("sqlite_dump_symlink");
    let db = dir.join("app.db");
    write_seed_db(&db);
    let before = std::fs::read(&db).unwrap();
    let link = dir.join("backup.sql");
    std::os::unix::fs::symlink(&db, &link).unwrap();

    let err = dump_sqlite_to_path(db.to_str().unwrap(), link.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("same file") || err.to_lowercase().contains("source database"),
        "got: {err}"
    );
    assert_eq!(before, std::fs::read(&db).unwrap());
    assert!(
        std::fs::symlink_metadata(&link).is_ok_and(|m| m.file_type().is_symlink()),
        "the symlink itself must not be replaced by the dump"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A hard link has a different path but the same identity.
#[test]
fn sqlite_dump_refuses_a_hard_link_to_the_source() {
    let dir = job_temp_dir("sqlite_dump_hardlink");
    let db = dir.join("app.db");
    write_seed_db(&db);
    let before = std::fs::read(&db).unwrap();
    let link = dir.join("backup.sql");
    std::fs::hard_link(&db, &link).unwrap();

    let err = dump_sqlite_to_path(db.to_str().unwrap(), link.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("same file") || err.to_lowercase().contains("source database"),
        "got: {err}"
    );
    assert_eq!(before, std::fs::read(&db).unwrap());
    assert_eq!(before, std::fs::read(&link).unwrap());
    let _ = std::fs::remove_dir_all(&dir);
}

/// Output is written to a temporary sibling and published by rename, so a dump
/// that fails takes nothing with it: the prior destination stays byte-identical
/// and no partial sibling survives.
#[test]
fn a_failed_sqlite_dump_leaves_the_existing_destination_intact() {
    let dir = job_temp_dir("sqlite_dump_failed");
    let db = dir.join("app.db");
    // Fails mid-dump (virtual tables are refused before any row is written).
    let src = Connection::open(&db).unwrap();
    src.execute_batch(
        "CREATE TABLE keep (id INTEGER);
         INSERT INTO keep VALUES (1);
         CREATE VIRTUAL TABLE ft USING fts4(content);",
    )
    .unwrap();
    drop(src);

    let dest = dir.join("backup.sql");
    std::fs::write(&dest, b"PRIOR BACKUP\n").unwrap();

    let err = dump_sqlite_to_path(db.to_str().unwrap(), dest.to_str().unwrap()).unwrap_err();
    assert!(err.to_lowercase().contains("virtual table"), "got: {err}");
    assert_eq!(
        b"PRIOR BACKUP\n".to_vec(),
        std::fs::read(&dest).unwrap(),
        "a failed dump must not touch the existing destination"
    );
    assert!(
        partial_siblings(&dir).is_empty(),
        "a failed dump must not leave partial output: {:?}",
        partial_siblings(&dir)
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A cancelled dump is a failed dump: no partial artifact, prior file intact.
#[test]
fn a_cancelled_sqlite_dump_publishes_nothing() {
    let dir = job_temp_dir("sqlite_dump_cancel_publish");
    let db = dir.join("app.db");
    write_seed_db(&db);
    let dest = dir.join("backup.sql");
    std::fs::write(&dest, b"PRIOR BACKUP\n").unwrap();

    let err = dump_sqlite_to_path_cancellable(
        db.to_str().unwrap(),
        dest.to_str().unwrap(),
        |_| {},
        &|| true,
    )
    .unwrap_err();
    assert_eq!(err, CANCEL_MESSAGE);
    assert_eq!(b"PRIOR BACKUP\n".to_vec(), std::fs::read(&dest).unwrap());
    assert!(partial_siblings(&dir).is_empty(), "no partial output");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The successful path publishes exactly one file: the destination.
#[test]
fn a_successful_sqlite_dump_replaces_the_destination_and_leaves_no_partial() {
    let dir = job_temp_dir("sqlite_dump_publish");
    let db = dir.join("app.db");
    write_seed_db(&db);
    let dest = dir.join("backup.sql");
    std::fs::write(&dest, b"PRIOR BACKUP\n").unwrap();

    dump_sqlite_to_path(db.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
    let text = std::fs::read_to_string(&dest).unwrap();
    assert!(
        !text.contains("PRIOR BACKUP"),
        "the destination is replaced"
    );
    assert!(text.contains("CREATE TABLE items"), "got: {text}");
    assert!(partial_siblings(&dir).is_empty(), "no partial output left");

    // Independent check: the published file restores to the original rows.
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    let names: Vec<String> = dst
        .prepare("SELECT name FROM items ORDER BY id")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(names, vec!["one".to_string(), "two".to_string()]);
    let _ = std::fs::remove_dir_all(&dir);
}

/// Every table in one dump must come from one point in time. A writer that
/// commits between two tables must not be visible in the same dump: the dump is
/// taken from a single read transaction, so either all tables have the old value
/// or all have the new one.
#[test]
fn a_sqlite_dump_reads_every_table_from_one_snapshot() {
    let dir = job_temp_dir("sqlite_dump_snapshot");
    let db = dir.join("app.db");
    // WAL, so the concurrent writer is not blocked by the dump's read lock and
    // the test actually offers the dump a newer committed state mid-run.
    {
        let seed = Connection::open(&db).unwrap();
        seed.pragma_update(None, "journal_mode", "WAL").unwrap();
        seed.execute_batch(
            "CREATE TABLE a (v INTEGER);
             CREATE TABLE b (v INTEGER);
             INSERT INTO a VALUES (0);
             INSERT INTO b VALUES (0);",
        )
        .unwrap();
    }

    let writer = Connection::open(&db).unwrap();
    writer
        .busy_timeout(std::time::Duration::from_secs(5))
        .unwrap();

    let src = Connection::open(&db).unwrap();
    let mut buf: Vec<u8> = Vec::new();
    let mut wrote = false;
    dump_sqlite_to(&src, &mut Cursor::new(&mut buf), |table| {
        // Progress for `b` fires after `a`'s rows are already in the dump and
        // before `b` is read: exactly the torn middle the snapshot must cover.
        if table == "b" && !wrote {
            wrote = true;
            writer
                .execute_batch("UPDATE a SET v = 1; UPDATE b SET v = 1;")
                .expect("the concurrent writer must not be blocked mid-dump");
        }
    })
    .unwrap();
    assert!(wrote, "the midway commit must have happened");

    let text = String::from_utf8(buf).unwrap();
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    let a: i64 = dst.query_row("SELECT v FROM a", [], |r| r.get(0)).unwrap();
    let b: i64 = dst.query_row("SELECT v FROM b", [], |r| r.get(0)).unwrap();
    assert_eq!(
        (a, b),
        (0, 0),
        "both tables must reflect one point in time, not a torn read"
    );

    // The writer's own view proves the commit really happened.
    let live: i64 = writer
        .query_row("SELECT v FROM b", [], |r| r.get(0))
        .unwrap();
    assert_eq!(live, 1);
    drop(src);
    let _ = std::fs::remove_dir_all(&dir);
}

/// A metadata row the dump cannot decode must fail the dump. Skipping it would
/// publish a backup that is silently missing a table.
#[test]
fn sqlite_dump_fails_instead_of_dropping_a_table_it_cannot_decode() {
    let dir = job_temp_dir("sqlite_dump_metadata_decode");
    let db = dir.join("app.db");
    // A table whose name (and schema text) is not valid UTF-8: SQLite stores and
    // reads it happily, but it cannot be spelled in the dump's SQL text, and a
    // naive `get::<String>` decode is the only place that notices.
    let name: &[u8] = b"bad\xff";
    let create: &[u8] = b"CREATE TABLE \"bad\xff\" (id INTEGER)";
    {
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE good (id INTEGER); INSERT INTO good VALUES (1);")
            .unwrap();
        conn.execute_batch("PRAGMA writable_schema=ON;").unwrap();
        conn.execute(
            "UPDATE sqlite_master SET name=CAST(?1 AS TEXT), tbl_name=CAST(?1 AS TEXT), \
             sql=CAST(?2 AS TEXT) WHERE name='good'",
            rusqlite::params![name, create],
        )
        .unwrap();
        conn.execute_batch("PRAGMA writable_schema=OFF; PRAGMA schema_version=99;")
            .unwrap();
    }

    let dest = dir.join("backup.sql");
    std::fs::write(&dest, b"PRIOR BACKUP\n").unwrap();
    let err = dump_sqlite_to_path(db.to_str().unwrap(), dest.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("decode"),
        "the failure must name the decode step, got: {err}"
    );
    assert_eq!(
        b"PRIOR BACKUP\n".to_vec(),
        std::fs::read(&dest).unwrap(),
        "a failed dump must not publish partial output"
    );
    assert!(partial_siblings(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

/// `(typeof, hex)` per row: what SQLite says the storage class and exact bytes
/// are, read by SQLite itself rather than derived by the code under test.
fn sqlite_storage_and_bytes(conn: &Connection, sql: &str) -> Vec<(String, String)> {
    conn.prepare(sql)
        .unwrap()
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            ))
        })
        .unwrap()
        .map(|r| r.unwrap())
        .collect()
}

fn sqlite_roundtrip(src: &Connection) -> String {
    let mut buf: Vec<u8> = Vec::new();
    dump_sqlite_to(src, &mut Cursor::new(&mut buf), |_| {}).unwrap();
    String::from_utf8(buf).expect("the dump must stay valid UTF-8 so it can be replayed")
}

fn sqlite_pragma_i64(conn: &Connection, name: &str) -> i64 {
    conn.pragma_query_value(None, name, |r| r.get(0)).unwrap()
}

/// TEXT that is not valid UTF-8 cannot be spelled in a quoted SQL literal, and
/// `String::from_utf8_lossy` would silently rewrite it. The dump uses
/// `CAST(X'…' AS TEXT)`, which restores the exact bytes as TEXT.
#[test]
fn sqlite_dump_preserves_invalid_utf8_text_losslessly() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
         INSERT INTO t VALUES (1, CAST(X'8041FF' AS TEXT));
         INSERT INTO t VALUES (2, CAST(X'00FF' AS TEXT));
         INSERT INTO t VALUES (3, 'plain ''quoted''');",
    )
    .unwrap();
    let before = sqlite_storage_and_bytes(&src, "SELECT typeof(v), hex(v) FROM t ORDER BY id");
    // The fixture really is invalid UTF-8 / NUL-bearing text, not plain ASCII.
    assert_eq!(before[0].0, "text");
    assert_eq!(before[0].1, "8041FF");
    assert_eq!(before[1].1, "00FF");

    let text = sqlite_roundtrip(&src);
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    let after = sqlite_storage_and_bytes(&dst, "SELECT typeof(v), hex(v) FROM t ORDER BY id");
    assert_eq!(
        before, after,
        "invalid-UTF8 and NUL-bearing TEXT must survive byte-for-byte as TEXT"
    );
}

/// BLOBs, including embedded NULs and high bytes, are hex literals — never a
/// text conversion.
#[test]
fn sqlite_dump_preserves_blobs_including_embedded_nuls() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch(
        "CREATE TABLE t (id INTEGER PRIMARY KEY, v BLOB);
         INSERT INTO t VALUES (1, X'00010200FF');
         INSERT INTO t VALUES (2, X'00');
         INSERT INTO t VALUES (3, X'');",
    )
    .unwrap();
    let before = sqlite_storage_and_bytes(&src, "SELECT typeof(v), hex(v) FROM t ORDER BY id");
    assert_eq!(before[0], ("blob".to_string(), "00010200FF".to_string()));

    let text = sqlite_roundtrip(&src);
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    assert_eq!(
        before,
        sqlite_storage_and_bytes(&dst, "SELECT typeof(v), hex(v) FROM t ORDER BY id"),
        "BLOBs must survive byte-for-byte as BLOBs"
    );
}

/// REALs must not be textualised, re-read as INTEGER, or lose their sign.
/// SQLite stores ±Infinity, so a dump that cannot express them is lossy; NaN is
/// not storable (SQLite stores NaN as NULL), which both sides must agree on.
#[test]
fn sqlite_dump_preserves_reals_including_non_finite_values() {
    let expected = [
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::MAX,
        f64::MIN_POSITIVE,
        1e-320,
        0.1 + 0.2,
        -0.0,
        1.0 / 3.0,
        f64::NAN,
    ];
    let src = Connection::open_in_memory().unwrap();
    // No declared type, so no affinity can convert a REAL into an INTEGER.
    src.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, v)")
        .unwrap();
    {
        let mut insert = src
            .prepare("INSERT INTO t (id, v) VALUES (?1, ?2)")
            .unwrap();
        for (id, value) in expected.iter().enumerate() {
            insert
                .execute(rusqlite::params![id as i64, *value])
                .unwrap();
        }
    }

    let text = sqlite_roundtrip(&src);
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();

    let read = |conn: &Connection| -> Vec<(String, Option<f64>)> {
        conn.prepare("SELECT typeof(v), v FROM t ORDER BY id")
            .unwrap()
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    let after = read(&dst);
    let before = read(&src);
    for (index, expected) in expected.iter().enumerate() {
        assert_eq!(
            before[index].0, after[index].0,
            "storage class changed for value {index}"
        );
        match after[index].1 {
            Some(actual) => assert_eq!(
                actual.to_bits(),
                expected.to_bits(),
                "value {index} must round-trip bit-for-bit ({expected})"
            ),
            None => assert!(
                expected.is_nan(),
                "value {index} ({expected}) came back as NULL"
            ),
        }
    }
    // SQLite's own rule, unchanged by the dump: NaN is stored as NULL.
    assert_eq!(after[expected.len() - 1].0, "null");
}

/// `user_version` and `application_id` live in the file header, not in any
/// CREATE statement: a dump that omits them silently resets an application's
/// schema versioning, and the restore has to replay exactly these two pragmas.
#[test]
fn sqlite_dump_round_trips_user_version_and_application_id() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch(
        "CREATE TABLE t (id INTEGER);
         INSERT INTO t VALUES (1);
         PRAGMA user_version = 7;
         PRAGMA application_id = 4660;",
    )
    .unwrap();
    assert_eq!(sqlite_pragma_i64(&src, "user_version"), 7);

    let text = sqlite_roundtrip(&src);
    assert!(
        text.contains("PRAGMA user_version = 7;"),
        "the dump must carry user_version: {text}"
    );
    assert!(
        text.contains("PRAGMA application_id = 4660;"),
        "the dump must carry application_id: {text}"
    );

    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();
    assert_eq!(sqlite_pragma_i64(&dst, "user_version"), 7);
    assert_eq!(sqlite_pragma_i64(&dst, "application_id"), 4660);
}

/// The header pragmas are replayed; every other pragma stays a local setting of
/// the target (replaying `journal_mode` from another machine is how a restore
/// breaks a database).
#[test]
fn sqlite_restore_replays_only_the_round_trip_pragmas() {
    let dst = Connection::open_in_memory().unwrap();
    dst.execute_batch("CREATE TABLE keep (id INTEGER); INSERT INTO keep VALUES (1);")
        .unwrap();
    let before_mode: String = dst
        .pragma_query_value(None, "journal_mode", |r| r.get(0))
        .unwrap();

    let dump = "PRAGMA journal_mode = MEMORY;\n\
                PRAGMA user_version = 3;\n\
                PRAGMA application_id = 9;\n\
                CREATE TABLE t (id INTEGER);\n";
    restore_sqlite(&dst, dump, false).unwrap();

    assert_eq!(sqlite_pragma_i64(&dst, "user_version"), 3);
    assert_eq!(sqlite_pragma_i64(&dst, "application_id"), 9);
    let after_mode: String = dst
        .pragma_query_value(None, "journal_mode", |r| r.get(0))
        .unwrap();
    assert_eq!(before_mode, after_mode, "journal_mode is connection-local");
}

/// An AUTOINCREMENT counter outlives the rows that produced it; a dump that only
/// carries rows silently renumbers the next insert.
#[test]
fn sqlite_dump_preserves_an_autoincrement_sequence_that_outlived_its_rows() {
    let src = Connection::open_in_memory().unwrap();
    src.execute_batch(
        "CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT);
         INSERT INTO t (v) VALUES ('a'),('b'),('c');
         DELETE FROM t;",
    )
    .unwrap();

    let text = sqlite_roundtrip(&src);
    let dst = Connection::open_in_memory().unwrap();
    restore_sqlite(&dst, &text, false).unwrap();

    let seq: i64 = dst
        .query_row("SELECT seq FROM sqlite_sequence WHERE name='t'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(seq, 3, "the counter must not rewind to 0");
    dst.execute("INSERT INTO t (v) VALUES ('d')", []).unwrap();
    let id: i64 = dst
        .query_row("SELECT id FROM t WHERE v='d'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(id, 4, "the next insert continues the original sequence");
}

/// A dump of a path that is not a database must not create one: `Connection::open`
/// would happily turn a mistyped path into an empty database, and the dump would
/// then look like a valid empty backup.
#[test]
fn sqlite_dump_refuses_a_missing_database_instead_of_creating_one() {
    let dir = job_temp_dir("sqlite_dump_missing");
    let db = dir.join("missing.db");
    let dest = dir.join("backup.sql");
    std::fs::write(&dest, b"PRIOR BACKUP\n").unwrap();

    let err = dump_sqlite_to_path(db.to_str().unwrap(), dest.to_str().unwrap()).unwrap_err();
    assert!(
        err.to_lowercase().contains("not an existing file"),
        "got: {err}"
    );
    assert!(
        !db.exists(),
        "the dump must not create the database it reads"
    );
    assert_eq!(b"PRIOR BACKUP\n".to_vec(), std::fs::read(&dest).unwrap());
    assert!(partial_siblings(&dir).is_empty());
    let _ = std::fs::remove_dir_all(&dir);
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
    // The user must be able to find the offending statement in their file: its
    // 1-based position in the script *and* the line it starts on.
    let err = format_mysql_restore_statement_error(3, 10, 42, "syntax error near 'CREAT'");
    assert_eq!(
        err,
        "Statement 3 of 10 (line 42) failed: syntax error near 'CREAT'"
    );
}

#[test]
fn a_failing_statement_is_reported_with_its_position_in_the_script() {
    let script = "CREATE TABLE `t` (id int);\n\nINSERT INTO `t` VALUES ('a;b');\nBROKEN;\n";
    let statements = parse_mysql_restore_script(script).expect("parse");
    assert_eq!(statements.len(), 3);
    assert_eq!((statements[2].index, statements[2].line), (3, 4));
    assert_eq!(
        format_mysql_restore_statement_error(
            statements[2].index,
            statements.len(),
            statements[2].line,
            "syntax error"
        ),
        "Statement 3 of 3 (line 4) failed: syntax error"
    );
}

#[test]
fn a_failing_clean_drop_is_reported_with_its_position() {
    assert_eq!(
        format_mysql_clean_drop_error(2, 5, "table is referenced by a foreign key"),
        "Clean drop 2 of 5 failed: table is referenced by a foreign key"
    );
}

// ── native MySQL restore: script parsing ───────────────────────────

#[test]
fn a_dump_with_dialect_escapes_reaches_the_server_as_complete_statements() {
    // Criterion 1, at the job seam: the statements actually sent carry the
    // backslash-escaped and doubled quotes intact instead of being cut at the
    // semicolons inside them.
    let script = "CREATE TABLE `t` (id int, note varchar(50));\n\
                  INSERT INTO `t` VALUES (1,'it\\'s; ok');\n\
                  INSERT INTO `t` VALUES (2,'O''Brien; Ltd');\n";
    let statements = parse_mysql_restore_script(script).expect("parse");
    assert_eq!(statements.len(), 3, "got {statements:#?}");
    assert_eq!(
        statements[1].text,
        "INSERT INTO `t` VALUES (1,'it\\'s; ok')"
    );
    assert_eq!(
        statements[2].text,
        "INSERT INTO `t` VALUES (2,'O''Brien; Ltd')"
    );
}

#[test]
fn a_clean_restore_targets_the_dotted_name_the_dump_creates() {
    // Criteria 2 and 4 at the job seam: the drop list names exactly the objects
    // the dump recreates, and a dotted quoted name stays one name.
    let script = "CREATE TABLE `my.table` (id int);\nCREATE VIEW `v` AS SELECT 1;\n\
                  INSERT INTO `audit` VALUES ('CREATE TABLE ignored (id int)');\n";
    let statements = parse_mysql_restore_script(script).expect("parse");
    let drops = crate::db::mysql_clean::plan_clean_drops("shop", &statements);
    assert_eq!(
        drops,
        vec![
            "DROP VIEW IF EXISTS `shop`.`v`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`my.table`".to_string(),
        ]
    );
}

#[test]
fn a_mysqldump_shaped_script_splits_into_exactly_its_statements() {
    // End-to-end at the job seam: a dump with mysqldump's header/trailer
    // comments, executable version comments, extended inserts carrying both
    // escape forms, a dotted quoted table name, and a DELIMITER-wrapped trigger.
    let dump = "\
-- MySQL dump 10.13  Distrib 8.0.36, for macos14 (arm64)\n\
-- Host: localhost    Database: shop\n\
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n\
/*!40101 SET NAMES utf8mb4 */;\n\
DROP TABLE IF EXISTS `orders`;\n\
CREATE TABLE `orders` (id int NOT NULL, note varchar(50));\n\
LOCK TABLES `orders` WRITE;\n\
/*!40000 ALTER TABLE `orders` DISABLE KEYS */;\n\
INSERT INTO `orders` VALUES (1,'it\\'s O''Brien; ok'),(2,'back\\\\slash; too');\n\
/*!40000 ALTER TABLE `orders` ENABLE KEYS */;\n\
UNLOCK TABLES;\n\
CREATE TABLE `gl.dot.orders` (id int);\n\
DELIMITER ;;\n\
/*!50003 CREATE*/ /*!50017 DEFINER=`root`@`localhost`*/ /*!50003 TRIGGER `orders_bi` BEFORE INSERT ON `orders` FOR EACH ROW BEGIN SET @n = 1; END */;;\n\
DELIMITER ;\n\
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;\n\
-- Dump completed on 2026-11-21\n";

    let statements = parse_mysql_restore_script(dump).expect("parse");
    let texts: Vec<&str> = statements.iter().map(|s| s.text.as_ref()).collect();
    assert_eq!(texts.len(), 12, "got {texts:#?}");
    assert_eq!(
        texts[6], "INSERT INTO `orders` VALUES (1,'it\\'s O''Brien; ok'),(2,'back\\\\slash; too')",
        "insert escapes and inner semicolons must survive intact"
    );
    assert!(texts[9].starts_with("CREATE TABLE `gl.dot.orders`"));
    assert!(texts[10].contains("TRIGGER `orders_bi`"));
    assert_eq!(
        texts[10].matches("DELIMITER").count(),
        0,
        "the client directive must never reach the server"
    );

    // Clean planning over the same dump names exactly what it recreates.
    let drops = crate::db::mysql_clean::plan_clean_drops("shop", &statements);
    assert_eq!(
        drops,
        vec![
            "DROP TRIGGER IF EXISTS `shop`.`orders_bi`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`orders`".to_string(),
            "DROP TABLE IF EXISTS `shop`.`gl.dot.orders`".to_string(),
        ]
    );
}

#[test]
fn parsing_a_restore_script_borrows_instead_of_copying() {
    // Criterion 3: the file is read into one buffer and each statement is a
    // borrowed slice of it, so a 100 MB dump is not duplicated in memory.
    let mut script = String::new();
    for i in 0..5_000 {
        script.push_str(&format!("INSERT INTO `t` VALUES ({i}, 'v{i};');\n"));
    }
    let start = script.as_ptr() as usize;
    let end = start + script.len();

    let statements = parse_mysql_restore_script(&script).expect("parse");
    assert_eq!(statements.len(), 5_000);
    for stmt in &statements {
        assert!(
            matches!(stmt.text, std::borrow::Cow::Borrowed(_)),
            "statement text must borrow from the script buffer, not copy it"
        );
        let p = stmt.text.as_ref().as_ptr() as usize;
        assert!(
            p >= start && p + stmt.text.len() <= end,
            "borrowed text must point inside the script buffer"
        );
    }
    let total: usize = statements.iter().map(|s| s.text.len()).sum();
    assert!(
        total <= script.len(),
        "statements must not duplicate the script text ({total} > {})",
        script.len()
    );
}

#[test]
#[ignore = "allocates a 100 MB script; run with --ignored to prove the size-limit memory behavior"]
fn a_script_at_the_hundred_megabyte_cap_parses_without_a_second_copy() {
    // The documented restore cap is MAX_RESTORE_FILE_BYTES (100 MB). Parsing at
    // that size must add only the statement index: every statement borrows from
    // the one buffer read from disk.
    // ~200-byte rows, so the script stays inside the 1,000,000-statement budget.
    let row = "INSERT INTO `t` VALUES (1,'it\'s; O''Brien ''; pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad pad');\n";
    let cap = MAX_RESTORE_FILE_BYTES as usize;
    let mut script = String::with_capacity(cap + row.len());
    while script.len() < cap {
        script.push_str(row);
    }
    let start = script.as_ptr() as usize;
    let end = start + script.len();

    let statements = parse_mysql_restore_script(&script).expect("parse");
    assert!(
        statements.len() > 100_000 && statements.len() < 1_000_000,
        "got {}",
        statements.len()
    );
    let mut total = 0usize;
    for stmt in &statements {
        assert!(
            matches!(stmt.text, std::borrow::Cow::Borrowed(_)),
            "no statement may be copied out of the script buffer"
        );
        let p = stmt.text.as_ref().as_ptr() as usize;
        assert!(p >= start && p + stmt.text.len() <= end);
        total += stmt.text.len();
    }
    assert!(total <= script.len());
}

#[test]
fn restore_script_parsing_enforces_the_statement_budget() {
    let script = "SELECT 1;\nSELECT 2;\nSELECT 3;\n";
    let err = parse_mysql_restore_script_with_cap(script, 2).expect_err("must reject");
    assert!(err.contains('3') && err.contains('2'), "got {err:?}");
    assert!(parse_mysql_restore_script_with_cap(script, 3).is_ok());
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

    // Scratch objects, removed again at the end, so the live DB is never harmed.
    let table = "gl_restore_probe";
    // A quoted name containing a dot: one object, not schema `gl` + table `dot`.
    let dotted = "gl.dot.table";
    let bystander = "gl_restore_bystander";
    for obj in [table, dotted, bystander] {
        sqlx::query(&format!("DROP TABLE IF EXISTS `{db}`.`{obj}`"))
            .execute(&mut conn)
            .await
            .expect("pre-clean");
    }
    // Created by the test but never by the dump: a clean restore must leave it.
    sqlx::query(&format!(
        "CREATE TABLE `{db}`.`{bystander}` (id INT PRIMARY KEY)"
    ))
    .execute(&mut conn)
    .await
    .expect("bystander");
    sqlx::query(&format!("INSERT INTO `{db}`.`{bystander}` VALUES (7)"))
        .execute(&mut conn)
        .await
        .expect("bystander row");

    // The dump carries MySQL dialect escapes (backslash and doubled quotes) and
    // a dotted quoted table name; both must survive splitting and restore.
    let script = format!(
        "CREATE TABLE `{table}` (id INT PRIMARY KEY, name VARCHAR(40));\n\
         INSERT INTO `{table}` VALUES (1, 'it\\'s; O''Brien');\n\
         CREATE TABLE `{dotted}` (id INT PRIMARY KEY);\n\
         INSERT INTO `{dotted}` VALUES (1);"
    );
    let statements = parse_mysql_restore_script(&script).expect("parse");

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
    let stored: String = sqlx::query_scalar(&format!("SELECT name FROM `{db}`.`{table}`"))
        .fetch_one(&mut conn)
        .await
        .expect("escaped value");
    assert_eq!(
        stored, "it's; O'Brien",
        "dialect escapes must reach the server intact"
    );
    let dotted_rows: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM `{db}`.`{dotted}`"))
        .fetch_one(&mut conn)
        .await
        .expect("dotted name");
    assert_eq!(dotted_rows, 1, "a dotted quoted name is one table");
    let survivors: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM `{db}`.`{bystander}`"))
        .fetch_one(&mut conn)
        .await
        .expect("bystander survives");
    assert_eq!(
        survivors, 1,
        "a clean restore must not drop objects the dump does not recreate"
    );
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
    let bad = parse_mysql_restore_script("SELECT 1;\nSELECT * FROM gl_no_such_table_xyz;")
        .expect("parse");
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
    assert!(
        err.starts_with("Statement 2 of 2 (line 2) failed:"),
        "got {err:?}"
    );

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
    for obj in [table, dotted, bystander] {
        sqlx::query(&format!("DROP TABLE IF EXISTS `{db}`.`{obj}`"))
            .execute(&mut cleanup)
            .await
            .expect("cleanup");
    }
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
    let args = build_psql_restore_args(&conn, "/tmp/dump.sql", PgRestoreTxn::OneTransaction);
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
    let args = build_restore_args(&conn, &options, PgRestoreTxn::OneTransaction);
    assert!(
        args.iter().any(|a| a == "--exit-on-error"),
        "missing --exit-on-error: {args:?}"
    );
    assert!(args.iter().any(|a| a == "--clean"));
    assert!(args.iter().any(|a| a == "--if-exists"));
    assert!(args.iter().any(|a| a == "--format=c"));
}

// ------------------------------------------------------------------
// Transactional PostgreSQL restore (ticket 33)
// ------------------------------------------------------------------

fn pg_test_conn() -> PgConnParams {
    PgConnParams::new(
        "localhost".into(),
        5432,
        "postgres".into(),
        "app".into(),
        "secret".into(),
    )
}

fn restore_options(format: &str, file_path: &str) -> RestoreOptions {
    RestoreOptions {
        format: format.into(),
        file_path: file_path.into(),
        clean: false,
        schema: None,
    }
}

/// #110 / ticket 33: an archive restore that fails partway must roll back, which
/// only happens when pg_restore runs the whole archive in one transaction.
#[test]
fn pg_restore_args_run_an_archive_in_one_transaction() {
    for format in ["custom", "tar"] {
        let options = restore_options(format, "/tmp/dump.bak");
        let args = build_restore_args(&pg_test_conn(), &options, PgRestoreTxn::OneTransaction);
        assert!(
            args.iter().any(|a| a == "--single-transaction"),
            "{format} restore must be transactional: {args:?}"
        );
        assert!(
            args.iter().any(|a| a == "--exit-on-error"),
            "{format} restore must stop at the first error: {args:?}"
        );
    }
}

/// A plain script is executed by psql, so psql has to own the transaction.
#[test]
fn psql_restore_args_wrap_the_script_in_one_transaction() {
    let args = build_psql_restore_args(
        &pg_test_conn(),
        "/tmp/dump.sql",
        PgRestoreTxn::OneTransaction,
    );
    assert!(
        args.iter().any(|a| a == "--single-transaction"),
        "plain restore must be transactional: {args:?}"
    );
    assert!(args.iter().any(|a| a == "ON_ERROR_STOP=1"));
}

/// DB sync pipes our own pg_dump archive, which is always archive-shaped, so the
/// target stays unchanged when any entry fails.
#[test]
fn pg_sync_restore_args_run_in_one_transaction() {
    let args = build_pg_sync_restore_args(&pg_test_conn());
    assert!(
        args.iter().any(|a| a == "--single-transaction"),
        "sync must be transactional: {args:?}"
    );
    assert!(args.iter().any(|a| a == "--clean"));
    assert!(args.iter().any(|a| a == "--if-exists"));
    assert!(args.iter().any(|a| a == "--exit-on-error"));
}

/// The explicitly accepted non-atomic run is the only path that omits the
/// transaction, so the guarantee the UI states matches what runs.
#[test]
fn explicitly_non_atomic_restore_omits_the_single_transaction() {
    let options = restore_options("custom", "/tmp/dump.bak");
    let args = build_restore_args(&pg_test_conn(), &options, PgRestoreTxn::PerStatement);
    assert!(
        !args.iter().any(|a| a == "--single-transaction"),
        "non-atomic restore must not claim a transaction: {args:?}"
    );
    let psql_args =
        build_psql_restore_args(&pg_test_conn(), "/tmp/dump.sql", PgRestoreTxn::PerStatement);
    assert!(!psql_args.iter().any(|a| a == "--single-transaction"));
}

/// Write a throwaway plain-format dump and return its path.
fn temp_plain_dump(name: &str, body: &str) -> String {
    let path = std::env::temp_dir().join(format!("gridline-33-{name}.sql"));
    std::fs::write(&path, body).unwrap();
    path.to_string_lossy().to_string()
}

/// A real `pg_dump` plain script (comments, SET, CREATE, COPY, ALTER) is
/// transaction-compatible, so the restore must be transactional without asking.
#[test]
fn a_pg_dump_plain_script_is_atomic() {
    let body = "--\n-- PostgreSQL database dump\n--\n\nSET statement_timeout = 0;\nSET client_encoding = 'UTF8';\n\nCREATE TABLE public.users (\n    id integer NOT NULL\n);\n\nCOPY public.users (id) FROM stdin;\n1\n2\n\\.\n\nALTER TABLE ONLY public.users\n    ADD CONSTRAINT users_pkey PRIMARY KEY (id);\n\nCREATE FUNCTION public.keep() RETURNS integer\n    LANGUAGE plpgsql\n    AS $$\nBEGIN\n    RETURN 1;\nEND;\n$$;\n";
    let path = temp_plain_dump("compatible", body);
    assert_eq!(
        pg_restore_atomicity("plain", &path).unwrap(),
        PgRestoreAtomicity::Atomic,
        "a pg_dump plain script must stay transactional"
    );
    assert_eq!(
        pg_restore_txn("plain", &path, false).unwrap(),
        PgRestoreTxn::OneTransaction
    );
    let _ = std::fs::remove_file(&path);
}

/// Copy data, comments, and function bodies are payload: a data row that happens
/// to read `VACUUM`, a commented-out `VACUUM`, and a PL/pgSQL `BEGIN`/`END` must
/// not be mistaken for a statement that breaks transactional restore.
#[test]
fn plain_dump_payload_is_not_mistaken_for_transaction_breaking_sql() {
    let body = "-- VACUUM;\n/* VACUUM full; */\nCOPY public.keywords (word) FROM stdin;\nVACUUM\nCREATE DATABASE\n\\.\nCREATE FUNCTION public.f() RETURNS void\n    LANGUAGE plpgsql\n    AS $body$\nBEGIN\n    COMMIT;\nEND;\n$body$;\n";
    let path = temp_plain_dump("payload", body);
    assert_eq!(
        pg_restore_atomicity("plain", &path).unwrap(),
        PgRestoreAtomicity::Atomic,
        "comments, COPY rows and dollar-quoted bodies are not statements"
    );
    let _ = std::fs::remove_file(&path);
}

/// Ticket 33: an incompatible plain dump is identified, with the offending
/// statements and where they are.
#[test]
fn plain_dump_with_vacuum_is_identified_as_non_atomic() {
    let path = temp_plain_dump(
        "vacuum",
        "CREATE TABLE public.t (id integer);\nVACUUM FULL public.t;\nCREATE INDEX i ON public.t (id);\n",
    );
    let atomicity = pg_restore_atomicity("plain", &path).unwrap();
    let reason = atomicity.reason().expect("must be non-atomic");
    assert!(reason.contains("VACUUM"), "reason must name it: {reason}");
    assert!(reason.contains("line 2"), "reason must locate it: {reason}");
    assert!(
        reason.contains("partially applied"),
        "reason must name the risk: {reason}"
    );
    let _ = std::fs::remove_file(&path);
}

/// A script that opens its own transaction would commit the restore's wrapper
/// early, so it cannot be restored as one transaction.
#[test]
fn plain_dump_that_manages_its_own_transactions_is_non_atomic() {
    let path = temp_plain_dump(
        "own-txn",
        "BEGIN;\nCREATE TABLE public.t (id integer);\nCOMMIT;\n",
    );
    let reason = pg_restore_atomicity("plain", &path)
        .unwrap()
        .reason()
        .expect("must be non-atomic")
        .to_string();
    assert!(reason.contains("BEGIN"), "got: {reason}");
    assert!(reason.contains("COMMIT"), "got: {reason}");
    let _ = std::fs::remove_file(&path);
}

/// `pg_dump --create` output connects to another database mid-script, which a
/// single-transaction psql run cannot do.
#[test]
fn plain_dump_with_a_connect_meta_command_is_non_atomic() {
    let path = temp_plain_dump(
        "connect",
        "CREATE DATABASE app;\n\\connect app\nCREATE TABLE public.t (id integer);\n",
    );
    let reason = pg_restore_atomicity("plain", &path)
        .unwrap()
        .reason()
        .expect("must be non-atomic")
        .to_string();
    assert!(reason.contains("CREATE DATABASE"), "got: {reason}");
    assert!(reason.contains("\\connect"), "got: {reason}");
    let _ = std::fs::remove_file(&path);
}

#[test]
fn directory_dump_is_identified_as_transactional() {
    assert_eq!(
        pg_restore_atomicity("directory", "/tmp/dumpdir").unwrap(),
        PgRestoreAtomicity::Atomic
    );
}

/// `pg_restore --single-transaction` accepts every archive format (it only
/// refuses to run alongside `--jobs`), so a directory dump is transactional too.
#[test]
fn a_directory_dump_runs_in_one_transaction() {
    let options = restore_options("directory", "/tmp/dumpdir");
    let args = build_restore_args(&pg_test_conn(), &options, PgRestoreTxn::OneTransaction);
    assert!(args.iter().any(|a| a == "--format=d"));
    assert!(
        args.iter().any(|a| a == "--single-transaction"),
        "a directory dump is restored in one transaction: {args:?}"
    );
    assert_eq!(
        pg_restore_txn("directory", "/tmp/dumpdir", false).unwrap(),
        PgRestoreTxn::OneTransaction
    );
}

/// Ticket 33: silent downgrade is the bug. Without explicit acceptance the
/// restore is refused, and the refusal names the risk and carries a stable code
/// the UI can turn into a confirmation.
#[test]
fn non_atomic_dump_is_refused_without_explicit_confirmation() {
    let path = temp_plain_dump(
        "refused",
        "CREATE TABLE public.t (id integer);\nVACUUM FULL public.t;\n",
    );
    let err = pg_restore_txn("plain", &path, false).unwrap_err();
    let _ = std::fs::remove_file(&path);
    assert!(
        err.starts_with(PG_RESTORE_NON_ATOMIC_CODE),
        "must carry the UI code: {err}"
    );
    assert!(err.contains("partially"), "must name the risk: {err}");
}

#[test]
fn non_atomic_dump_runs_per_statement_once_the_risk_is_accepted() {
    let path = temp_plain_dump(
        "accepted",
        "CREATE TABLE public.t (id integer);\nVACUUM FULL public.t;\n",
    );
    let txn = pg_restore_txn("plain", &path, true).unwrap();
    let _ = std::fs::remove_file(&path);
    assert_eq!(txn, PgRestoreTxn::PerStatement);
}

/// Acceptance is not a blanket opt-out: a compatible dump still runs as one
/// transaction even when the caller allows non-atomic restores.
#[test]
fn a_compatible_dump_stays_transactional_even_when_acceptance_is_allowed() {
    assert_eq!(
        pg_restore_txn("custom", "/tmp/dump.bak", true).unwrap(),
        PgRestoreTxn::OneTransaction
    );
}

/// An unreadable dump is a real error, not a silent downgrade to a non-atomic
/// run that also could not happen.
#[test]
fn an_unreadable_plain_dump_is_an_error_not_a_downgrade() {
    let err = pg_restore_txn("plain", "/tmp/gridline-33-does-not-exist.sql", true).unwrap_err();
    assert!(err.contains("Could not read"), "got: {err}");
    assert!(!err.starts_with(PG_RESTORE_NON_ATOMIC_CODE), "got: {err}");
}

// ------------------------------------------------------------------
// Failed restore / sync reporting (ticket 33)
// ------------------------------------------------------------------

#[test]
fn a_failed_transactional_restore_says_the_target_is_unchanged() {
    let msg = pg_restore_failure_message(
        PgRestoreTxn::OneTransaction,
        "pg_restore: error: could not execute query: ERROR:  relation \"users\" already exists",
    );
    assert!(
        msg.contains("relation \"users\" already exists"),
        "the tool's diagnostic must survive: {msg}"
    );
    assert!(
        msg.contains("single transaction") && msg.contains("left unchanged"),
        "must state the guarantee: {msg}"
    );
}

/// A dump whose incompatibility only shows up at execution time must not be
/// reported as a plain SQL error: the run rolled back, and running it at all
/// needs the non-atomic risk accepted.
#[test]
fn a_runtime_transaction_incompatibility_explains_the_next_step() {
    let msg = pg_restore_failure_message(
        PgRestoreTxn::OneTransaction,
        "psql:/tmp/dump.sql:12: ERROR:  VACUUM cannot run inside a transaction block",
    );
    assert!(msg.contains("left unchanged"), "got: {msg}");
    assert!(
        msg.contains("cannot run inside a transaction"),
        "must name the cause: {msg}"
    );
    assert!(
        msg.contains("non-atomic") || msg.contains("partially applied"),
        "must explain how to proceed: {msg}"
    );
}

/// An accepted non-atomic failure must not claim a rollback that did not happen.
#[test]
fn a_failed_non_atomic_restore_does_not_claim_a_rollback() {
    let msg = pg_restore_failure_message(
        PgRestoreTxn::PerStatement,
        "pg_restore: error: could not execute query: ERROR:  syntax error",
    );
    assert!(!msg.contains("left unchanged"), "got: {msg}");
    assert!(
        msg.contains("already applied") || msg.contains("partially applied"),
        "must state what survived: {msg}"
    );
}

/// Ticket 33: when the restore rejects its input the dump's pipe closes, so the
/// target's error is the actionable one and the broken pipe is context.
#[test]
fn a_sync_reports_the_target_failure_first() {
    let msg = db_sync_failure_message(
        false,
        "pg_dump: error: could not write to output file: Broken pipe",
        false,
        "pg_restore: error: could not execute query: ERROR:  permission denied for schema public",
    )
    .expect("a failed sync must report a failure");
    let target = msg
        .find("permission denied for schema public")
        .expect("target error present");
    let source = msg
        .find("Broken pipe")
        .expect("source diagnostic present as context");
    assert!(
        target < source,
        "the target's failure must be reported first: {msg}"
    );
    assert!(
        msg.starts_with("pg_restore failed"),
        "the primary failure is the restore: {msg}"
    );
}

#[test]
fn a_sync_reports_a_source_failure_when_the_target_succeeded() {
    let msg = db_sync_failure_message(true, "", false, "").expect("must report");
    assert!(msg.starts_with("pg_restore failed"), "got: {msg}");
    let msg = db_sync_failure_message(false, "pg_dump: error: connection lost", true, "")
        .expect("must report");
    assert!(msg.starts_with("pg_dump failed"), "got: {msg}");
    assert!(msg.contains("connection lost"), "got: {msg}");
}

#[test]
fn a_successful_sync_reports_nothing() {
    assert!(db_sync_failure_message(true, "", true, "").is_none());
}

#[test]
fn a_failed_sync_states_that_the_target_rolled_back() {
    let msg = db_sync_failure_message(false, "", false, "pg_restore: error: out of memory")
        .expect("must report");
    assert!(
        msg.contains("left unchanged"),
        "a transactional sync failure must say the target rolled back: {msg}"
    );
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

#[test]
fn mysql_cli_tls_mode_prefers_each_endpoints_own_setting() {
    // Direct connections honour their own ssl_mode.
    assert_eq!(
        mysql_cli_tls_mode("db.example.com", Some("verify-full"), false)
            .unwrap()
            .as_deref(),
        Some("verify-full")
    );
    assert_eq!(
        mysql_cli_tls_mode("db.example.com", Some("disable"), false)
            .unwrap()
            .as_deref(),
        Some("disable")
    );
    assert_eq!(mysql_cli_tls_mode("db.example.com", None, false), Ok(None));

    // Managed hosts default to `require` (pre-fix saved connections).
    assert_eq!(
        mysql_cli_tls_mode("xxxx.us-east-2.psdb.cloud", None, false)
            .unwrap()
            .as_deref(),
        Some("require")
    );

    // Endpoints never share a mode.
    let source = mysql_cli_tls_mode("src.example.com", Some("disable"), false);
    let target = mysql_cli_tls_mode("tgt.example.com", Some("verify-full"), false);
    assert_ne!(source, target);
}

#[test]
fn mysql_cli_tls_mode_refuses_a_tunnel_rather_than_downgrading_verification() {
    // The client tools verify the address they dial, which through a tunnel is
    // loopback. A verify mode must therefore be refused, never silently turned
    // into encryption-only `require`.
    for mode in ["verify-ca", "verify-full"] {
        let err = mysql_cli_tls_mode("db.example.com", Some(mode), true)
            .expect_err("verify mode through a tunnel must fail closed");
        assert!(err.contains(mode), "error should name the mode: {err}");
        assert!(
            err.contains("db.example.com"),
            "error should name the host: {err}"
        );
    }

    // `require` asked for encryption without verification, so encrypting
    // through the tunnel is exactly what was requested.
    assert_eq!(
        mysql_cli_tls_mode("db.example.com", Some("require"), true)
            .unwrap()
            .as_deref(),
        Some("require")
    );
    // And an empty mode keeps the established tunnel default.
    assert_eq!(
        mysql_cli_tls_mode("db.example.com", None, true)
            .unwrap()
            .as_deref(),
        Some("require")
    );
    // An unknown mode is refused on both paths.
    assert!(mysql_cli_tls_mode("db.example.com", Some("bogus"), true).is_err());
    assert!(mysql_cli_tls_mode("db.example.com", Some("bogus"), false).is_err());
}

// ------------------------------------------------------------------
// Sync-path integration (inherited guarantees)
// ------------------------------------------------------------------

#[test]
fn sqlite_sync_replaces_the_target_objects() {
    let dir = std::env::temp_dir().join(format!("gridline_sqlite_sync_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let src_path = dir.join("src.db");
    let tgt_path = dir.join("tgt.db");

    {
        let src = Connection::open(&src_path).unwrap();
        src.execute_batch(
            "CREATE TABLE wanted (id INTEGER PRIMARY KEY, v TEXT);
             INSERT INTO wanted VALUES (1,'a');",
        )
        .unwrap();
    }
    {
        let tgt = Connection::open(&tgt_path).unwrap();
        tgt.execute_batch(
            "CREATE TABLE stale (id INTEGER);\n               INSERT INTO stale VALUES (9);",
        )
        .unwrap();
    }

    run_sqlite_sync(src_path.to_str().unwrap(), tgt_path.to_str().unwrap()).unwrap();

    {
        let tgt = Connection::open(&tgt_path).unwrap();
        let mut names: Vec<String> = tgt
            .prepare(
                "SELECT name FROM sqlite_master
                   WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec!["wanted".to_string()],
            "sync is a full replacement, not a merge"
        );
        let rows: i64 = tgt
            .query_row("SELECT COUNT(*) FROM wanted", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// A sync into an unreadable target must fail rather than silently succeed.
#[test]
fn sqlite_sync_fails_when_the_target_cannot_be_opened() {
    let dir =
        std::env::temp_dir().join(format!("gridline_sqlite_sync_bad_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let src_path = dir.join("src.db");
    {
        let src = Connection::open(&src_path).unwrap();
        src.execute_batch("CREATE TABLE t (id INTEGER);").unwrap();
    }
    // A directory is not a database file.
    let tgt_path = dir.join("target_is_a_directory");
    std::fs::create_dir_all(&tgt_path).unwrap();

    let err = run_sqlite_sync(src_path.to_str().unwrap(), tgt_path.to_str().unwrap()).unwrap_err();
    assert!(err.contains("open target"), "got: {err}");

    let _ = std::fs::remove_dir_all(&dir);
}

/// Live: a real plain-format PostgreSQL restore must stop at the failing
/// statement. `after_error` must NOT exist afterwards. Opt in with
/// GRIDLINE_TEST_TGT_*, GRIDLINE_TEST_PG_DUMP, GRIDLINE_TEST_PG_RESTORE,
/// GRIDLINE_TEST_PSQL.
#[test]
#[ignore]
fn live_pg_plain_restore_stops_at_the_first_error() {
    if std::env::var("GRIDLINE_TEST_TGT_HOST").is_err() {
        eprintln!(
            "SKIPPED live_pg_plain_restore_stops_at_the_first_error: GRIDLINE_TEST_TGT_* unset"
        );
        return;
    }
    let conn = conn_from_env("GRIDLINE_TEST_TGT");
    let tools = PgToolPaths {
        pg_dump: std::env::var("GRIDLINE_TEST_PG_DUMP").unwrap_or_else(|_| "pg_dump".into()),
        pg_restore: std::env::var("GRIDLINE_TEST_PG_RESTORE")
            .unwrap_or_else(|_| "pg_restore".into()),
        psql: std::env::var("GRIDLINE_TEST_PSQL").unwrap_or_else(|_| "psql".into()),
    };
    psql_exec(
        &conn,
        "DROP TABLE IF EXISTS gl_after_error; DROP TABLE IF EXISTS gl_before_error;",
    );

    let path = std::env::temp_dir().join("gridline_live_stop_on_error.sql");
    std::fs::write(
        &path,
        "CREATE TABLE gl_before_error (id integer);\nSELECT * FROM gl_missing_table_xyz;\nCREATE TABLE gl_after_error (id integer);\n",
    )
    .unwrap();

    let options = RestoreOptions {
        format: "plain".into(),
        file_path: path.to_string_lossy().to_string(),
        clean: false,
        schema: None,
    };
    let result = run_pg_restore(&conn, &options, &tools);

    assert!(
        result.is_err(),
        "a failing middle statement must fail the restore"
    );
    let after = psql_count(
        &conn,
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'gl_after_error'",
    );
    assert_eq!(
        after, 0,
        "statements after the error must not run (issue #49)"
    );
    // Ticket 33: the run is one transaction, so even the statement that succeeded
    // before the failure was rolled back — the target is unchanged.
    let before = psql_count(
        &conn,
        "SELECT count(*) FROM information_schema.tables WHERE table_name = 'gl_before_error'",
    );
    assert_eq!(
        before, 0,
        "a failed transactional restore must leave the target unchanged"
    );

    let _ = std::fs::remove_file(&path);
    psql_exec(&conn, "DROP TABLE IF EXISTS gl_before_error;");
}

/// Live ticket 33: a real `pg_dump` plain script must scan as transaction
/// compatible. This is the guard against false positives in the scanner: data
/// values that read like statements (`COPY` payload) and PL/pgSQL bodies
/// (`BEGIN`/`END` inside dollar quotes) are not statements.
///
/// Opt in with GRIDLINE_TEST_SRC_*, GRIDLINE_TEST_PG_DUMP.
#[test]
#[ignore]
fn live_pg_dump_plain_output_is_recognized_as_atomic() {
    if std::env::var("GRIDLINE_TEST_SRC_HOST").is_err() {
        eprintln!(
            "SKIPPED live_pg_dump_plain_output_is_recognized_as_atomic: GRIDLINE_TEST_SRC_* unset"
        );
        return;
    }
    let _guard = INTEGRATION_LOCK.lock().unwrap();
    let src = conn_from_env("GRIDLINE_TEST_SRC");
    let pg_dump = std::env::var("GRIDLINE_TEST_PG_DUMP").unwrap_or_else(|_| "pg_dump".into());

    psql_exec(
        &src,
        "DROP SCHEMA IF EXISTS gl_scan CASCADE; CREATE SCHEMA gl_scan;",
    );
    psql_exec(
        &src,
        "CREATE TABLE gl_scan.t (id integer PRIMARY KEY, note text);\
         INSERT INTO gl_scan.t VALUES (1, 'VACUUM; CREATE DATABASE evil;');",
    );
    psql_exec(
        &src,
        "CREATE FUNCTION gl_scan.f() RETURNS integer LANGUAGE plpgsql AS $$\nBEGIN\n    RETURN 1;\nEND;\n$$;",
    );
    psql_exec(&src, "CREATE VIEW gl_scan.v AS SELECT id FROM gl_scan.t;");

    let path = std::env::temp_dir().join(format!(
        "gridline_live_scan_{}_{}.sql",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let out = Command::new(&pg_dump)
        .env("PGPASSWORD", &src.password)
        .args([
            format!("--host={}", src.host),
            format!("--port={}", src.port),
            format!("--username={}", src.username),
            format!("--dbname={}", src.database),
            "--schema=gl_scan".into(),
            "--no-owner".into(),
            "--format=plain".into(),
            format!("--file={}", path.display()),
        ])
        .output()
        .expect("pg_dump should run");
    assert!(
        out.status.success(),
        "pg_dump failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let atomicity = pg_restore_atomicity("plain", path.to_str().unwrap()).unwrap();
    let _ = std::fs::remove_file(&path);
    psql_exec(&src, "DROP SCHEMA IF EXISTS gl_scan CASCADE;");

    assert_eq!(
        atomicity,
        PgRestoreAtomicity::Atomic,
        "a real pg_dump plain script must not be flagged as non-atomic"
    );
}

/// Live ticket 33: a *compatible* archive that fails partway leaves the target
/// unchanged, because the whole restore is one transaction. The archive holds
/// `gl_atomic_early` then `gl_atomic_late`; the target already has
/// `gl_atomic_late`, so the restore fails after it would otherwise have created
/// `gl_atomic_early` — which must therefore not exist afterwards.
///
/// Opt in with GRIDLINE_TEST_SRC_*, GRIDLINE_TEST_TGT_*,
/// GRIDLINE_TEST_PG_DUMP, GRIDLINE_TEST_PG_RESTORE, GRIDLINE_TEST_PSQL.
#[test]
#[ignore]
fn live_pg_archive_restore_rolls_back_a_partial_restore() {
    if std::env::var("GRIDLINE_TEST_SRC_HOST").is_err()
        || std::env::var("GRIDLINE_TEST_TGT_HOST").is_err()
    {
        eprintln!(
            "SKIPPED live_pg_archive_restore_rolls_back_a_partial_restore: GRIDLINE_TEST_* unset"
        );
        return;
    }
    let _guard = INTEGRATION_LOCK.lock().unwrap();
    let src = conn_from_env("GRIDLINE_TEST_SRC");
    let tgt = conn_from_env("GRIDLINE_TEST_TGT");
    let tools = PgToolPaths {
        pg_dump: std::env::var("GRIDLINE_TEST_PG_DUMP").unwrap_or_else(|_| "pg_dump".into()),
        pg_restore: std::env::var("GRIDLINE_TEST_PG_RESTORE")
            .unwrap_or_else(|_| "pg_restore".into()),
        psql: std::env::var("GRIDLINE_TEST_PSQL").unwrap_or_else(|_| "psql".into()),
    };

    psql_exec(
        &src,
        "DROP TABLE IF EXISTS gl_atomic_late; DROP TABLE IF EXISTS gl_atomic_early;",
    );
    psql_exec(&src, "CREATE TABLE gl_atomic_early (id integer);");
    psql_exec(&src, "INSERT INTO gl_atomic_early VALUES (1);");
    psql_exec(&src, "CREATE TABLE gl_atomic_late (id integer);");

    let dump_path = std::env::temp_dir().join(format!(
        "gridline_live_atomic_{}_{}.bak",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let dump_opts = BackupOptions {
        format: "custom".into(),
        file_path: dump_path.to_string_lossy().to_string(),
        schema: None,
        tables: Some(vec!["gl_atomic_early".into(), "gl_atomic_late".into()]),
        no_owner: true,
    };
    run_pg_dump(&src, &dump_opts, &tools).expect("pg_dump should succeed");

    // The target is clean except for the object the archive recreates later, so
    // the restore fails after the first table has been created.
    psql_exec(
        &tgt,
        "DROP TABLE IF EXISTS gl_atomic_early; DROP TABLE IF EXISTS gl_atomic_late;",
    );
    psql_exec(&tgt, "CREATE TABLE gl_atomic_late (id integer);");

    let options = RestoreOptions {
        format: "custom".into(),
        file_path: dump_path.to_string_lossy().to_string(),
        clean: false,
        schema: None,
    };
    let result = run_pg_restore(&tgt, &options, &tools);

    let message = result.expect_err("the conflicting entry must fail the restore");
    assert!(
        message.contains("left unchanged"),
        "a transactional failure must say the target rolled back: {message}"
    );
    let early = psql_count(
        &tgt,
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gl_atomic_early'",
    );
    assert_eq!(
        early, 0,
        "a failed transactional restore must leave the target unchanged (ticket 33)"
    );

    let _ = std::fs::remove_file(&dump_path);
    psql_exec(
        &src,
        "DROP TABLE IF EXISTS gl_atomic_early; DROP TABLE IF EXISTS gl_atomic_late;",
    );
    psql_exec(
        &tgt,
        "DROP TABLE IF EXISTS gl_atomic_early; DROP TABLE IF EXISTS gl_atomic_late;",
    );
}

/// Live: a real MySQL/MariaDB sync must write into the selected TARGET
/// database and must not create a database named after the source on the
/// target server (issue #47). Opt in with GRIDLINE_TEST_MYSQL_SRC_*,
/// GRIDLINE_TEST_MYSQL_TGT_*, GRIDLINE_TEST_MARIADB_DUMP, GRIDLINE_TEST_MARIADB.
#[test]
#[ignore]
fn live_mysql_sync_targets_only_the_selected_database() {
    let env = |k: &str| std::env::var(k).ok();
    let (Some(src_host), Some(tgt_host)) = (
        env("GRIDLINE_TEST_MYSQL_SRC_HOST"),
        env("GRIDLINE_TEST_MYSQL_TGT_HOST"),
    ) else {
        eprintln!("SKIPPED live_mysql_sync_targets_only_the_selected_database: env unset");
        return;
    };
    let src_db = env("GRIDLINE_TEST_MYSQL_SRC_DB").unwrap_or_else(|| "gl_src".into());
    let tgt_db = env("GRIDLINE_TEST_MYSQL_TGT_DB").unwrap_or_else(|| "gl_tgt".into());
    let tools = MySqlToolPaths {
        mysqldump: env("GRIDLINE_TEST_MARIADB_DUMP").unwrap_or_else(|| "mariadb-dump".into()),
        mysql: env("GRIDLINE_TEST_MARIADB").unwrap_or_else(|| "mariadb".into()),
    };
    let source = MySqlConnParams::new(
        src_host,
        env("GRIDLINE_TEST_MYSQL_SRC_PORT")
            .and_then(|p| p.parse().ok())
            .unwrap_or(3306),
        env("GRIDLINE_TEST_MYSQL_SRC_USER").unwrap_or_else(|| "root".into()),
        src_db.clone(),
        env("GRIDLINE_TEST_MYSQL_SRC_PASS").unwrap_or_default(),
    );
    let target = MySqlConnParams::new(
        tgt_host.clone(),
        env("GRIDLINE_TEST_MYSQL_TGT_PORT")
            .and_then(|p| p.parse().ok())
            .unwrap_or(3306),
        env("GRIDLINE_TEST_MYSQL_TGT_USER").unwrap_or_else(|| "root".into()),
        tgt_db.clone(),
        env("GRIDLINE_TEST_MYSQL_TGT_PASS").unwrap_or_default(),
    );

    run_mysql_sync(&source, &target, &tools, None, None).expect("sync should succeed");

    // The source-named database must not exist on the target server.
    let out = std::process::Command::new(&tools.mysql)
        .env("MYSQL_PWD", &target.password)
        .args([
            format!("--host={}", target.host),
            format!("--port={}", target.port),
            format!("--user={}", target.username),
            "--batch".to_string(),
            "--skip-column-names".to_string(),
            format!("--execute=SHOW DATABASES LIKE '{src_db}'"),
        ])
        .output()
        .expect("run mysql client");
    let listed = String::from_utf8_lossy(&out.stdout);
    assert!(
        listed.trim().is_empty(),
        "sync must not create a source-named database on the target: {listed}"
    );
}

// ------------------------------------------------------------------
// Behavioural regressions adopted from @hamzahamidi's PRs #53 and #54,
// adapted to the current `run_mysql_sync` signature (per-endpoint TLS).
// PR #54, test: mysql_sync_restores_source_objects_into_the_selected_target
// ------------------------------------------------------------------

#[cfg(unix)]
struct MySqlSyncMock {
    dir: std::path::PathBuf,
    tools: MySqlToolPaths,
    dump_args: std::path::PathBuf,
    restore_args: std::path::PathBuf,
    restored_sql: std::path::PathBuf,
}

#[cfg(unix)]
impl Drop for MySqlSyncMock {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[cfg(unix)]
fn mysql_sync_mock(dump_body: &str) -> MySqlSyncMock {
    use std::os::unix::fs::PermissionsExt;

    let dir = std::env::temp_dir().join(format!("gridline-mysql-sync-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&dir).unwrap();
    let dump = dir.join("mysqldump");
    let mysql = dir.join("mysql");
    let dump_args = dir.join("dump-args");
    let restore_args = dir.join("restore-args");
    let restored_sql = dir.join("restored-sql");
    let shell_quote =
        |path: &std::path::Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));

    let dump_script = format!(
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'mysqldump MySQL'; exit 0; fi\nprintf '%s\\n' \"$@\" > {}\n{}\n",
        shell_quote(&dump_args), dump_body
    );
    std::fs::write(&dump, dump_script).unwrap();
    std::fs::set_permissions(&dump, std::fs::Permissions::from_mode(0o700)).unwrap();

    let mysql_script = format!(
        "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'mysql MySQL'; exit 0; fi\nprintf '%s\\n' \"$@\" > {}\ntest \"$MYSQL_PWD\" = target-secret || exit 81\ncat > {}\n",
        shell_quote(&restore_args), shell_quote(&restored_sql)
    );
    std::fs::write(&mysql, mysql_script).unwrap();
    std::fs::set_permissions(&mysql, std::fs::Permissions::from_mode(0o700)).unwrap();

    MySqlSyncMock {
        dir,
        tools: MySqlToolPaths {
            mysqldump: dump.to_string_lossy().into_owned(),
            mysql: mysql.to_string_lossy().into_owned(),
        },
        dump_args,
        restore_args,
        restored_sql,
    }
}

#[cfg(unix)]
#[test]
fn mysql_sync_restores_source_objects_into_the_selected_target() {
    let mock = mysql_sync_mock(
        "test \"$MYSQL_PWD\" = source-secret || exit 80\nfor arg in \"$@\"; do\n  if [ \"$arg\" = \"--databases\" ]; then\n    echo 'CREATE DATABASE source_db;'\n    echo 'USE source_db;'\n  fi\ndone\necho 'CREATE TABLE inventory (id INT);'",
    );
    let source = MySqlConnParams::new(
        "source.example".into(),
        3306,
        "source_user".into(),
        "source_db".into(),
        "source-secret".into(),
    );
    let target = MySqlConnParams::new(
        "target.example".into(),
        3306,
        "target_user".into(),
        "target_db".into(),
        "target-secret".into(),
    );

    run_mysql_sync(&source, &target, &mock.tools, None, None).unwrap();

    let dump_args = std::fs::read_to_string(&mock.dump_args).unwrap();
    assert!(!dump_args.lines().any(|arg| arg == "--databases"));
    assert!(dump_args.lines().any(|arg| arg == "source_db"));
    let restore_args = std::fs::read_to_string(&mock.restore_args).unwrap();
    assert!(restore_args
        .lines()
        .any(|arg| arg == "--database=target_db"));
    let restored_sql = std::fs::read_to_string(&mock.restored_sql).unwrap();
    assert!(!restored_sql.contains("USE source_db"), "{restored_sql}");
    assert!(restored_sql.contains("CREATE TABLE inventory"));
}

#[cfg(unix)]
#[test]
fn mysql_sync_reports_a_failed_dump_even_when_restore_succeeds() {
    let mock = mysql_sync_mock(
        "test \"$MYSQL_PWD\" = source-secret || exit 80\necho 'partial dump'\nexit 17",
    );
    let source = MySqlConnParams::new(
        "source.example".into(),
        3306,
        "source_user".into(),
        "source_db".into(),
        "source-secret".into(),
    );
    let target = MySqlConnParams::new(
        "target.example".into(),
        3306,
        "target_user".into(),
        "target_db".into(),
        "target-secret".into(),
    );

    let result = run_mysql_sync(&source, &target, &mock.tools, None, None);

    assert!(result.is_err(), "a partial dump must fail the sync");
}

// ------------------------------------------------------------------
// PR #53: behavioural tests for run_pg_restore itself (the merged
// implementation pins the arg builders instead).
// ------------------------------------------------------------------

#[cfg(unix)]
fn write_executable_script(name: &str, body: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;

    let path = std::env::temp_dir().join(format!("gridline_{name}_{}.sh", uuid::Uuid::new_v4()));
    std::fs::write(&path, body).unwrap();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(&path, permissions).unwrap();
    path
}

#[cfg(unix)]
#[test]
fn plain_postgres_restore_runs_the_script_in_one_psql_transaction() {
    let dir = job_temp_dir("pg_plain_txn");
    let dump = dir.join("dump.sql");
    std::fs::write(&dump, "CREATE TABLE public.t (id integer);\n").unwrap();
    let argv_log = dir.join("argv.txt");
    let psql = write_executable_script(
        "psql_txn",
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nexit 0\n",
            argv_log.display()
        ),
    );
    let conn = PgConnParams::new(
        "localhost".into(),
        5432,
        "test".into(),
        "db".into(),
        "".into(),
    );
    let options = RestoreOptions {
        format: "plain".into(),
        file_path: dump.to_string_lossy().into_owned(),
        clean: false,
        schema: None,
    };
    let tools = PgToolPaths {
        pg_dump: String::new(),
        pg_restore: String::new(),
        psql: psql.to_string_lossy().into_owned(),
    };

    let result = run_pg_restore(&conn, &options, &tools);
    let argv = std::fs::read_to_string(&argv_log).unwrap_or_default();
    let _ = std::fs::remove_file(psql);
    let _ = std::fs::remove_dir_all(&dir);

    assert!(result.is_ok(), "got {result:?}");
    assert!(
        argv.lines().any(|a| a == "--single-transaction"),
        "a compatible plain dump must run in one psql transaction: {argv}"
    );
    assert!(
        argv.lines().any(|a| a == "ON_ERROR_STOP=1"),
        "a failing statement must abort the script: {argv}"
    );
}

/// A failed transactional restore must tell the user what the target looks like
/// now, not only what the tool printed.
#[cfg(unix)]
#[test]
fn a_failed_transactional_restore_reports_that_the_target_rolled_back() {
    let pg_restore = write_executable_script(
        "pg_restore_fail",
        r#"#!/bin/sh
cat >/dev/null
echo 'pg_restore: error: could not execute query: ERROR:  relation "t" already exists' >&2
exit 1
"#,
    );
    let conn = PgConnParams::new(
        "localhost".into(),
        5432,
        "test".into(),
        "db".into(),
        "".into(),
    );
    let options = RestoreOptions {
        format: "custom".into(),
        file_path: "/tmp/synthetic.dump".into(),
        clean: false,
        schema: None,
    };
    let tools = PgToolPaths {
        pg_dump: String::new(),
        pg_restore: pg_restore.to_string_lossy().into_owned(),
        psql: String::new(),
    };

    let failure = run_pg_restore_managed(
        &JobControl::detached(),
        &conn,
        &options,
        PgRestoreTxn::OneTransaction,
        &tools,
    )
    .expect_err("a failing restore must fail");
    let _ = std::fs::remove_file(pg_restore);

    assert!(!failure.cancelled, "a failure is not a cancellation");
    assert!(
        failure.message.contains("already exists"),
        "the tool's diagnostic must survive: {}",
        failure.message
    );
    assert!(
        failure.message.contains("left unchanged"),
        "must state the rollback: {}",
        failure.message
    );
}

/// Ticket 33: the target's rejection closes the dump's pipe, so the user must
/// get the target error first and the broken pipe as context.
#[cfg(unix)]
#[test]
fn a_failed_db_sync_reports_the_target_error_before_the_dump_pipe_error() {
    let dump = write_executable_script(
        "pg_dump_broken_pipe",
        r#"#!/bin/sh
printf 'partial archive bytes'
echo 'pg_dump: error: could not write to output file: Broken pipe' >&2
exit 1
"#,
    );
    let restore = write_executable_script(
        "pg_restore_rejects",
        r#"#!/bin/sh
cat >/dev/null
echo 'pg_restore: error: could not execute query: ERROR:  permission denied for schema public' >&2
exit 1
"#,
    );
    let tools = PgToolPaths {
        pg_dump: dump.to_string_lossy().into_owned(),
        pg_restore: restore.to_string_lossy().into_owned(),
        psql: String::new(),
    };

    let failure = run_db_sync(&pg_params(), &pg_params(), None, None, &tools)
        .expect_err("a failed sync must fail");
    let _ = std::fs::remove_file(dump);
    let _ = std::fs::remove_file(restore);

    let target = failure
        .find("permission denied for schema public")
        .unwrap_or_else(|| panic!("target error missing: {failure}"));
    let source = failure
        .find("Broken pipe")
        .unwrap_or_else(|| panic!("source context missing: {failure}"));
    assert!(
        target < source,
        "the target's failure must be reported first: {failure}"
    );
    assert!(
        failure.starts_with("pg_restore failed"),
        "the restore is the primary failure: {failure}"
    );
}

#[cfg(unix)]
#[test]
fn archive_postgres_restore_stops_on_first_error() {
    // Fails only when BOTH the stop-at-first-error flag and the one-transaction
    // flag reach the real spawn, so this pins the process seam, not just the arg
    // builder.
    let pg_restore = write_executable_script(
        "pg_restore",
        r#"#!/bin/sh
exit_on_error=0
single_txn=0
for arg in "$@"; do
  [ "$arg" = "--exit-on-error" ] && exit_on_error=1
  [ "$arg" = "--single-transaction" ] && single_txn=1
done
[ "$exit_on_error" -eq 1 ] && [ "$single_txn" -eq 1 ] && exit 1
echo "missing --exit-on-error and/or --single-transaction" >&2
exit 0
"#,
    );
    let conn = PgConnParams::new(
        "localhost".into(),
        5432,
        "test".into(),
        "db".into(),
        "".into(),
    );
    let options = RestoreOptions {
        format: "custom".into(),
        file_path: "/tmp/synthetic.dump".into(),
        clean: false,
        schema: None,
    };
    let tools = PgToolPaths {
        pg_dump: String::new(),
        pg_restore: pg_restore.to_string_lossy().into_owned(),
        psql: String::new(),
    };

    let result = run_pg_restore(&conn, &options, &tools);
    let _ = std::fs::remove_file(pg_restore);

    assert!(result.is_err(), "got {result:?}");
}

// ------------------------------------------------------------------
// Ticket 31: tool jobs are owned, bounded, and cancellable.
//
// These tests exercise the *command seam* (`run_pg_dump_managed`,
// `run_db_sync_managed`, `run_mysql_dump_managed`, the SQLite engines and the
// progress-event mapping) with real processes, so the process-tree assertions
// are observations of the operating system rather than of our bookkeeping.
// ------------------------------------------------------------------

#[cfg(unix)]
fn job_temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "gridline_backup_job_{tag}_{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // SAFETY: signal 0 performs the existence/permission check only.
    unsafe { libc::kill(pid as libc::pid_t, 0) == 0 }
}

#[cfg(unix)]
fn wait_for_pid(path: &std::path::Path, timeout: std::time::Duration) -> Option<u32> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(pid) = text.trim().parse::<u32>() {
                return Some(pid);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    None
}

#[cfg(unix)]
fn wait_until_dead(pid: u32, timeout: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if !pid_alive(pid) {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    !pid_alive(pid)
}

#[cfg(unix)]
fn pg_dump_options(file_path: &std::path::Path) -> BackupOptions {
    BackupOptions {
        format: "custom".into(),
        file_path: file_path.to_string_lossy().into_owned(),
        schema: None,
        tables: None,
        no_owner: true,
    }
}

#[cfg(unix)]
fn pg_params() -> PgConnParams {
    PgConnParams::new(
        "localhost".into(),
        5432,
        "test".into(),
        "db".into(),
        "secret".into(),
    )
}

/// A fake `pg_dump` that spawns a helper of its own (exactly like the real tool
/// spawning a helper), writes the helper's pid, and then runs forever.
#[cfg(unix)]
fn forking_dump_script(dir: &std::path::Path, pid_file: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("pg_dump");
    std::fs::write(
        &path,
        format!(
            "#!/bin/sh\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            pid_file.display()
        ),
    )
    .unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();
    path
}

/// Cancelling a backup from the UI must terminate the dump **and its children**,
/// not just the process we happen to wait on.
#[cfg(unix)]
#[test]
fn cancelling_a_pg_dump_terminates_its_process_tree() {
    let dir = job_temp_dir("pg_dump_tree");
    let pid_file = dir.join("helper.pid");
    let script = forking_dump_script(&dir, &pid_file);
    let tools = PgToolPaths {
        pg_dump: script.to_string_lossy().into_owned(),
        pg_restore: String::new(),
        psql: String::new(),
    };
    let options = pg_dump_options(&dir.join("dump.out"));
    let conn = pg_params();

    let job = JobControl::detached();
    let runner = job.clone();
    let handle = std::thread::spawn(move || run_pg_dump_managed(&runner, &conn, &options, &tools));

    let helper = wait_for_pid(&pid_file, std::time::Duration::from_secs(5)).expect("helper pid");
    assert!(pid_alive(helper), "the dump helper should be running");

    let started = std::time::Instant::now();
    job.cancel();
    let outcome = handle.join().unwrap();
    let elapsed = started.elapsed();

    let failure = outcome.expect_err("a cancelled dump must not report success");
    assert!(
        failure.cancelled,
        "cancellation must stay distinguishable: {failure:?}"
    );
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "cancellation was not prompt: {elapsed:?}"
    );
    assert!(
        wait_until_dead(helper, std::time::Duration::from_secs(5)),
        "the dump's helper process {helper} survived cancellation"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// Quitting during a job: the app-exit hook calls `JobRegistry::cancel_all`,
/// which must reach a dump that another thread is supervising.
#[cfg(unix)]
#[test]
fn app_exit_cancellation_terminates_a_running_dump_tree() {
    let dir = job_temp_dir("pg_dump_exit");
    let pid_file = dir.join("helper.pid");
    let script = forking_dump_script(&dir, &pid_file);
    let tools = PgToolPaths {
        pg_dump: script.to_string_lossy().into_owned(),
        pg_restore: String::new(),
        psql: String::new(),
    };
    let options = pg_dump_options(&dir.join("dump.out"));
    let conn = pg_params();

    let registry = crate::job::JobRegistry::new();
    let job = registry.begin("exit-job");
    let runner = job.clone();
    let handle = std::thread::spawn(move || run_pg_dump_managed(&runner, &conn, &options, &tools));

    let helper = wait_for_pid(&pid_file, std::time::Duration::from_secs(5)).expect("helper pid");

    assert_eq!(registry.cancel_all(), 1, "the running job must be known");
    let outcome = handle.join().unwrap();

    assert!(outcome.expect_err("cancelled").cancelled);
    assert!(
        wait_until_dead(helper, std::time::Duration::from_secs(5)),
        "quitting left the dump's helper process {helper} running"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A backup that keeps writing must not be killed by the idle bound, however
/// long it runs — the deadline exists for hung tools, not big databases.
#[cfg(unix)]
#[test]
fn a_progressing_pg_dump_is_not_killed_by_the_idle_bound() {
    use std::os::unix::fs::PermissionsExt;
    let dir = job_temp_dir("pg_dump_progress");
    let out = dir.join("dump.out");
    let script = dir.join("pg_dump");
    // Mirrors `pg_dump --file=<path>`: the tool writes to its own output file.
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\ni=0\nwhile [ $i -lt 30 ]; do\n  printf 'chunk %s\\n' \"$i\" >> '{}'\n  i=$((i+1))\n  sleep 0.05\ndone\nexit 0\n",
            out.display()
        ),
    )
    .unwrap();
    let mut perms = std::fs::metadata(&script).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script, perms).unwrap();

    let tools = PgToolPaths {
        pg_dump: script.to_string_lossy().into_owned(),
        pg_restore: String::new(),
        psql: String::new(),
    };
    let options = pg_dump_options(&out);
    let conn = pg_params();

    let job = JobControl::detached();
    let idle = std::time::Duration::from_millis(800);
    job.set_idle_timeout(idle);

    let started = std::time::Instant::now();
    let outcome = run_pg_dump_managed(&job, &conn, &options, &tools);
    let elapsed = started.elapsed();

    assert!(
        outcome.is_ok(),
        "a progressing dump was killed: {outcome:?}"
    );
    assert!(elapsed > idle, "the fixture must outlive the idle window");
    let _ = std::fs::remove_dir_all(&dir);
}

/// A dump that stops producing output is treated as hung and stopped instead of
/// waiting forever.
#[cfg(unix)]
#[test]
fn a_stalled_pg_dump_is_stopped_by_the_idle_bound() {
    use std::os::unix::fs::PermissionsExt;
    let dir = job_temp_dir("pg_dump_stall");
    let pid_file = dir.join("helper.pid");
    let out = dir.join("dump.out");
    let script = dir.join("pg_dump");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            pid_file.display()
        ),
    )
    .unwrap();
    let mut perms = std::fs::metadata(&script).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script, perms).unwrap();

    let tools = PgToolPaths {
        pg_dump: script.to_string_lossy().into_owned(),
        pg_restore: String::new(),
        psql: String::new(),
    };
    let options = pg_dump_options(&out);
    let conn = pg_params();

    let job = JobControl::detached();
    job.set_idle_timeout(std::time::Duration::from_millis(400));

    let outcome = run_pg_dump_managed(&job, &conn, &options, &tools);
    match outcome {
        Err(ref f) => assert!(!f.cancelled, "a stall is not a cancellation: {f:?}"),
        Ok(_) => panic!("a stalled dump must be stopped"),
    }
    let helper = wait_for_pid(&pid_file, std::time::Duration::from_secs(2));
    if let Some(helper) = helper {
        assert!(
            wait_until_dead(helper, std::time::Duration::from_secs(5)),
            "the stalled dump's helper {helper} survived"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// Cancelling a sync must kill both ends of the pipe.
#[cfg(unix)]
#[test]
fn cancelling_a_db_sync_kills_both_ends() {
    use std::os::unix::fs::PermissionsExt;
    let dir = job_temp_dir("pg_sync_cancel");
    let dump_pid = dir.join("dump.pid");
    let restore_pid = dir.join("restore.pid");
    let write_script = |name: &str, body: String| {
        let path = dir.join(name);
        std::fs::write(&path, body).unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
        path.to_string_lossy().into_owned()
    };

    let dump = write_script(
        "pg_dump",
        format!(
            "#!/bin/sh\necho $$ > '{}'\nwhile :; do echo x; sleep 0.05; done\n",
            dump_pid.display()
        ),
    );
    let restore = write_script(
        "pg_restore",
        format!(
            "#!/bin/sh\necho $$ > '{}'\nwhile :; do sleep 0.05; done\n",
            restore_pid.display()
        ),
    );

    let tools = PgToolPaths {
        pg_dump: dump,
        pg_restore: restore,
        psql: String::new(),
    };
    let job = JobControl::detached();
    let runner = job.clone();
    let source = pg_params();
    let target = pg_params();
    let handle = std::thread::spawn(move || {
        run_db_sync_managed(&runner, &source, &target, None, None, &tools)
    });

    let dp = wait_for_pid(&dump_pid, std::time::Duration::from_secs(5)).expect("dump pid");
    let rp = wait_for_pid(&restore_pid, std::time::Duration::from_secs(5)).expect("restore pid");

    job.cancel();
    let outcome = handle.join().unwrap();
    assert!(outcome.expect_err("cancelled").cancelled);
    assert!(
        wait_until_dead(dp, std::time::Duration::from_secs(5)),
        "dump survived"
    );
    assert!(
        wait_until_dead(rp, std::time::Duration::from_secs(5)),
        "restore survived"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// The MySQL dump path is owned the same way.
#[cfg(unix)]
#[test]
fn cancelling_a_mysql_dump_terminates_its_process_tree() {
    use std::os::unix::fs::PermissionsExt;
    let dir = job_temp_dir("mysql_dump_tree");
    let helper_pid = dir.join("helper.pid");
    let result_file = dir.join("dump.sql");
    let script = dir.join("mariadb-dump");
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'mariadb-dump 11.4.5-MariaDB'; exit 0; fi\nsh -c 'while :; do sleep 0.05; done' &\necho $! > '{}'\nwait\n",
            helper_pid.display()
        ),
    )
    .unwrap();
    let mut perms = std::fs::metadata(&script).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script, perms).unwrap();

    let tools = MySqlToolPaths {
        mysqldump: script.to_string_lossy().into_owned(),
        mysql: String::new(),
    };
    let conn = MySqlConnParams::new(
        "localhost".into(),
        3306,
        "root".into(),
        "app".into(),
        "secret".into(),
    );
    let options = MySqlBackupOptions {
        database: "app".into(),
        file_path: result_file.to_string_lossy().into_owned(),
        single_transaction: true,
        no_data: false,
        routines: true,
        triggers: true,
        events: false,
    };

    let job = JobControl::detached();
    let runner = job.clone();
    let handle =
        std::thread::spawn(move || run_mysql_dump_managed(&runner, &conn, &options, &tools, None));

    let helper = wait_for_pid(&helper_pid, std::time::Duration::from_secs(5)).expect("helper pid");
    job.cancel();
    let outcome = handle.join().unwrap();

    assert!(outcome.expect_err("cancelled").cancelled);
    assert!(
        wait_until_dead(helper, std::time::Duration::from_secs(5)),
        "the MySQL dump's helper {helper} survived cancellation"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A MySQL client that ignores `--version` must not hang job start-up, and the
/// bounded probe must answer promptly.
#[cfg(unix)]
#[test]
fn the_mariadb_version_probe_is_bounded() {
    use std::os::unix::fs::PermissionsExt;
    let dir = job_temp_dir("mariadb_probe");
    let script = dir.join("hanging-mariadb-dump");
    std::fs::write(&script, "#!/bin/sh\nsleep 30\n").unwrap();
    let mut perms = std::fs::metadata(&script).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&script, perms).unwrap();

    let started = std::time::Instant::now();
    let is_mariadb = client_is_mariadb(&script.to_string_lossy());
    let elapsed = started.elapsed();

    assert!(!is_mariadb);
    assert!(
        elapsed < std::time::Duration::from_secs(6),
        "the version probe was not bounded: {elapsed:?}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A failed job maps to a visible failure event with the tool's message, and a
/// cancelled job to a distinct cancelled event (the UI's recovery action keys
/// off these).
#[test]
fn job_outcomes_map_to_visible_progress_events() {
    let completed = progress_event("j1", &Ok(()));
    assert_eq!(completed.status, "completed");

    let failed = progress_event(
        "j1",
        &Err(JobFailure::failed("pg_dump: connection refused")),
    );
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error.as_deref(), Some("pg_dump: connection refused"));

    let cancelled = progress_event(
        "j1",
        &Err(JobFailure {
            message: CANCEL_MESSAGE.into(),
            cancelled: true,
        }),
    );
    assert_eq!(cancelled.status, "cancelled", "a cancel is not a failure");
    assert_eq!(cancelled.error.as_deref(), Some(CANCEL_MESSAGE));
}

#[test]
fn a_managed_cancellation_marks_the_failure_cancelled() {
    let failure = JobFailure::from(crate::job::JobError::Cancelled);
    assert!(failure.cancelled);
    // A tool error is never mistaken for a cancellation.
    let failure = JobFailure::failed("psql: syntax error");
    assert!(!failure.cancelled);
    // The in-process engines report a `KILL QUERY` abort with their own text.
    assert!(JobFailure::from_engine(QUERY_CANCEL_MESSAGE.to_string()).cancelled);
    assert!(JobFailure::from_engine(CANCEL_MESSAGE.to_string()).cancelled);
    assert!(!JobFailure::from_engine("Statement 3 of 9 failed".to_string()).cancelled);
}

/// SQLite in-process jobs are cancellable too, and a cancelled restore rolls
/// its transaction back instead of leaving a half-applied script.
#[cfg(unix)]
#[test]
fn sqlite_restore_cancellation_rolls_the_target_back() {
    let dir = job_temp_dir("sqlite_cancel");
    let target = dir.join("target.db");
    let conn = Connection::open(&target).unwrap();
    conn.execute_batch("CREATE TABLE keep (id INTEGER); INSERT INTO keep VALUES (1);")
        .unwrap();

    let dump = "CREATE TABLE new_table (id INTEGER);\nINSERT INTO new_table VALUES (7);\n";
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let is_cancelled = move || {
        // The clean phase already dropped `keep`; cancel before the second
        // replayed statement so the rollback (not the replay) is observed.
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) >= 1
    };

    let result = restore_sqlite_cancellable(&conn, dump, true, &is_cancelled);
    assert_eq!(
        result.unwrap_err(),
        CANCEL_MESSAGE,
        "must report a cancellation"
    );

    let count =
        |conn: &Connection, sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='keep'"
        ),
        1,
        "the clean phase dropped the table, so the transaction must roll back"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='new_table'"
        ),
        0,
        "a cancelled restore must apply nothing"
    );
    drop(conn);

    // Reopening the file shows the rollback is durable, not just in-memory.
    let conn = Connection::open(&target).unwrap();
    assert_eq!(count(&conn, "SELECT count(*) FROM keep"), 1);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn a_cancelled_sqlite_dump_reports_a_cancellation() {
    let dir = job_temp_dir("sqlite_dump_cancel");
    let src_path = dir.join("source.db");
    let src = Connection::open(&src_path).unwrap();
    src.execute_batch("CREATE TABLE a (id INTEGER); CREATE TABLE b (id INTEGER);")
        .unwrap();
    let mut out: Vec<u8> = Vec::new();
    let result =
        dump_sqlite_to_cancellable(&src, &mut std::io::Cursor::new(&mut out), |_| {}, &|| true);
    assert_eq!(result.unwrap_err(), CANCEL_MESSAGE);
    drop(src);
    let _ = std::fs::remove_dir_all(&dir);
}

/// A probe that timed out is reported in the tool status instead of looking
/// like "not installed" (which would send the user to install a tool they have).
#[test]
fn a_bounded_probe_failure_is_surfaced_in_the_tool_status() {
    let status = build_pg_tool_status_with(
        &ToolResolution::none(),
        &ToolResolution::none(),
        Some(
            "/opt/homebrew/bin/pg_dump — The tool did not respond within 1s and was stopped".into(),
        ),
        None,
    );
    assert!(!status.pg_dump_found);
    assert!(
        status
            .pg_dump_probe_error
            .as_deref()
            .unwrap_or_default()
            .contains("did not respond"),
        "the probe failure must be visible"
    );

    // A resolved tool has nothing to explain.
    let resolved = ToolResolution {
        resolved: Some(tool_resolver::Resolution {
            program: "/usr/bin/pg_dump".into(),
            source: tool_resolver::ToolSource::Path,
            name: "pg_dump".into(),
        }),
        bundled_path: None,
        bundled_available: false,
        version: Some("pg_dump 16".into()),
    };
    let status = build_pg_tool_status_with(
        &resolved,
        &ToolResolution::none(),
        Some("stale note".into()),
        None,
    );
    assert!(status.pg_dump_found);
    assert!(status.pg_dump_probe_error.is_none());
}

// ---------------------------------------------------------------------------
// Backup output is authorized by a File Grant, never by a renderer path
// ---------------------------------------------------------------------------

#[test]
fn a_raw_renderer_path_authorizes_no_backup_output() {
    let grants = crate::file_grant::FileGrantStore::new();

    // The exact string a pre-fix renderer would have sent as `options.filePath`.
    let err = resolve_backup_output(&grants, "/tmp/renderer-chosen.dump").unwrap_err();

    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "a bare path must be rejected as an invalid grant, got: {err}"
    );
}

#[test]
fn a_backup_grant_resolves_its_path_exactly_once() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/gridline-granted.dump"),
        crate::file_grant::FileIntent::Write,
    );

    assert_eq!(
        resolve_backup_output(&grants, &grant.id).unwrap(),
        "/tmp/gridline-granted.dump"
    );

    // Same grant, second job: consumed on first use.
    let replay = resolve_backup_output(&grants, &grant.id).unwrap_err();
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "a replayed grant must report the consumed state, got: {replay}"
    );
}

#[test]
fn a_read_grant_cannot_authorize_a_backup_write() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/restore-input.sql"),
        crate::file_grant::FileIntent::Read,
    );

    let err = resolve_backup_output(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "a read grant must not authorize a write, got: {err}"
    );
}

#[test]
fn an_expired_backup_grant_reports_the_expired_state() {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let base = std::time::Instant::now();
    let elapsed = Arc::new(AtomicU64::new(0));
    let clock: crate::file_grant::Clock = {
        let elapsed = elapsed.clone();
        Box::new(move || base + std::time::Duration::from_millis(elapsed.load(Ordering::SeqCst)))
    };
    let grants = crate::file_grant::FileGrantStore::with_clock(crate::file_grant::GRANT_TTL, clock);
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/stale.dump"),
        crate::file_grant::FileIntent::Write,
    );

    elapsed.store(5 * 60 * 1000 + 1, Ordering::SeqCst);

    let err = resolve_backup_output(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_EXPIRED),
        "an expired grant must report the expired state, got: {err}"
    );
}

#[test]
fn the_dump_request_types_carry_no_output_path() {
    // A renderer that still sends a path must fail loudly at the IPC boundary
    // rather than have it silently ignored (or, worse, used).
    let pg = serde_json::from_str::<PgDumpOptions>(
        r#"{"format":"plain","tables":null,"noOwner":true,"filePath":"/tmp/evil.dump"}"#,
    );
    assert!(
        pg.is_err(),
        "PgDumpOptions must reject a renderer-supplied output path"
    );

    let mysql = serde_json::from_str::<MySqlDumpOptions>(
        r#"{"database":"shop","singleTransaction":true,"noData":false,"routines":true,"triggers":true,"events":false,"filePath":"/tmp/evil.sql"}"#,
    );
    assert!(
        mysql.is_err(),
        "MySqlDumpOptions must reject a renderer-supplied output path"
    );

    // The same payload without a path is accepted.
    let ok =
        serde_json::from_str::<PgDumpOptions>(r#"{"format":"plain","tables":null,"noOwner":true}"#);
    assert!(ok.is_ok(), "a path-free dump request must be accepted");
}

#[test]
fn a_dump_request_takes_its_output_path_from_the_granted_path() {
    let request = PgDumpOptions {
        format: "custom".into(),
        schema: Some("public".into()),
        tables: None,
        no_owner: true,
    };
    let options = request.with_output_path("/tmp/granted.dump".to_string());

    assert_eq!(options.file_path, "/tmp/granted.dump");
    assert_eq!(options.format, "custom");
    assert_eq!(options.schema.as_deref(), Some("public"));
    assert!(options.no_owner);

    let mysql = MySqlDumpOptions {
        database: "shop".into(),
        single_transaction: true,
        no_data: false,
        routines: true,
        triggers: true,
        events: false,
    }
    .with_output_path("/tmp/granted.sql".to_string());
    assert_eq!(mysql.file_path, "/tmp/granted.sql");
    assert_eq!(mysql.database, "shop");
}

// ---------------------------------------------------------------------------
// Restore input is authorized by a Read File Grant, never by a renderer path
// ---------------------------------------------------------------------------

#[test]
fn a_raw_renderer_path_authorizes_no_restore_input() {
    let grants = crate::file_grant::FileGrantStore::new();

    // The exact string a pre-fix renderer would have sent as `options.filePath`.
    let err = resolve_restore_input(&grants, "/tmp/renderer-chosen.dump").unwrap_err();

    assert!(
        err.starts_with(crate::file_grant::CODE_INVALID),
        "a bare path must be rejected as an invalid grant, got: {err}"
    );
}

#[test]
fn a_restore_grant_resolves_its_path_exactly_once() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/gridline-granted.dump"),
        crate::file_grant::FileIntent::Read,
    );

    assert_eq!(
        resolve_restore_input(&grants, &grant.id).unwrap(),
        "/tmp/gridline-granted.dump"
    );

    // Same grant, second job: consumed on first use.
    let replay = resolve_restore_input(&grants, &grant.id).unwrap_err();
    assert!(
        replay.starts_with(crate::file_grant::CODE_CONSUMED),
        "a replayed grant must report the consumed state, got: {replay}"
    );
}

#[test]
fn a_backup_write_grant_cannot_authorize_a_restore_read() {
    let grants = crate::file_grant::FileGrantStore::new();
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/backup-output.dump"),
        crate::file_grant::FileIntent::Write,
    );

    let err = resolve_restore_input(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_WRONG_INTENT),
        "a write grant must not authorize a restore read, got: {err}"
    );
}

#[test]
fn an_expired_restore_grant_reports_the_expired_state() {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    let base = std::time::Instant::now();
    let elapsed = Arc::new(AtomicU64::new(0));
    let clock: crate::file_grant::Clock = {
        let elapsed = elapsed.clone();
        Box::new(move || base + std::time::Duration::from_millis(elapsed.load(Ordering::SeqCst)))
    };
    let grants = crate::file_grant::FileGrantStore::with_clock(crate::file_grant::GRANT_TTL, clock);
    let grant = grants.mint(
        std::path::PathBuf::from("/tmp/stale.dump"),
        crate::file_grant::FileIntent::Read,
    );

    elapsed.store(5 * 60 * 1000 + 1, Ordering::SeqCst);

    let err = resolve_restore_input(&grants, &grant.id).unwrap_err();
    assert!(
        err.starts_with(crate::file_grant::CODE_EXPIRED),
        "an expired grant must report the expired state, got: {err}"
    );
}

/// Ticket 33: the non-atomic acceptance is an explicit, per-request decision, and
/// an absent one defaults to "refused" so a stale renderer cannot opt in by
/// omission.
#[test]
fn a_restore_request_defaults_to_refusing_a_non_atomic_run() {
    let silent: PgRestoreRequest =
        serde_json::from_str(r#"{"format":"plain","clean":false}"#).unwrap();
    assert!(
        !silent.accept_non_atomic,
        "an acceptance must be explicit, never implied"
    );

    let accepted: PgRestoreRequest =
        serde_json::from_str(r#"{"format":"plain","clean":false,"acceptNonAtomic":true}"#).unwrap();
    assert!(accepted.accept_non_atomic);
}

#[test]
fn the_restore_request_types_carry_no_input_path() {
    // A renderer that still sends a path must fail loudly at the IPC boundary
    // rather than have it silently ignored (or, worse, used to read a file).
    let pg = serde_json::from_str::<PgRestoreRequest>(
        r#"{"format":"custom","clean":true,"schema":null,"filePath":"/tmp/evil.dump"}"#,
    );
    assert!(
        pg.is_err(),
        "PgRestoreRequest must reject a renderer-supplied input path"
    );

    let mysql = serde_json::from_str::<MySqlRestoreRequest>(
        r#"{"database":"shop","clean":true,"filePath":"/tmp/evil.sql"}"#,
    );
    assert!(
        mysql.is_err(),
        "MySqlRestoreRequest must reject a renderer-supplied input path"
    );

    let sqlite = serde_json::from_str::<SqliteRestoreRequest>(
        r#"{"clean":true,"filePath":"/tmp/evil.sql"}"#,
    );
    assert!(
        sqlite.is_err(),
        "SqliteRestoreRequest must reject a renderer-supplied input path"
    );

    // The same payloads without a path are accepted.
    assert!(serde_json::from_str::<PgRestoreRequest>(
        r#"{"format":"custom","clean":true,"schema":null}"#
    )
    .is_ok());
    assert!(
        serde_json::from_str::<SqliteRestoreRequest>(r#"{"clean":false}"#).is_ok(),
        "a path-free restore request must be accepted"
    );
}

#[test]
fn a_restore_request_takes_its_input_path_from_the_granted_path() {
    let options = PgRestoreRequest {
        format: "plain".into(),
        clean: true,
        schema: Some("public".into()),
        accept_non_atomic: false,
    }
    .with_source_path("/tmp/granted.dump".to_string());

    assert_eq!(options.file_path, "/tmp/granted.dump");
    assert_eq!(options.format, "plain");
    assert_eq!(options.schema.as_deref(), Some("public"));
    assert!(options.clean);

    let mysql = MySqlRestoreRequest {
        database: "shop".into(),
        clean: false,
    }
    .with_source_path("/tmp/granted.sql".to_string());
    assert_eq!(mysql.file_path, "/tmp/granted.sql");
    assert_eq!(mysql.database, "shop");

    let sqlite = SqliteRestoreRequest { clean: true }
        .with_source_path("/tmp/granted.sqlite.sql".to_string());
    assert_eq!(sqlite.file_path, "/tmp/granted.sqlite.sql");
    assert!(sqlite.clean);
}
