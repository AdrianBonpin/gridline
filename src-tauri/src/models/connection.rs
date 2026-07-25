use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub folder_id: Option<String>,
    pub keychain_ref: Option<String>,
    pub tag_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInput {
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub folder_id: Option<String>,
    pub tag_ids: Vec<String>,
}