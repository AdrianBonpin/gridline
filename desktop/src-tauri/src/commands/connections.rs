use crate::models::{Connection, ConnectionInput};
use crate::store::Store;
use std::sync::Mutex;

const VALID_DB_TYPES: [&str; 5] = ["postgresql", "mysql", "mariadb", "sqlite", "redis"];

fn validate(input: &ConnectionInput) -> Result<(), String> {
    if input.name.is_empty() || input.name.chars().count() > 100 {
        return Err("name is required and must be 100 chars or fewer".into());
    }
    if !VALID_DB_TYPES.contains(&input.db_type.as_str()) {
        return Err(format!(
            "db_type must be one of: {}",
            VALID_DB_TYPES.join(", ")
        ));
    }
    if input.host.is_empty() || input.host.chars().count() > 255 {
        return Err("host is required and must be 255 chars or fewer".into());
    }
    if input.db_type != "sqlite" {
        match input.port {
            Some(p) if (1..=65535).contains(&p) => {}
            _ => return Err("port must be an integer between 1 and 65535 for this db_type".into()),
        }
    }
    if let Some(u) = &input.username {
        if u.chars().count() > 100 {
            return Err("username must be 100 chars or fewer".into());
        }
    }
    Ok(())
}

pub fn get_connections_inner(state: &Mutex<Store>) -> Result<Vec<Connection>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_connections()
}

pub fn create_connection_inner(
    state: &Mutex<Store>,
    input: ConnectionInput,
) -> Result<Connection, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.create_connection(input)
}

pub fn update_connection_inner(
    state: &Mutex<Store>,
    id: String,
    input: ConnectionInput,
) -> Result<Connection, String> {
    validate(&input)?;
    let store = state.lock().map_err(|e| e.to_string())?;
    store.update_connection(&id, input)
}

pub fn delete_connection_inner(state: &Mutex<Store>, id: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.delete_connection(id)
}

pub fn add_connection_tags_inner(
    state: &Mutex<Store>,
    connection_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.add_connection_tags(&connection_id, &tag_ids)
}

#[tauri::command]
pub fn get_connections(state: tauri::State<crate::AppState>) -> Result<Vec<Connection>, String> {
    get_connections_inner(&state.db_store)
}

#[tauri::command]
pub fn create_connection(
    state: tauri::State<crate::AppState>,
    input: ConnectionInput,
) -> Result<Connection, String> {
    create_connection_inner(&state.db_store, input)
}

#[tauri::command]
pub fn update_connection(
    state: tauri::State<crate::AppState>,
    id: String,
    input: ConnectionInput,
) -> Result<Connection, String> {
    update_connection_inner(&state.db_store, id, input)
}

#[tauri::command]
pub async fn delete_connection(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    delete_connection_with_resources(&state, &id).await?;
    // Purge every keychain secret the connection owned (missing entries are
    // no-ops): a deleted connection must not leave its database password, SSH
    // password, or key passphrase behind.
    crate::commands::keychain::purge_connection_secrets(&id, |account| {
        crate::commands::keychain::delete_account_internal(&app, account)
    });
    Ok(())
}

/// Forget a connection in the local store and close everything its live
/// session owns.
///
/// Deleting a connection is a teardown: the pool handle, the SSH tunnel (and
/// its loopback listener) and the cancellation handles go through the same
/// single path as `db_disconnect`, so a deleted connection cannot keep a live
/// session — or a reachable proxy — behind it. Secrets are purged by the
/// command, which owns the keyring handle.
pub(crate) async fn delete_connection_with_resources(
    state: &crate::AppState,
    id: &str,
) -> Result<(), String> {
    delete_connection_inner(&state.db_store, id)?;
    crate::db::lifecycle::teardown_connection(
        id,
        &state.pool_manager,
        &state.ssh_manager,
        &state.cancel_registry,
    )
    .await;
    Ok(())
}

#[tauri::command]
pub fn add_connection_tags(
    state: tauri::State<crate::AppState>,
    connection_id: String,
    tag_ids: Vec<String>,
) -> Result<(), String> {
    add_connection_tags_inner(&state.db_store, connection_id, tag_ids)
}

