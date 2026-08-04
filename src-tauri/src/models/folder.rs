use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub tag_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderInput {
    pub name: String,
    pub parent_id: Option<String>,
    pub tag_ids: Option<Vec<String>>,
}
