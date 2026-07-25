mod models;
mod store;
mod commands;

use std::sync::Mutex;
use store::Store;

pub struct DbState(pub Mutex<Store>);

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
        .manage(DbState(Mutex::new(store)))
        .invoke_handler(tauri::generate_handler![
            greet,
            connections::get_connections,
            connections::create_connection,
            connections::delete_connection,
            folders::get_folders,
            folders::create_folder,
            folders::delete_folder,
            tags::get_tags,
            tags::create_tag,
            tags::delete_tag,
            settings::get_settings,
            settings::update_setting,
            import_export::import_connections,
            import_export::export_connections
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