pub fn set_connection_favorite_inner(
    state: &Mutex<Store>,
    connection_id: String,
    favorite: bool,
) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.set_connection_favorite(&connection_id, favorite)
}

pub fn record_recent_connection_inner(
    state: &Mutex<Store>,
    connection_id: String,
) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.record_recent_connection(&connection_id)
}

pub fn get_recent_connections_inner(
    state: &Mutex<Store>,
    limit: i64,
) -> Result<Vec<crate::models::RecentConnection>, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_recent_connections(limit)
}

pub fn clear_recent_connections_inner(state: &Mutex<Store>) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.clear_recent_connections()
}

#[tauri::command]
pub fn set_connection_favorite(
    state: tauri::State<crate::AppState>,
    connection_id: String,
    favorite: bool,
) -> Result<(), String> {
    set_connection_favorite_inner(&state.db_store, connection_id, favorite)
}

#[tauri::command]
pub fn record_recent_connection(
    state: tauri::State<crate::AppState>,
    connection_id: String,
) -> Result<(), String> {
    record_recent_connection_inner(&state.db_store, connection_id)
}

#[tauri::command]
pub fn get_recent_connections(
    state: tauri::State<crate::AppState>,
    limit: i64,
) -> Result<Vec<crate::models::RecentConnection>, String> {
    get_recent_connections_inner(&state.db_store, limit)
}

#[tauri::command]
pub fn clear_recent_connections(state: tauri::State<crate::AppState>) -> Result<(), String> {
    clear_recent_connections_inner(&state.db_store)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ConnectionInput;
    use crate::store::Store;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn get_connections_returns_list() {
        let st = state();
        let result = get_connections_inner(&st);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 0);
    }

    #[test]
    fn create_connection_command_returns_connection() {
        let st = state();
        let input = ConnectionInput {
            name: "Prod".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            password: None,
            database: None,
            environment: None,
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
            tag_ids: vec![],
            use_keychain: true,
        };
        let result = create_connection_inner(&st, input.clone()).unwrap();
        assert_eq!(result.name, "Prod");
        assert_eq!(get_connections_inner(&st).unwrap().len(), 1);
    }

    #[test]
    fn create_connection_rejects_invalid_db_type() {
        let st = state();
        let input = ConnectionInput {
            name: "X".into(),
            db_type: "mongodb".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            password: None,
            database: None,
            environment: None,
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
            tag_ids: vec![],
            use_keychain: true,
        };
        assert!(create_connection_inner(&st, input).is_err());
    }

    #[test]
    fn delete_connection_command_removes_it() {
        let st = state();
        let input = ConnectionInput {
            name: "X".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            password: None,
            database: None,
            environment: None,
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
            tag_ids: vec![],
            use_keychain: true,
        };
        let conn = create_connection_inner(&st, input).unwrap();
        delete_connection_inner(&st, &conn.id).unwrap();
        assert_eq!(get_connections_inner(&st).unwrap().len(), 0);
    }

    #[test]
    fn set_connection_favorite_command_persists() {
        let st = state();
        let input = ConnectionInput {
            name: "P".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            tag_ids: vec![],
            use_keychain: true,
            password: None,
            database: None,
            environment: None,
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
        };
        let conn = create_connection_inner(&st, input).unwrap();
        set_connection_favorite_inner(&st, conn.id.clone(), true).unwrap();
        assert_eq!(get_connections_inner(&st).unwrap()[0].favorite, true);
    }

    #[test]
    fn record_recent_command_upserts() {
        let st = state();
        let input = ConnectionInput {
            name: "P".into(),
            db_type: "postgresql".into(),
            host: "h".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            tag_ids: vec![],
            use_keychain: true,
            password: None,
            database: None,
            environment: None,
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
        };
        let conn = create_connection_inner(&st, input).unwrap();
        record_recent_connection_inner(&st, conn.id.clone()).unwrap();
        record_recent_connection_inner(&st, conn.id.clone()).unwrap(); // idempotent upsert
        let recent = get_recent_connections_inner(&st, 10).unwrap();
        assert_eq!(recent.len(), 1);
        clear_recent_connections_inner(&st).unwrap();
        assert_eq!(get_recent_connections_inner(&st, 10).unwrap().len(), 0);
    }
}

