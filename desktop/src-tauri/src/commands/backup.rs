use rusqlite::{types::ValueRef, Connection};
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::models::backup::*;

// ---------------------------------------------------------------------------
// Connection params (decoupled from store/keychain so logic is headless-testable)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct PgConnParams {
    pub host: String,
    pub port: i64,
    pub username: String,
    pub database: String,
    pub password: String,
}

impl PgConnParams {
    pub fn new(
        host: String,
        port: i64,
        username: String,
        database: String,
        password: String,
    ) -> Self {
        Self {
            host,
            port,
            username,
            database,
            password,
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn get_version(tool: &str) -> Option<String> {
    Command::new(tool)
        .arg("--version")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

fn sanitize_error(s: &str) -> String {
    crate::commands::test_connection::sanitize_error(s)
}

fn bundled_bin_name(tool: &str) -> String {
    if cfg!(windows) { format!("{tool}.exe") } else { tool.to_string() }
}

/// Pure resolution decision (unit-testable): system > bundled > bare name.
fn pick_tool(system_ok: bool, bundled: Option<&str>, tool: &str) -> (String, Option<String>) {
    if system_ok { return (tool.to_string(), Some("system".to_string())); }
    if let Some(b) = bundled { return (b.to_string(), Some("bundled".to_string())); }
    (tool.to_string(), None)
}

/// System-first, bundled-fallback resolver. Returns (command_to_invoke, source).
pub fn resolve_tool(app: &AppHandle, tool: &str) -> (String, Option<String>) {
    let system_ok = Command::new(tool).arg("--version").output().is_ok();
    let bundled = app.path().resource_dir().ok()
        .map(|rd| rd.join("pg_tools").join(bundled_bin_name(tool)))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());
    pick_tool(system_ok, bundled.as_deref(), tool)
}

pub fn resolve_tool_paths(app: &AppHandle) -> PgToolPaths {
    let (d, _) = resolve_tool(app, "pg_dump");
    let (r, _) = resolve_tool(app, "pg_restore");
    let (p, _) = resolve_tool(app, "psql");
    PgToolPaths { pg_dump: d, pg_restore: r, psql: p }
}

// ---------------------------------------------------------------------------
// detect_pg_tools
// ---------------------------------------------------------------------------

/// Shapes the tool status from resolved tool paths + sources. Headless so the
/// Tauri command stays thin and the status logic stays unit-testable.
fn build_pg_tool_status(
    dump: &str,
    restore: &str,
    dump_src: Option<String>,
    restore_src: Option<String>,
) -> PgToolStatus {
    PgToolStatus {
        pg_dump_found: Command::new(dump).arg("--version").output().is_ok(),
        pg_restore_found: Command::new(restore).arg("--version").output().is_ok(),
        pg_dump_version: get_version(dump),
        pg_restore_version: get_version(restore),
        pg_dump_source: dump_src,
        pg_restore_source: restore_src,
    }
}

#[tauri::command]
pub fn detect_pg_tools(app_handle: AppHandle) -> PgToolStatus {
    let (dump, dump_src) = resolve_tool(&app_handle, "pg_dump");
    let (restore, restore_src) = resolve_tool(&app_handle, "pg_restore");
    build_pg_tool_status(&dump, &restore, dump_src, restore_src)
}

// ---------------------------------------------------------------------------
// Core logic (headless-testable — no Tauri, no store, no keychain)
// ---------------------------------------------------------------------------

/// Builds the base connection args shared by pg_dump and pg_restore.
fn base_conn_args(conn: &PgConnParams) -> Vec<String> {
    vec![
        format!("--host={}", conn.host),
        format!("--port={}", conn.port),
        format!("--username={}", conn.username),
        format!("--dbname={}", conn.database),
    ]
}

/// Builds pg_dump args (excluding the --file flag, which is added by the caller).
fn build_dump_args(conn: &PgConnParams, options: &BackupOptions) -> Vec<String> {
    let mut args = base_conn_args(conn);

    match options.format.as_str() {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {} // "plain" is the default — no format flag needed
    }

    if options.no_owner {
        args.push("--no-owner".into());
    }

    if let Some(ref schema) = options.schema {
        args.push(format!("--schema={schema}"));
    }

    if let Some(ref tables) = options.tables {
        for t in tables {
            args.push(format!("--table={t}"));
        }
    }

    args
}

/// Builds pg_restore args (file path is passed positionally by the caller).
fn build_restore_args(conn: &PgConnParams, options: &RestoreOptions) -> Vec<String> {
    let mut args = base_conn_args(conn);

    match options.format.as_str() {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {}
    }

    if options.clean {
        args.push("--clean".into());
        args.push("--if-exists".into());
    }

    if let Some(ref schema) = options.schema {
        args.push(format!("--schema={schema}"));
    }

    args
}

/// Runs `pg_dump` against `conn`, writing to `options.file_path`.
/// Returns `Ok(())` on success or a sanitized error message.
pub fn run_pg_dump(conn: &PgConnParams, options: &BackupOptions, tools: &PgToolPaths) -> Result<(), String> {
    let mut args = build_dump_args(conn, options);
    args.push(format!("--file={}", options.file_path));

    let result = Command::new(&tools.pg_dump)
        .env("PGPASSWORD", &conn.password)
        .args(&args)
        .output();

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(sanitize_error(&String::from_utf8_lossy(&output.stderr))),
        Err(e) => Err(e.to_string()),
    }
}

/// Runs `pg_restore` against `conn`, reading from `options.file_path`.
/// Returns `Ok(())` on success or a sanitized error message.
///
/// Plain-format dumps are SQL text and cannot be read by `pg_restore` — they
/// are executed with `psql` instead. The `clean` option is only honored for
/// archive formats (custom/tar/directory); the UI disables it for plain.
pub fn run_pg_restore(conn: &PgConnParams, options: &RestoreOptions, tools: &PgToolPaths) -> Result<(), String> {
    if options.format == "plain" {
        let result = Command::new(&tools.psql)
            .env("PGPASSWORD", &conn.password)
            .args([
                format!("--host={}", conn.host),
                format!("--port={}", conn.port),
                format!("--username={}", conn.username),
                format!("--dbname={}", conn.database),
                format!("--file={}", options.file_path),
            ])
            .output();

        return match result {
            Ok(output) if output.status.success() => Ok(()),
            Ok(output) => Err(sanitize_error(&String::from_utf8_lossy(&output.stderr))),
            Err(e) => Err(e.to_string()),
        };
    }

    let mut args = build_restore_args(conn, options);
    args.push(options.file_path.clone());

    let result = Command::new(&tools.pg_restore)
        .env("PGPASSWORD", &conn.password)
        .args(&args)
        .output();

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(sanitize_error(&String::from_utf8_lossy(&output.stderr))),
        Err(e) => Err(e.to_string()),
    }
}

/// Runs a DB-to-DB sync: `pg_dump` on `source` piped into `pg_restore` on `target`.
/// Returns `Ok(())` on success or a sanitized error message.
pub fn run_db_sync(
    source: &PgConnParams,
    target: &PgConnParams,
    schema: Option<&str>,
    tables: Option<&[String]>,
    tools: &PgToolPaths,
) -> Result<(), String> {
    // --- Build pg_dump args ---
    let mut dump_args = base_conn_args(source);
    dump_args.push("--format=c".into()); // binary custom format for reliable piping
    dump_args.push("--no-owner".into());

    if let Some(schema) = schema {
        dump_args.push(format!("--schema={schema}"));
    }

    if let Some(tables) = tables {
        for t in tables {
            dump_args.push(format!("--table={t}"));
        }
    }

    // --- Build pg_restore args ---
    // --clean --if-exists makes sync work into a non-empty target (the UI
    // already requires a destructive-overwrite confirmation).
    let mut restore_args = base_conn_args(target);
    restore_args.push("--no-owner".into());
    restore_args.push("--clean".into());
    restore_args.push("--if-exists".into());

    // --- Spawn pg_dump with piped stdout ---
    let mut dump_child = Command::new(&tools.pg_dump)
        .env("PGPASSWORD", &source.password)
        .args(&dump_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pg_dump: {e}"))?;

    let dump_stdout = dump_child.stdout.take().unwrap();
    let dump_stderr_reader = dump_child.stderr.take().unwrap();

    // Read pg_dump stderr in a separate thread so the pipe doesn't block
    let dump_stderr_handle = std::thread::spawn(move || {
        use std::io::Read;
        let mut buf = String::new();
        let _ = dump_stderr_reader
            .take(10 * 1024 * 1024) // cap at 10 MiB
            .read_to_string(&mut buf);
        buf
    });

    // --- Run pg_restore with pg_dump stdout as stdin ---
    let restore_result = Command::new(&tools.pg_restore)
        .env("PGPASSWORD", &target.password)
        .args(&restore_args)
        .stdin(dump_stdout)
        .output();

    // Wait for pg_dump to finish
    let dump_status = dump_child.wait();
    let dump_stderr = dump_stderr_handle.join().unwrap_or_default();

    // --- Check results ---
    let dump_failed = match dump_status {
        Ok(status) => !status.success(),
        Err(_) => true,
    };

    if dump_failed {
        return Err(format!("pg_dump failed: {}", sanitize_error(&dump_stderr)));
    }

    match restore_result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(format!(
            "pg_restore failed: {}",
            sanitize_error(&String::from_utf8_lossy(&output.stderr))
        )),
        Err(e) => Err(format!("pg_restore failed: {e}")),
    }
}

// ---------------------------------------------------------------------------
// SQLite dump / restore / sync (headless-testable core)
// ---------------------------------------------------------------------------

/// Quote a SQLite identifier with double quotes (preserving the spec's no-injection rule).
fn sqlite_quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// SQL literal for a rusqlite value (mirrors sqlite3 .dump output).
fn sqlite_literal(v: ValueRef) -> String {
    match v {
        ValueRef::Null => "NULL".to_string(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(r) => r.to_string(),
        ValueRef::Text(t) => format!("'{}'", String::from_utf8_lossy(t).replace('\'', "''")),
        ValueRef::Blob(b) => {
            format!("X'{}'", b.iter().map(|x| format!("{:02x}", x)).collect::<String>())
        }
    }
}

/// Generate a `.dump`-format SQL script from `conn`, streaming to `out`. Calls
/// `on_progress(table_name)` per table. Fails closed on virtual tables.
pub fn dump_sqlite_to<W: Write, F: FnMut(&str)>(
    conn: &Connection,
    out: &mut W,
    mut on_progress: F,
) -> Result<(), String> {
    writeln!(out, "PRAGMA foreign_keys=OFF;").map_err(|e| e.to_string())?;
    writeln!(out, "BEGIN TRANSACTION;").map_err(|e| e.to_string())?;

    // 1. Tables (schema + data), fail-closed on virtual tables.
    let table_names: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name")
        .map_err(|e| e.to_string())?
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for name in &table_names {
        let create_sql: String = conn
            .query_row("SELECT sql FROM sqlite_master WHERE type='table' AND name=?1", [name], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        if create_sql.to_lowercase().contains("create virtual table") {
            return Err(format!(
                "SQLite virtual tables are not supported for .dump in v0.7.8 (table: {name})"
            ));
        }
        writeln!(out, "{create_sql};").map_err(|e| e.to_string())?;
        on_progress(name);

        // Columns excluding generated/hidden (hidden != 0) via pragma_table_xinfo.
        let xinfo: Vec<(String, i64)> = conn
            .prepare(&format!(
                "SELECT name, hidden FROM pragma_table_xinfo(\"{}\")",
                name.replace('"', "\"\"")
            ))
            .map_err(|e| e.to_string())?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let emitted: Vec<String> = xinfo.iter().filter(|(_, h)| *h == 0).map(|(n, _)| n.clone()).collect();
        let col_list = emitted.iter().map(|n| sqlite_quote_ident(n)).collect::<Vec<_>>().join(", ");
        // Emit one INSERT per row (faithful to .dump).
        let select = format!(
            "SELECT {} FROM \"{}\"",
            emitted.iter().map(|n| sqlite_quote_ident(n)).collect::<Vec<_>>().join(", "),
            name.replace('"', "\"\"")
        );
        let mut stmt = conn.prepare(&select).map_err(|e| e.to_string())?;
        let nrows = stmt
            .query_map([], |row| {
                let vals: Vec<String> = (0..emitted.len())
                    .map(|i| sqlite_literal(row.get_ref(i).unwrap_or(ValueRef::Null)))
                    .collect();
                Ok(format!(
                    "INSERT INTO {} ({}) VALUES ({});",
                    sqlite_quote_ident(name),
                    col_list,
                    vals.join(", ")
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in nrows.filter_map(|r| r.ok()) {
            writeln!(out, "{r}").map_err(|e| e.to_string())?;
        }
    }

    // 2. Indexes, triggers, views (sql not null).
    for ty in ["index", "trigger", "view"] {
        let sqls: Vec<String> = conn
            .prepare("SELECT sql FROM sqlite_master WHERE type=?1 AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| e.to_string())?
            .query_map([ty], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for s in sqls {
            writeln!(out, "{s};").map_err(|e| e.to_string())?;
        }
    }

    // 3. sqlite_sequence (AUTOINCREMENT counters) if it exists.
    if conn
        .prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'")
        .map_err(|e| e.to_string())?
        .exists([])
        .unwrap_or(false)
    {
        writeln!(out, "DELETE FROM sqlite_sequence;").map_err(|e| e.to_string())?;
        let rows: Vec<(String, i64)> = conn
            .prepare("SELECT name, seq FROM sqlite_sequence")
            .map_err(|e| e.to_string())?
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (t, seq) in rows {
            writeln!(
                out,
                "INSERT INTO sqlite_sequence VALUES ('{}', {});",
                t.replace('\'', "''"),
                seq
            )
            .map_err(|e| e.to_string())?;
        }
    }

    writeln!(out, "COMMIT;").map_err(|e| e.to_string())?;
    Ok(())
}

/// Restore a `.dump` SQL script into `conn`. `clean` drops existing
/// user tables/views/indexes/triggers first.
pub fn restore_sqlite(conn: &Connection, dump_text: &str, clean: bool) -> Result<(), String> {
    if clean {
        let names: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view','index','trigger') AND name NOT LIKE 'sqlite_%' ORDER BY type DESC")
            .map_err(|e| e.to_string())?
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        conn.execute_batch("PRAGMA foreign_keys=OFF;").map_err(|e| e.to_string())?;
        for n in names {
            let _ = conn.execute(&format!("DROP TABLE IF EXISTS \"{}\"", n.replace('"', "\"\"")), []);
            let _ = conn.execute(&format!("DROP VIEW IF EXISTS \"{}\"", n.replace('"', "\"\"")), []);
            let _ = conn.execute(&format!("DROP INDEX IF EXISTS \"{}\"", n.replace('"', "\"\"")), []);
            let _ = conn.execute(&format!("DROP TRIGGER IF EXISTS \"{}\"", n.replace('"', "\"\"")), []);
        }
    }
    // The dump text already wraps in PRAGMA foreign_keys=OFF + BEGIN/COMMIT.
    conn.execute_batch(dump_text).map_err(|e| format!("restore failed: {e}"))
}

/// Dump `source_path` and restore into `target_path` (one-shot).
pub fn run_sqlite_sync(source_path: &str, target_path: &str) -> Result<(), String> {
    let src = Connection::open(source_path).map_err(|e| format!("open source: {e}"))?;
    let mut buf: Vec<u8> = Vec::new();
    dump_sqlite_to(&src, &mut std::io::Cursor::new(&mut buf), |_| {})?;
    let text = String::from_utf8(buf).map_err(|e| e.to_string())?;
    let dst = Connection::open(target_path).map_err(|e| format!("open target: {e}"))?;
    restore_sqlite(&dst, &text, true)
}

// ---------------------------------------------------------------------------
// MySQL dump / restore / sync (headless-testable core)
// ---------------------------------------------------------------------------

fn base_mysql_args(conn: &MySqlConnParams) -> Vec<String> {
    vec![
        format!("--host={}", conn.host),
        format!("--port={}", conn.port),
        format!("--user={}", conn.username),
    ]
}

/// `mariadb-dump`/`mysqldump` args. Passwords go via MYSQL_PWD env (set by the
/// command), NEVER --password (process-list visibility).
pub fn build_mysql_dump_args(conn: &MySqlConnParams, options: &MySqlBackupOptions) -> Vec<String> {
    let mut a = base_mysql_args(conn);
    if options.single_transaction { a.push("--single-transaction".into()); }
    if options.no_data { a.push("--no-data".into()); }
    if options.routines { a.push("--routines".into()); }
    if options.triggers { a.push("--triggers".into()); }
    if options.events { a.push("--events".into()); }
    a.push(format!("--databases={}", options.database));
    a.push(format!("--result-file={}", options.file_path));
    a.push("--skip-column-statistics".into());
    a
}

pub fn build_mysql_restore_args(conn: &MySqlConnParams, options: &MySqlRestoreOptions) -> Vec<String> {
    let mut a = base_mysql_args(conn);
    a.push(format!("--database={}", options.database));
    a
}

/// System-first mariadb-dump/mariadb (bundled fallback in resources/mysql_tools).
pub fn resolve_mysql_tool(app: &AppHandle, tool: &str) -> (String, Option<String>) {
    let system_ok = Command::new(tool).arg("--version").output().is_ok();
    let bundled = app.path().resource_dir().ok()
        .map(|rd| rd.join("mysql_tools").join(bundled_bin_name(tool)))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string());
    pick_tool(system_ok, bundled.as_deref(), tool)
}

pub fn resolve_mysql_tool_paths(app: &AppHandle) -> MySqlToolPaths {
    let (d, _) = resolve_mysql_tool(app, "mariadb-dump");
    let (m, _) = resolve_mysql_tool(app, "mariadb");
    MySqlToolPaths { mysqldump: d, mysql: m }
}

/// Headless core: spawn dump with MYSQL_PWD env. `tls_mode` (e.g. `REQUIRED`)
/// is appended as `--ssl-mode=` when routing through an SSH tunnel. (Live
/// behavior = #[ignore] integration test.)
pub fn run_mysql_dump(
    conn: &MySqlConnParams,
    options: &MySqlBackupOptions,
    tools: &MySqlToolPaths,
    tls_mode: Option<&str>,
) -> Result<(), String> {
    let mut args = build_mysql_dump_args(conn, options);
    if let Some(m) = tls_mode {
        args.push(format!("--ssl-mode={m}"));
    }
    let out = Command::new(&tools.mysqldump).env("MYSQL_PWD", &conn.password).args(&args).output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(sanitize_error(&String::from_utf8_lossy(&out.stderr))) }
}

pub fn run_mysql_restore(
    conn: &MySqlConnParams,
    options: &MySqlRestoreOptions,
    tools: &MySqlToolPaths,
    tls_mode: Option<&str>,
) -> Result<(), String> {
    let mut args = build_mysql_restore_args(conn, options);
    if let Some(m) = tls_mode {
        args.push(format!("--ssl-mode={m}"));
    }
    let file = std::fs::File::open(&options.file_path).map_err(|e| format!("open dump: {e}"))?;
    let out = Command::new(&tools.mysql).env("MYSQL_PWD", &conn.password).args(&args).stdin(Stdio::from(file)).output()
        .map_err(|e| e.to_string())?;
    if out.status.success() { Ok(()) } else { Err(sanitize_error(&String::from_utf8_lossy(&out.stderr))) }
}

pub fn run_mysql_sync(
    source: &MySqlConnParams,
    target: &MySqlConnParams,
    tools: &MySqlToolPaths,
    tls_mode: Option<&str>,
) -> Result<(), String> {
    let mut dump_args = base_mysql_args(source);
    dump_args.push("--single-transaction".into());
    dump_args.push("--add-drop-table".into());
    dump_args.push(format!("--databases={}", source.database));
    if let Some(m) = tls_mode {
        dump_args.push(format!("--ssl-mode={m}"));
    }
    let mut dump = Command::new(&tools.mysqldump).env("MYSQL_PWD", &source.password).args(&dump_args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("dump: {e}"))?;
    let stdout = dump.stdout.take().unwrap();
    let mut restore_args = base_mysql_args(target);
    restore_args.push(format!("--database={}", target.database));
    let restore = Command::new(&tools.mysql).env("MYSQL_PWD", &target.password).args(&restore_args).stdin(stdout).output();
    let _ = dump.wait();
    match restore {
        Ok(o) if o.status.success() => Ok(()),
        Ok(o) => Err(format!("restore: {}", sanitize_error(&String::from_utf8_lossy(&o.stderr)))),
        Err(e) => Err(format!("restore: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (thin wrappers: store lookup + keychain + event emission)
// ---------------------------------------------------------------------------

fn emit_result(app_handle: &AppHandle, job_id: &str, result: Result<(), String>) {
    let event = match result {
        Ok(()) => BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "completed".into(),
            progress: Some(1.0),
            output_line: None,
            error: None,
        },
        Err(e) => BackupProgressEvent {
            job_id: job_id.to_string(),
            status: "failed".into(),
            progress: None,
            output_line: None,
            error: Some(e),
        },
    };
    let _ = app_handle.emit("backup-progress", event);
}

#[tauri::command]
pub async fn pg_dump(
    connection_id: String,
    options: BackupOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Get connection from store (scope the std::sync::Mutex lock guard)
    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    // Get password from keychain
    let password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &connection_id)
            .unwrap_or_default()
            .unwrap_or_default();

    let params = PgConnParams::new(
        conn.host.clone(),
        conn.port.unwrap_or(5432),
        conn.username.unwrap_or_else(|| "postgres".into()),
        conn.database.unwrap_or_else(|| "postgres".into()),
        password,
    );

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);

    tokio::task::spawn_blocking(move || {
        let result = run_pg_dump(&params, &options, &tools);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn pg_restore(
    connection_id: String,
    options: RestoreOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &connection_id)
            .unwrap_or_default()
            .unwrap_or_default();

    let params = PgConnParams::new(
        conn.host.clone(),
        conn.port.unwrap_or(5432),
        conn.username.unwrap_or_else(|| "postgres".into()),
        conn.database.unwrap_or_else(|| "postgres".into()),
        password,
    );

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);

    tokio::task::spawn_blocking(move || {
        let result = run_pg_restore(&params, &options, &tools);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn db_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Get both connections from store
    let (source_conn, target_conn) = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;

        let src = connections
            .iter()
            .find(|c| c.id == options.source_connection_id)
            .ok_or_else(|| {
                format!(
                    "Source connection not found: {}",
                    options.source_connection_id
                )
            })?
            .clone();

        let tgt = connections
            .iter()
            .find(|c| c.id == options.target_connection_id)
            .ok_or_else(|| {
                format!(
                    "Target connection not found: {}",
                    options.target_connection_id
                )
            })?
            .clone();

        (src, tgt)
    };

    // Get passwords
    let src_password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &source_conn.id)
            .unwrap_or_default()
            .unwrap_or_default();

    let tgt_password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &target_conn.id)
            .unwrap_or_default()
            .unwrap_or_default();

    let source = PgConnParams::new(
        source_conn.host.clone(),
        source_conn.port.unwrap_or(5432),
        source_conn
            .username
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        source_conn
            .database
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        src_password,
    );

    let target = PgConnParams::new(
        target_conn.host.clone(),
        target_conn.port.unwrap_or(5432),
        target_conn
            .username
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        target_conn
            .database
            .clone()
            .unwrap_or_else(|| "postgres".into()),
        tgt_password,
    );

    let schema = options.schema.clone();
    let tables = options.tables.clone();
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    let tools = resolve_tool_paths(&app_handle);

    tokio::task::spawn_blocking(move || {
        let result = run_db_sync(&source, &target, schema.as_deref(), tables.as_deref(), &tools);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// MySQL dump / restore / sync commands (v0.7.8)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_mysql_tools(app_handle: AppHandle) -> MySqlToolStatus {
    let (d, ds) = resolve_mysql_tool(&app_handle, "mariadb-dump");
    let (m, ms) = resolve_mysql_tool(&app_handle, "mariadb");
    MySqlToolStatus {
        mysqldump_found: Command::new(&d).arg("--version").output().is_ok(),
        mysql_found: Command::new(&m).arg("--version").output().is_ok(),
        mysqldump_version: get_version(&d),
        mysql_version: get_version(&m),
        mysqldump_source: ds,
        mysql_source: ms,
    }
}

/// Resolve (host, port, via_tunnel) for a MySQL connection, routing through the
/// SSH tunnel endpoint when present.
fn mysql_endpoint(
    state: &crate::AppState,
    connection_id: &str,
    conn: &crate::models::Connection,
) -> (String, i64, bool) {
    let via_tunnel = state.ssh_manager.lock().unwrap().get_local_port(connection_id);
    if let Some(port) = via_tunnel {
        return ("127.0.0.1".into(), port as i64, true);
    }
    (conn.host.clone(), conn.port.unwrap_or(3306), false)
}

#[tauri::command]
pub async fn mysql_dump(
    connection_id: String,
    options: MySqlBackupOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &connection_id)
            .unwrap_or_default()
            .unwrap_or_default();

    let (host, port, via_tunnel) = mysql_endpoint(&state, &connection_id, &conn);
    let params = MySqlConnParams::new(
        host,
        port,
        conn.username.clone().unwrap_or_else(|| "root".into()),
        options.database.clone(),
        password,
    );
    let tools = resolve_mysql_tool_paths(&app_handle);
    let tls = if via_tunnel { Some("REQUIRED") } else { None };

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_mysql_dump(&params, &options, &tools, tls);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn mysql_restore(
    connection_id: String,
    options: MySqlRestoreOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &connection_id)
            .unwrap_or_default()
            .unwrap_or_default();

    let (host, port, via_tunnel) = mysql_endpoint(&state, &connection_id, &conn);
    let params = MySqlConnParams::new(
        host,
        port,
        conn.username.clone().unwrap_or_else(|| "root".into()),
        options.database.clone(),
        password,
    );
    let tools = resolve_mysql_tool_paths(&app_handle);
    let tls = if via_tunnel { Some("REQUIRED") } else { None };

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_mysql_restore(&params, &options, &tools, tls);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn mysql_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Get both connections from store
    let (source_conn, target_conn) = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;

        let src = connections
            .iter()
            .find(|c| c.id == options.source_connection_id)
            .ok_or_else(|| {
                format!(
                    "Source connection not found: {}",
                    options.source_connection_id
                )
            })?
            .clone();

        let tgt = connections
            .iter()
            .find(|c| c.id == options.target_connection_id)
            .ok_or_else(|| {
                format!(
                    "Target connection not found: {}",
                    options.target_connection_id
                )
            })?
            .clone();

        (src, tgt)
    };

    let src_password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &source_conn.id)
            .unwrap_or_default()
            .unwrap_or_default();
    let tgt_password =
        crate::commands::keychain::get_connection_password_internal(&app_handle, &target_conn.id)
            .unwrap_or_default()
            .unwrap_or_default();

    let (src_host, src_port, src_via_tunnel) = mysql_endpoint(&state, &source_conn.id, &source_conn);
    let (tgt_host, tgt_port, tgt_via_tunnel) = mysql_endpoint(&state, &target_conn.id, &target_conn);

    let source = MySqlConnParams::new(
        src_host,
        src_port,
        source_conn
            .username
            .clone()
            .unwrap_or_else(|| "root".into()),
        source_conn
            .database
            .clone()
            .unwrap_or_else(|| "mysql".into()),
        src_password,
    );
    let target = MySqlConnParams::new(
        tgt_host,
        tgt_port,
        target_conn
            .username
            .clone()
            .unwrap_or_else(|| "root".into()),
        target_conn
            .database
            .clone()
            .unwrap_or_else(|| "mysql".into()),
        tgt_password,
    );

    let tools = resolve_mysql_tool_paths(&app_handle);
    // Through a tunnel the peer is loopback, so force encrypt-only `REQUIRED`
    // (mirrors how the app degrades verify-ca/verify-full through tunnels).
    let tls = if src_via_tunnel || tgt_via_tunnel {
        Some("REQUIRED")
    } else {
        None
    };

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_mysql_sync(&source, &target, &tools, tls);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// SQLite dump / restore / sync commands (v0.7.8) — the stored `conn.host` IS
// the SQLite file path; each command opens its own connection in the blocking
// task (the pool's SQLite handle is never touched).
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn sqlite_dump(
    connection_id: String,
    options: SqliteBackupOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let path = conn.host.clone();
    let out_path = options.file_path.clone();
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = (|| -> Result<(), String> {
            let src = Connection::open(&path).map_err(|e| format!("open source: {e}"))?;
            let mut out =
                std::fs::File::create(&out_path).map_err(|e| format!("create dump file: {e}"))?;
            dump_sqlite_to(&src, &mut out, |_| {})
        })();
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn sqlite_restore(
    connection_id: String,
    options: SqliteRestoreOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let path = conn.host.clone();
    let in_path = options.file_path.clone();
    let clean = options.clean;
    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = (|| -> Result<(), String> {
            let dst = Connection::open(&path).map_err(|e| format!("open target: {e}"))?;
            let text =
                std::fs::read_to_string(&in_path).map_err(|e| format!("read dump: {e}"))?;
            restore_sqlite(&dst, &text, clean)
        })();
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

#[tauri::command]
pub async fn sqlite_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let (source_path, target_path) = {
        let store = state.db_store.lock().map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;

        let src = connections
            .iter()
            .find(|c| c.id == options.source_connection_id)
            .ok_or_else(|| {
                format!(
                    "Source connection not found: {}",
                    options.source_connection_id
                )
            })?
            .clone();

        let tgt = connections
            .iter()
            .find(|c| c.id == options.target_connection_id)
            .ok_or_else(|| {
                format!(
                    "Target connection not found: {}",
                    options.target_connection_id
                )
            })?
            .clone();

        (src.host, tgt.host)
    };

    let job_id_clone = job_id.clone();
    let app_handle_clone = app_handle.clone();
    tokio::task::spawn_blocking(move || {
        let result = run_sqlite_sync(&source_path, &target_path);
        emit_result(&app_handle_clone, &job_id_clone, result);
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/// Builds command-line args using hardcoded values for testing.
/// Mirrors the logic used by `pg_dump` and `pg_restore` commands.
#[cfg(test)]
pub(crate) fn build_args_for_test(
    tool: &str,
    dbname: &str,
    format: &str,
    file_path: &str,
    no_owner: bool,
    schema: Option<&str>,
    tables: Option<Vec<&str>>,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--host=localhost".into(),
        "--port=5432".into(),
        "--username=postgres".into(),
        format!("--dbname={dbname}"),
    ];

    match format {
        "custom" => args.push("--format=c".into()),
        "tar" => args.push("--format=t".into()),
        "directory" => args.push("--format=d".into()),
        _ => {} // "plain" is default
    }

    if no_owner {
        args.push("--no-owner".into());
    }

    if let Some(ref schema) = schema {
        args.push(format!("--schema={schema}"));
    }

    if let Some(ref tables) = tables {
        for t in tables {
            args.push(format!("--table={t}"));
        }
    }

    if tool == "pg_dump" {
        args.push(format!("--file={file_path}"));
    } else {
        // pg_restore
        args.push(file_path.into());
    }

    args
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
#[path = "backup.test.rs"]
mod tests;
