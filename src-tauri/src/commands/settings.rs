use crate::models::Settings;
use crate::store::Store;
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
