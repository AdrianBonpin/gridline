use crate::models::Settings;
use crate::store::Store;
use std::collections::HashMap;
use std::sync::Mutex;

pub fn get_settings_inner(state: &Mutex<Store>) -> Result<Settings, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.get_settings()
}

pub fn update_setting_inner(state: &Mutex<Store>, key: &str, value: &str) -> Result<(), String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    store.update_setting(key, value)
}

#[tauri::command]
pub fn get_settings(state: tauri::State<crate::AppState>) -> Result<Settings, String> {
    get_settings_inner(&state.db_store)
}

#[tauri::command]
pub fn update_setting(
    state: tauri::State<crate::AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    update_setting_inner(&state.db_store, &key, &value)
}

// ---------------------------------------------------------------------------
// Settings export / import (v0.7.8)
// ---------------------------------------------------------------------------

/// Flatten a `Settings` struct into the store's key/value map. Keys and value
/// formats must round-trip through `Store::get_settings` (e.g. a `None`
/// `default_folder_id` is stored as the literal `"null"` sentinel, which
/// `get_settings` filters back to `None`).
fn settings_to_kv(s: &crate::models::Settings) -> HashMap<String, String> {
    let mut m = HashMap::new();
    m.insert("confirm_before_delete".into(), s.confirm_before_delete.to_string());
    if let Some(f) = &s.default_folder_id {
        m.insert("default_folder_id".into(), f.clone());
    } else {
        m.insert("default_folder_id".into(), "null".into());
    }
    m.insert("theme".into(), s.theme.clone());
    m.insert("font_size".into(), s.font_size.clone());
    m.insert("accent_color".into(), s.accent_color.clone());
    m.insert("table_refresh_rate".into(), s.table_refresh_rate.to_string());
    m.insert("table_page_size".into(), s.table_page_size.to_string());
    m.insert("editor_font_size".into(), s.editor_font_size.to_string());
    m.insert("editor_font_family".into(), s.editor_font_family.clone());
    m.insert("editor_word_wrap".into(), s.editor_word_wrap.clone());
    m.insert("editor_minimap".into(), s.editor_minimap.to_string());
    m.insert("editor_tab_size".into(), s.editor_tab_size.to_string());
    if let Some(o) = &s.tag_order {
        m.insert("tag_order".into(), o.clone());
    }
    m.insert(
        "default_ports".into(),
        serde_json::to_string(&s.default_ports).unwrap_or_default(),
    );
    m.insert(
        "shortcuts".into(),
        serde_json::to_string(&s.shortcuts).unwrap_or_default(),
    );
    m
}

#[tauri::command]
pub fn export_settings(state: tauri::State<crate::AppState>) -> Result<String, String> {
    let s = get_settings_inner(&state.db_store)?;
    serde_json::to_string(&crate::models::settings::SettingsExport {
        schema_version: 1,
        settings: s,
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_settings(
    json: String,
    state: tauri::State<crate::AppState>,
) -> Result<(), String> {
    let env: crate::models::settings::SettingsExport =
        serde_json::from_str(&json).map_err(|e| format!("invalid settings file: {e}"))?;
    let map = settings_to_kv(&env.settings);
    let store = state.db_store.lock().map_err(|e| e.to_string())?;
    store.apply_settings(&map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn get_settings_returns_defaults() {
        let st = state();
        let s = get_settings_inner(&st).unwrap();
        assert_eq!(s.theme, "system");
        assert_eq!(s.font_size, "medium");
        assert_eq!(s.accent_color, "#2563EB");
    }

    #[test]
    fn update_setting_persists() {
        let st = state();
        update_setting_inner(&st, "theme", "light").unwrap();
        assert_eq!(get_settings_inner(&st).unwrap().theme, "light");
    }

    #[test]
    fn update_accent_color_persists() {
        let st = state();
        update_setting_inner(&st, "accent_color", "#EF4444").unwrap();
        assert_eq!(get_settings_inner(&st).unwrap().accent_color, "#EF4444");
    }

    #[test]
    fn settings_export_envelope_camel_case() {
        use std::collections::HashMap;
        let env = crate::models::settings::SettingsExport { schema_version: 1, settings: crate::models::Settings {
            confirm_before_delete: true, default_folder_id: None, theme: "dark".into(), font_size: "medium".into(),
            default_ports: HashMap::new(), tag_order: None, table_refresh_rate: 5, table_page_size: 50,
            shortcuts: HashMap::new(), accent_color: "#2563EB".into(), editor_font_size: 14,
            editor_font_family: "Menlo".into(), editor_word_wrap: "off".into(), editor_minimap: true, editor_tab_size: 2,
        }};
        let json = serde_json::to_string(&env).unwrap();
        assert!(json.contains("\"schemaVersion\":1"));
        assert!(json.contains("\"settings\":"));
    }

    #[test]
    fn store_apply_settings_writes_all_keys() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = crate::store::Store::from_connection(conn);
        let mut map = std::collections::HashMap::new();
        map.insert("theme".to_string(), "light".to_string());
        map.insert("accent_color".to_string(), "#EF4444".to_string());
        store.apply_settings(&map).unwrap();
        assert_eq!(store.get_settings().unwrap().theme, "light");
        assert_eq!(store.get_settings().unwrap().accent_color, "#EF4444");
    }
}
