use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub confirm_before_delete: bool,
    pub default_folder_id: Option<String>,
    pub theme: String,
    pub font_size: String,
    pub default_ports: HashMap<String, Option<i64>>,
    pub tag_order: Option<String>,
    pub table_refresh_rate: i64,
    pub table_page_size: i64,
    pub shortcuts: HashMap<String, String>,
    pub accent_color: String,
    // Editor (Plan A)
    pub editor_font_size: i64,
    pub editor_font_family: String,
    pub editor_word_wrap: String,
    pub editor_minimap: bool,
    pub editor_tab_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsExport {
    pub schema_version: u32,
    pub settings: Settings,
}