#[cfg(test)]
#[path = "connections.test.rs"]
mod connections_tests;

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use std::sync::Arc;

    fn input(name: &str) -> ConnectionInput {
        ConnectionInput {
            name: name.into(),
            db_type: "postgresql".into(),
            host: "db.internal".into(),
            port: Some(5432),
            username: None,
            folder_id: None,
            password: None,
            database: None,
            environment: None,
            ssh_host: Some("jump.internal".into()),
            ssh_port: Some(22),
            ssh_user: Some("tunnel".into()),
            ssh_auth_method: Some("password".into()),
            ssh_private_key_path: None,
            ssh_password: None,
            ssh_passphrase: None,
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            tag_ids: vec![],
            use_keychain: true,
        }
    }

    fn app_state(store: Arc<Mutex<Store>>) -> crate::AppState {
        crate::AppState {
            db_store: store,
            pool_manager: tokio::sync::Mutex::new(crate::db::pool::ConnectionPoolManager::new()),
            ssh_manager: std::sync::Mutex::new(crate::commands::ssh::SshTunnelManager::new(
                Arc::new(crate::commands::ssh::fake::NoSshBackend),
            )),
            cancel_registry: crate::cancel::CancelRegistry::new(),
            jobs: Arc::new(crate::job::JobRegistry::new()),
            file_grants: Arc::new(crate::file_grant::FileGrantStore::new()),
        }
    }

    /// Criterion: deleting a connection closes its resources.
    ///
    /// The connection is deleted while it has a live pool handle, a tunnel and
    /// a cancellation handle; nothing may outlive it.
    #[tokio::test]
    async fn delete_connection_closes_pool_tunnel_and_cancel_handles() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Arc::new(Mutex::new(Store::from_connection(conn)));
        let created = create_connection_inner(&store, input("Client A")).unwrap();

        let state = app_state(store);
        let session = rusqlite::Connection::open_in_memory().unwrap();
        let interrupt = session.get_interrupt_handle();
        state
            .pool_manager
            .lock()
            .await
            .register(&created.id, crate::db::pool::DbHandle::Sqlite(session));
        state
            .cancel_registry
            .set_sqlite(&created.id, crate::cancel::SqliteCancel::new(interrupt));
        state.cancel_registry.mark_cancelled(&created.id);
        let tunnel_closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = tunnel_closed.clone();
        state.ssh_manager.lock().unwrap().insert_tunnel(
            created.id.clone(),
            crate::commands::ssh::Tunnel::with_closer(
                1,
                Box::new(move || flag.store(true, std::sync::atomic::Ordering::SeqCst)),
            ),
        );

        delete_connection_with_resources(&state, &created.id)
            .await
            .unwrap();

        assert_eq!(
            get_connections_inner(&state.db_store).unwrap().len(),
            0,
            "the connection is gone from the local store"
        );
        assert!(
            state.pool_manager.lock().await.get(&created.id).is_none(),
            "the deleted connection's pool handle is closed"
        );
        assert!(
            state.ssh_manager.lock().unwrap().active_count() == 0,
            "the deleted connection's tunnel is closed"
        );
        assert!(
            tunnel_closed.load(std::sync::atomic::Ordering::SeqCst),
            "the tunnel closer ran, so no loopback listener survives the delete"
        );
        assert!(
            state.cancel_registry.get(&created.id).is_none(),
            "the deleted connection's cancellation handle is closed"
        );
        assert!(
            !state.cancel_registry.is_cancelled(&created.id),
            "no stale cancel-requested flag survives the delete"
        );
    }

    /// Deleting a connection that was never opened still succeeds and removes
    /// its row (the keychain purge runs in the command either way).
    #[tokio::test]
    async fn delete_connection_without_a_live_session_still_succeeds() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Arc::new(Mutex::new(Store::from_connection(conn)));
        let created = create_connection_inner(&store, input("Client B")).unwrap();
        let state = app_state(store);

        delete_connection_with_resources(&state, &created.id)
            .await
            .unwrap();

        assert_eq!(get_connections_inner(&state.db_store).unwrap().len(), 0);
    }
}
