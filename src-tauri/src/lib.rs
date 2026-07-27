mod db;
mod models;
mod store;
mod commands;

use std::sync::Mutex;
use store::Store;
use commands::ssh::SshTunnelManager;
use db::pool::ConnectionPoolManager;

pub struct AppState {
    pub db_store: Mutex<Store>,
    pub pool_manager: Mutex<ConnectionPoolManager>,
    pub ssh_manager: Mutex<SshTunnelManager>,
}

use commands::{connections, folders, tags, settings, import_export};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = Store::open("gridline.db").expect("failed to open db");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            db_store: Mutex::new(store),
            pool_manager: Mutex::new(ConnectionPoolManager::new()),
            ssh_manager: Mutex::new(SshTunnelManager::new()),
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
            commands::test_connection::test_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
