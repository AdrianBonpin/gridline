use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, State};

use crate::models::backup::*;

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

// ---------------------------------------------------------------------------
// detect_pg_tools
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_pg_tools() -> PgToolStatus {
    PgToolStatus {
        pg_dump_found: Command::new("pg_dump").arg("--version").output().is_ok(),
        pg_restore_found: Command::new("pg_restore").arg("--version").output().is_ok(),
        pg_dump_version: get_version("pg_dump"),
        pg_restore_version: get_version("pg_restore"),
    }
}

// ---------------------------------------------------------------------------
// pg_dump
// ---------------------------------------------------------------------------

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
        let store = state
            .db_store
            .lock()
            .map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    // Get password from keychain
    let password = crate::commands::keychain::get_connection_password_internal(
        &app_handle,
        &connection_id,
    )
    .unwrap_or_default()
    .unwrap_or_default();

    // Extract connection fields before moving into spawn_blocking
    let host = conn.host.clone();
    let port = conn.port.unwrap_or(5432);
    let username = conn.username.unwrap_or_else(|| "postgres".into());
    let database = conn.database.unwrap_or_else(|| "postgres".into());
    let file_path = options.file_path.clone();
    let format = options.format.clone();
    let no_owner = options.no_owner;
    let schema = options.schema.clone();
    let tables = options.tables.clone();

    let job_id_clone = job_id.clone();

    tokio::task::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            format!("--host={host}"),
            format!("--port={port}"),
            format!("--username={username}"),
            format!("--dbname={database}"),
        ];

        match format.as_str() {
            "custom" => args.push("--format=c".into()),
            "tar" => args.push("--format=t".into()),
            "directory" => args.push("--format=d".into()),
            _ => {} // "plain" is the default — no format flag needed
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

        args.push(format!("--file={file_path}"));

        let result = Command::new("pg_dump")
            .env("PGPASSWORD", &password)
            .args(&args)
            .output();

        match result {
            Ok(output) if output.status.success() => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "completed".into(),
                        progress: Some(1.0),
                        output_line: None,
                        error: None,
                    },
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(
                            crate::commands::test_connection::sanitize_error(&stderr),
                        ),
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// pg_restore
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn pg_restore(
    connection_id: String,
    options: RestoreOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    let conn = {
        let store = state
            .db_store
            .lock()
            .map_err(|e| e.to_string())?;
        let connections = store.get_connections().map_err(|e| e.to_string())?;
        connections
            .into_iter()
            .find(|c| c.id == connection_id)
            .ok_or_else(|| format!("Connection not found: {connection_id}"))?
    };

    let password = crate::commands::keychain::get_connection_password_internal(
        &app_handle,
        &connection_id,
    )
    .unwrap_or_default()
    .unwrap_or_default();

    let host = conn.host.clone();
    let port = conn.port.unwrap_or(5432);
    let username = conn.username.unwrap_or_else(|| "postgres".into());
    let database = conn.database.unwrap_or_else(|| "postgres".into());
    let file_path = options.file_path.clone();
    let format = options.format.clone();
    let clean = options.clean;
    let schema = options.schema.clone();

    let job_id_clone = job_id.clone();

    tokio::task::spawn_blocking(move || {
        let mut args: Vec<String> = vec![
            format!("--host={host}"),
            format!("--port={port}"),
            format!("--username={username}"),
            format!("--dbname={database}"),
        ];

        match format.as_str() {
            "custom" => args.push("--format=c".into()),
            "tar" => args.push("--format=t".into()),
            "directory" => args.push("--format=d".into()),
            _ => {}
        }

        if clean {
            args.push("--clean".into());
            args.push("--if-exists".into());
        }

        if let Some(ref schema) = schema {
            args.push(format!("--schema={schema}"));
        }

        args.push(file_path.clone());

        let result = Command::new("pg_restore")
            .env("PGPASSWORD", &password)
            .args(&args)
            .output();

        match result {
            Ok(output) if output.status.success() => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "completed".into(),
                        progress: Some(1.0),
                        output_line: None,
                        error: None,
                    },
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(
                            crate::commands::test_connection::sanitize_error(&stderr),
                        ),
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    });

    Ok(job_id)
}

// ---------------------------------------------------------------------------
// db_sync  (pg_dump | pg_restore via Unix pipe)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn db_sync(
    options: SyncOptions,
    state: State<'_, crate::AppState>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let job_id = uuid::Uuid::new_v4().to_string();

    // Get both connections from store
    let (source_conn, target_conn) = {
        let store = state
            .db_store
            .lock()
            .map_err(|e| e.to_string())?;
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
    let src_password = crate::commands::keychain::get_connection_password_internal(
        &app_handle,
        &source_conn.id,
    )
    .unwrap_or_default()
    .unwrap_or_default();

    let tgt_password = crate::commands::keychain::get_connection_password_internal(
        &app_handle,
        &target_conn.id,
    )
    .unwrap_or_default()
    .unwrap_or_default();

    // Extract connection fields
    let src_host = source_conn.host.clone();
    let src_port = source_conn.port.unwrap_or(5432);
    let src_username = source_conn
        .username
        .clone()
        .unwrap_or_else(|| "postgres".into());
    let src_database = source_conn
        .database
        .clone()
        .unwrap_or_else(|| "postgres".into());

    let tgt_host = target_conn.host.clone();
    let tgt_port = target_conn.port.unwrap_or(5432);
    let tgt_username = target_conn
        .username
        .clone()
        .unwrap_or_else(|| "postgres".into());
    let tgt_database = target_conn
        .database
        .clone()
        .unwrap_or_else(|| "postgres".into());

    let schema = options.schema.clone();
    let tables = options.tables.clone();
    let job_id_clone = job_id.clone();

    tokio::task::spawn_blocking(move || {
        // --- Build pg_dump args ---
        let mut dump_args: Vec<String> = vec![
            format!("--host={src_host}"),
            format!("--port={src_port}"),
            format!("--username={src_username}"),
            format!("--dbname={src_database}"),
            "--format=c".into(), // binary custom format for reliable piping
            "--no-owner".into(),
        ];

        if let Some(ref schema) = schema {
            dump_args.push(format!("--schema={schema}"));
        }

        if let Some(ref tables) = tables {
            for t in tables {
                dump_args.push(format!("--table={t}"));
            }
        }

        // --- Build pg_restore args ---
        let restore_args: Vec<String> = vec![
            format!("--host={tgt_host}"),
            format!("--port={tgt_port}"),
            format!("--username={tgt_username}"),
            format!("--dbname={tgt_database}"),
            "--no-owner".into(),
        ];

        // --- Spawn pg_dump with piped stdout ---
        let mut dump_child = match Command::new("pg_dump")
            .env("PGPASSWORD", &src_password)
            .args(&dump_args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(e) => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(format!("Failed to start pg_dump: {e}")),
                    },
                );
                return;
            }
        };

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
        let restore_result = Command::new("pg_restore")
            .env("PGPASSWORD", &tgt_password)
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
            let _ = app_handle.emit(
                "backup-progress",
                BackupProgressEvent {
                    job_id: job_id_clone.clone(),
                    status: "failed".into(),
                    progress: None,
                    output_line: None,
                    error: Some(format!(
                        "pg_dump failed: {}",
                        crate::commands::test_connection::sanitize_error(&dump_stderr)
                    )),
                },
            );
            return;
        }

        match restore_result {
            Ok(output) if output.status.success() => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "completed".into(),
                        progress: Some(1.0),
                        output_line: None,
                        error: None,
                    },
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(format!(
                            "pg_restore failed: {}",
                            crate::commands::test_connection::sanitize_error(&stderr)
                        )),
                    },
                );
            }
            Err(e) => {
                let _ = app_handle.emit(
                    "backup-progress",
                    BackupProgressEvent {
                        job_id: job_id_clone.clone(),
                        status: "failed".into(),
                        progress: None,
                        output_line: None,
                        error: Some(format!("pg_restore failed: {e}")),
                    },
                );
            }
        }
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