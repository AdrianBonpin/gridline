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
