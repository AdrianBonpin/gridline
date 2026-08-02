use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentConnection {
    pub connection_id: String,
    pub opened_at: String,
}