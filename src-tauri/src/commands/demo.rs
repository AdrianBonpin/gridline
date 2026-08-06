use crate::models::ConnectionInput;
use crate::store::Store;
use crate::AppState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

const DEMO_DB_FILENAME: &str = "demo.db";
const DEMO_CONNECTION_NAME: &str = "Gridline Demo (SQLite)";
/// Bump whenever the demo schema or seed data changes so existing demo files
/// are recreated on the next launch. The demo is disposable by design — it
/// should always showcase the current feature set.
const DEMO_SCHEMA_VERSION: i64 = 3;

/// True when the demo file's `PRAGMA user_version` is at or above the current
/// schema version (i.e. the file already carries the full feature set).
fn demo_file_is_current(conn: &Connection) -> Result<bool, String> {
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(version >= DEMO_SCHEMA_VERSION)
}

/// Ensure the demo SQLite file at `path` exists and is seeded with the current
/// schema. Files that predate `DEMO_SCHEMA_VERSION` are recreated so the demo
/// always showcases every feature.
fn ensure_demo_file(path: &Path) -> Result<(), String> {
    let stale = path.exists() && {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        !demo_file_is_current(&conn).unwrap_or(false)
    };
    if stale {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    if !path.exists() {
        let conn = Connection::open(path).map_err(|e| format!("Failed to create demo DB: {e}"))?;
        conn.execute_batch(&get_demo_schema())
            .map_err(|e| format!("Failed to seed demo DB: {e}"))?;
    }
    Ok(())
}

/// Build the connection input for the demo SQLite file at `db_path`.
fn demo_connection_input(db_path: &Path) -> ConnectionInput {
    ConnectionInput {
        name: DEMO_CONNECTION_NAME.to_string(),
        db_type: "sqlite".to_string(),
        host: db_path.to_string_lossy().to_string(),
        port: None,
        username: None,
        password: None,
        database: None,
        folder_id: None,
        tag_ids: vec![],
        use_keychain: true,
        environment: Some("development".to_string()),
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_method: None,
        ssh_private_key_path: None,
        ssh_password: None,
        ssh_passphrase: None,
        ssl_mode: None,
        ssl_ca_path: None,
        ssl_cert_path: None,
        ssl_key_path: None,
    }
}

/// Resolve the demo database file under the app data directory (the same
/// location the startup `ensure_demo_db` flow seeds), creating the directory
/// when needed.
fn demo_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join(DEMO_DB_FILENAME))
}

/// Register the demo connection unless one already exists.
fn ensure_demo_connection(store: &Mutex<Store>, db_path: &Path) -> Result<(), String> {
    let exists = {
        let s = store.lock().map_err(|e| e.to_string())?;
        s.get_connections()?
            .iter()
            .any(|c| c.name == DEMO_CONNECTION_NAME)
    };
    if exists {
        return Ok(());
    }
    let input = demo_connection_input(db_path);
    let s = store.lock().map_err(|e| e.to_string())?;
    s.create_connection(input)?;
    Ok(())
}

/// Drop any live pool handle for the demo connection so its SQLite file can
/// be deleted and recreated cleanly.
async fn disconnect_demo_pool(state: &tauri::State<'_, AppState>) -> Result<(), String> {
    let demo_id = {
        let s = state.db_store.lock().map_err(|e| e.to_string())?;
        s.get_connections()?
            .iter()
            .find(|c| c.name == DEMO_CONNECTION_NAME)
            .map(|c| c.id.clone())
    };
    if let Some(id) = demo_id {
        let mut pm = state.pool_manager.lock().await;
        pm.remove(&id);
    }
    Ok(())
}

/// Ensure the demo SQLite database exists and a corresponding connection is
/// registered. Safe to call on every app start — it's idempotent, and it
/// upgrades stale demo files to the current schema automatically.
pub fn ensure_demo_db(app_handle: &tauri::AppHandle, store: &Mutex<Store>) -> Result<(), String> {
    let db_path = demo_db_path(app_handle)?;
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(store, &db_path)
}

/// Tauri command to re-add the demo connection from the settings screen.
/// Recreates the demo file when it is missing or stale, then registers the
/// connection (always under the app data directory, matching startup).
#[tauri::command]
pub fn recreate_demo_db(
    app: tauri::AppHandle,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let db_path = demo_db_path(&app)?;
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(&state.db_store, &db_path)?;
    Ok("Demo database connection re-created.".to_string())
}

/// Tauri command to regenerate the demo database from the settings screen:
/// drops any live pool handle, wipes the current file (including any edits
/// made against it) and re-seeds it with fresh demo data.
#[tauri::command]
pub async fn regenerate_demo_db(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let db_path = demo_db_path(&app)?;
    disconnect_demo_pool(&state).await?;
    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| e.to_string())?;
    }
    ensure_demo_file(&db_path)?;
    ensure_demo_connection(&state.db_store, &db_path)?;
    Ok("Demo database regenerated with fresh data.".to_string())
}

/// The demo schema + seed data. Loaded from `demo_schema.sql` so the SQL can
/// be edited and reviewed with normal editor tooling.
fn get_demo_schema() -> String {
    include_str!("demo_schema.sql").to_string()
}

#[cfg(test)]
#[path = "demo.test.rs"]
mod tests;
