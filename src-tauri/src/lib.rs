// Infrastructure modules: types, introspection, and DB viewer commands are built ahead
// of runtime usage, producing expected dead_code/unused warnings during development.
#![allow(dead_code)]

mod db;
mod models;
mod store;
mod commands;

use std::sync::{Arc, Mutex as StdMutex};
use tauri::Manager;
use store::Store;
use commands::ssh::{Ssh2Backend, SshTunnelManager};
use db::pool::ConnectionPoolManager;

pub struct AppState {
    pub db_store: StdMutex<Store>,
    pub pool_manager: tokio::sync::Mutex<ConnectionPoolManager>,
    pub ssh_manager: StdMutex<SshTunnelManager>,
}

use commands::{connections, db_viewer, folders, tags, settings, import_export, keychain, demo, backup, schema_graph, query};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Install the ring crypto provider so rustls `ClientConfig::builder()` works (no-op if
    // another provider is already installed).
    let _ = rustls::crypto::ring::default_provider().install_default();

    let store = Store::open("gridline.db").expect("failed to open db");
    let store_ref = StdMutex::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keyring_store::init())
        .manage(AppState {
            db_store: store_ref,
            pool_manager: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
            ssh_manager: StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend))),
        })
        .setup(move |app| {
            let state = app.state::<AppState>();
            demo::ensure_demo_db(app.handle(), &state.db_store)
                .map_err(|e| {
                    eprintln!("Failed to set up demo DB: {e}");
                })
                .ok();

            // Close the SSH tunnel for a connection when its pool is evicted
            // (LRU overflow or max-pool shrink). The hook captures a clone of
            // the app handle and resolves AppState through the manager.
            let handle = app.handle().clone();
            state
                .pool_manager
                .blocking_lock()
                .set_on_evict(Box::new(move |id: &str| {
                    if let Some(s) = handle.try_state::<AppState>() {
                        if let Ok(mut mgr) = s.ssh_manager.lock() {
                            mgr.close_tunnel(id);
                        }
                    }
                }));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connections::get_connections,
            connections::create_connection,
            connections::update_connection,
            connections::delete_connection,
            connections::add_connection_tags,
            connections::set_connection_favorite,
            connections::record_recent_connection,
            connections::get_recent_connections,
            connections::clear_recent_connections,
            folders::get_folders,
            folders::create_folder,
            folders::delete_folder,
            folders::update_folder,
            folders::add_folder_tags,
            tags::get_tags,
            tags::create_tag,
            tags::delete_tag,
            tags::update_tag,
            settings::get_settings,
            settings::update_setting,
            import_export::import_connections,
            import_export::export_connections,
            commands::test_connection::test_connection,
            db_viewer::db_connect,
            db_viewer::db_disconnect,
            db_viewer::get_databases,
            db_viewer::get_schemas,
            db_viewer::get_tables,
            db_viewer::get_table_data,
            db_viewer::get_fk_preview,
            db_viewer::execute_change,
            db_viewer::get_table_ddl,
            db_viewer::refresh_connection,
            db_viewer::get_functions,
            db_viewer::get_triggers,
            db_viewer::get_sequences,
            db_viewer::get_enums,
            db_viewer::get_extensions,
            db_viewer::get_indexes,
            db_viewer::get_constraints,
            keychain::save_connection_password,
            keychain::get_connection_password,
            keychain::delete_connection_password,
            keychain::save_connection_ssh_password,
            keychain::get_connection_ssh_password,
            keychain::delete_connection_ssh_password,
            keychain::save_connection_ssh_passphrase,
            keychain::get_connection_ssh_passphrase,
            keychain::delete_connection_ssh_passphrase,
            demo::recreate_demo_db,
            backup::detect_pg_tools,
            backup::pg_dump,
            backup::pg_restore,
            backup::db_sync,
            schema_graph::get_schema_graph,
            query::execute_query,
            query::get_query_history,
            query::clear_query_history,
            query::set_history_favorite,
            query::save_query,
            query::get_saved_queries,
            query::update_saved_query,
            query::delete_saved_query,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // Close all SSH tunnels on exit: ExitRequested fires before the
            // event loop ends, Exit fires after it has.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Ok(mut mgr) = app_handle.state::<AppState>().ssh_manager.lock() {
                    mgr.close_all();
                }
            }
        });
}
