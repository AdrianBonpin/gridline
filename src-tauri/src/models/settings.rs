use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub confirm_before_delete: bool,
    pub default_folder_id: Option<String>,
    pub theme: String,
    pub font_size: String,
    pub default_ports: HashMap<String, Option<i64>>,
}