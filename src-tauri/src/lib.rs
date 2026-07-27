// Infrastructure modules: types, introspection, and DB viewer commands are built ahead
// of runtime usage, producing expected dead_code/unused warnings during development.
#![allow(dead_code)]

mod db;
mod models;
mod store;
mod commands;

use std::sync::Mutex as StdMutex;
use tauri::Manager;
use store::Store;
use commands::ssh::SshTunnelManager;
use db::pool::ConnectionPoolManager;

pub struct AppState {
    pub db_store: StdMutex<Store>,
    pub pool_manager: tokio::sync::Mutex<ConnectionPoolManager>,
    pub ssh_manager: StdMutex<SshTunnelManager>,
}

use commands::{connections, db_viewer, folders, tags, settings, import_export, keychain, demo};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Store::open("gridline.db").expect("failed to open db");
    let store_ref = StdMutex::new(store);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_keyring_store::init())
        .manage(AppState {
            db_store: store_ref,
            pool_manager: tokio::sync::Mutex::new(ConnectionPoolManager::new()),
            ssh_manager: StdMutex::new(SshTunnelManager::new()),
        })
        .setup(move |app| {
            let state = app.state::<AppState>();
            demo::ensure_demo_db(app.handle(), &state.db_store)
                .map_err(|e| {
                    eprintln!("Failed to set up demo DB: {e}");
                })
                .ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            connections::get_connections,
            connections::create_connection,
            connections::delete_connection,
            connections::add_connection_tags,
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
            db_viewer::execute_change,
            db_viewer::refresh_connection,
            keychain::save_connection_password,
            keychain::get_connection_password,
            keychain::delete_connection_password,
            demo::recreate_demo_db,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
