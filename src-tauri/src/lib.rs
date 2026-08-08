// Infrastructure modules: types, introspection, and DB viewer commands are built ahead
// of runtime usage, producing expected dead_code/unused warnings during development.
#![allow(dead_code)]

mod cancel;
mod commands;
mod db;
mod models;
mod store;

use commands::ssh::{Ssh2Backend, SshTunnelManager};
use db::pool::ConnectionPoolManager;
use std::sync::{Arc, Mutex as StdMutex};
use store::Store;
use tauri::Manager;

pub struct AppState {
    pub db_store: StdMutex<Store>,
    pub pool_manager: tokio::sync::Mutex<ConnectionPoolManager>,
    pub ssh_manager: StdMutex<SshTunnelManager>,
    pub cancel_registry: crate::cancel::CancelRegistry,
}

use commands::{
    backup, connections, db_viewer, demo, folders, import_export, keychain, maintenance, objects, query,
    schema_graph, settings, tags,
};

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_keyring_store::init())
        .setup(move |app| {
            // Open the local store under the OS app-data directory. When the
            // app is launched from Finder/LaunchServices the working directory
            // is `/`, so a relative "gridline.db" path panics ("failed to
            // open db", exit 101) before the UI ever starts. The demo DB uses
            // the same directory (see commands/demo.rs).
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("failed to resolve app data dir: {e}"))?;
            std::fs::create_dir_all(&data_dir)
                .map_err(|e| format!("failed to create app data dir: {e}"))?;
            let store =
                Store::open(&data_dir.join("gridline.db").to_string_lossy()).expect("failed to open db");

            app.manage(AppState {
                db_store: StdMutex::new(store),
                pool_manager: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
                ssh_manager: StdMutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend))),
                cancel_registry: crate::cancel::CancelRegistry::default(),
            });

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
                        // Drop the cancel handles for the evicted connection
                        // (tokens/interrupts outlive the pool otherwise).
                        s.cancel_registry.remove(id);
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
            db_viewer::get_table_columns,
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
            objects::create_schema,
            objects::rename_schema,
            objects::drop_schema,
            objects::search_objects,
            objects::get_object_ddl,
            objects::get_object_dependencies,
            objects::build_object_ddl,
            objects::build_rebuild_script,
            objects::get_available_extensions,
            objects::get_roles, objects::get_role_privileges, objects::get_table_rebuild_readiness, objects::get_tablespaces,
            maintenance::run_maintenance,
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
            demo::regenerate_demo_db,
            backup::detect_pg_tools,
            backup::pg_dump,
            backup::pg_restore,
            backup::db_sync,
            backup::detect_mysql_tools,
            backup::mysql_dump,
            backup::mysql_restore,
            backup::mysql_sync,
            backup::sqlite_dump,
            backup::sqlite_restore,
            backup::sqlite_sync,
            settings::export_settings,
            settings::import_settings,
            schema_graph::get_schema_graph,
            query::execute_query,
            query::cancel_query,
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
