pub mod migrations;

use rusqlite::params;
use rusqlite::Connection as SqliteConnection;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::models::{Connection, ConnectionInput, Folder, FolderInput, Settings, Tag, TagInput};

pub struct Store {
    conn: Mutex<SqliteConnection>,
}

impl Store {
    pub fn from_connection(conn: SqliteConnection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }

    pub fn open(path: &str) -> Result<Self, String> {
        let conn = SqliteConnection::open(path).map_err(|e| e.to_string())?;
        migrations::run_migrations(&conn).map_err(|e| e.to_string())?;
        Ok(Self::from_connection(conn))
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    pub fn get_folders(&self) -> Result<Vec<Folder>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    tag_ids: vec![],
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut folders: Vec<Folder> = rows.filter_map(|r| r.ok()).collect();
        // Load tags for each folder
        for f in folders.iter_mut() {
            let mut tag_stmt = conn
                .prepare("SELECT tag_id FROM folder_tags WHERE folder_id = ?1")
                .map_err(|e| e.to_string())?;
            let tag_rows = tag_stmt
                .query_map(params![f.id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            f.tag_ids = tag_rows.filter_map(|r| r.ok()).collect();
        }
        Ok(folders)
    }

    pub fn create_folder(&self, input: FolderInput) -> Result<Folder, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now();
        conn.execute(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, input.name, input.parent_id, now, now],
        )
        .map_err(|e| e.to_string())?;
        let tag_ids = input.tag_ids.unwrap_or_default();
        for tag_id in &tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Folder {
            id,
            name: input.name,
            parent_id: input.parent_id,
            tag_ids,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_folder(&self, id: &str, input: FolderInput) -> Result<Folder, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();
        conn.execute(
            "UPDATE folders SET name = ?1, parent_id = ?2, updated_at = ?3 WHERE id = ?4",
            params![input.name, input.parent_id, now, id],
        )
        .map_err(|e| e.to_string())?;
        // Replace all tags: clear existing, insert new
        conn.execute("DELETE FROM folder_tags WHERE folder_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        let tag_ids = input.tag_ids.unwrap_or_default();
        for tag_id in &tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Folder {
            id: id.to_string(),
            name: input.name,
            parent_id: input.parent_id,
            tag_ids,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn delete_folder(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        // Get the folder's parent_id to reparent children
        let parent_id: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        // Move child folders to the parent
        conn.execute(
            "UPDATE folders SET parent_id = ?1 WHERE parent_id = ?2",
            params![parent_id, id],
        )
        .map_err(|e| e.to_string())?;
        // Move child connections to the parent
        conn.execute(
            "UPDATE connections SET folder_id = ?1 WHERE folder_id = ?2",
            params![parent_id, id],
        )
        .map_err(|e| e.to_string())?;
        // Delete the folder
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_folder_tags(&self, folder_id: &str, tag_ids: &[String]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        for tag_id in tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO folder_tags (folder_id, tag_id) VALUES (?1, ?2)",
                params![folder_id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn add_connection_tags(&self, conn_id: &str, tag_ids: &[String]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        for tag_id in tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?1, ?2)",
                params![conn_id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn get_tags(&self) -> Result<Vec<Tag>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, name, color, created_at FROM tags ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn create_tag(&self, input: TagInput) -> Result<Tag, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now();
        conn.execute(
            "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, input.name, input.color, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(Tag {
            id,
            name: input.name,
            color: input.color,
            created_at: now,
        })
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM tags WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_tag(&self, id: &str, input: TagInput) -> Result<Tag, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();
        conn.execute(
            "UPDATE tags SET name = ?1, color = ?2 WHERE id = ?3",
            params![input.name, input.color, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(Tag {
            id: id.to_string(),
            name: input.name,
            color: input.color,
            created_at: now,
        })
    }

    pub fn get_connections(&self) -> Result<Vec<Connection>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, db_type, host, port, username, folder_id, keychain_ref, created_at, updated_at FROM connections ORDER BY name",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(Connection {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    db_type: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    username: row.get(5)?,
                    folder_id: row.get(6)?,
                    keychain_ref: row.get(7)?,
                    tag_ids: vec![],
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut conns: Vec<Connection> = rows.filter_map(|r| r.ok()).collect();
        // Load tags for each connection
        for c in conns.iter_mut() {
            let mut tag_stmt = conn
                .prepare("SELECT tag_id FROM connection_tags WHERE connection_id = ?1")
                .map_err(|e| e.to_string())?;
            let tag_rows = tag_stmt
                .query_map(params![c.id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            c.tag_ids = tag_rows.filter_map(|r| r.ok()).collect();
        }
        Ok(conns)
    }

    pub fn create_connection(&self, input: ConnectionInput) -> Result<Connection, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now();
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, username, folder_id, keychain_ref, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)",
            params![id, input.name, input.db_type, input.host, input.port, input.username, input.folder_id, now, now],
        )
        .map_err(|e| e.to_string())?;
        for tag_id in &input.tag_ids {
            conn.execute(
                "INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?1, ?2)",
                params![id, tag_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(Connection {
            id,
            name: input.name,
            db_type: input.db_type,
            host: input.host,
            port: input.port,
            username: input.username,
            folder_id: input.folder_id,
            keychain_ref: None,
            tag_ids: input.tag_ids,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_settings(&self) -> Result<Settings, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut map: HashMap<String, String> = HashMap::new();
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.filter_map(|r| r.ok()) {
            map.insert(r.0, r.1);
        }
        let theme = map
            .get("theme")
            .cloned()
            .unwrap_or_else(|| "dark".to_string());
        let font_size = map
            .get("font_size")
            .cloned()
            .unwrap_or_else(|| "medium".to_string());
        let confirm = map
            .get("confirm_before_delete")
            .map(|v| v == "true")
            .unwrap_or(true);
        let default_folder_id = map
            .get("default_folder_id")
            .filter(|v| v.as_str() != "null")
            .cloned();
        let mut default_ports = HashMap::new();
        default_ports.insert("postgresql".to_string(), Some(5432i64));
        default_ports.insert("mysql".to_string(), Some(3306i64));
        default_ports.insert("redis".to_string(), Some(6379i64));
        default_ports.insert("sqlite".to_string(), None);
        if let Some(ports_json) = map.get("default_ports") {
            if let Ok(parsed) =
                serde_json::from_str::<HashMap<String, Option<i64>>>(ports_json)
            {
                default_ports = parsed;
            }
        }
        Ok(Settings {
            confirm_before_delete: confirm,
            default_folder_id,
            theme,
            font_size,
            default_ports,
            tag_order: map.get("tag_order").cloned(),
        })
    }

    pub fn update_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionInput, FolderInput, TagInput};

    fn fresh_store() -> Store {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        Store::from_connection(conn)
    }

    #[test]
    fn create_and_get_folder() {
        let store = fresh_store();
        let folder = store
            .create_folder(FolderInput { tag_ids: None,
                name: "Work".into(),
                parent_id: None,
            })
            .unwrap();
        let got = store.get_folders().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Work");
        assert_eq!(got[0].id, folder.id);
        assert!(got[0].parent_id.is_none());
    }

    #[test]
    fn create_nested_folders() {
        let store = fresh_store();
        let parent = store
            .create_folder(FolderInput { tag_ids: None,
                name: "root".into(),
                parent_id: None,
            })
            .unwrap();
        let child = store
            .create_folder(FolderInput { tag_ids: None,
                name: "child".into(),
                parent_id: Some(parent.id.clone()),
            })
            .unwrap();
        assert_eq!(child.parent_id, Some(parent.id));
    }

    #[test]
    fn create_and_get_tag() {
        let store = fresh_store();
        let tag = store
            .create_tag(TagInput {
                name: "production".into(),
                color: "#ef4444".into(),
            })
            .unwrap();
        let got = store.get_tags().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "production");
        assert_eq!(got[0].color, "#ef4444");
        assert_eq!(got[0].id, tag.id);
    }

    #[test]
    fn create_and_get_connection() {
        let store = fresh_store();
        let conn = store
            .create_connection(ConnectionInput {
                name: "Prod".into(),
                db_type: "postgresql".into(),
                host: "prod.example.com".into(),
                port: Some(5432),
                username: Some("admin".into()),
                folder_id: None,
                tag_ids: vec![],
            })
            .unwrap();
        let got = store.get_connections().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Prod");
        assert_eq!(got[0].port, Some(5432));
        assert!(got[0].tag_ids.is_empty());
        assert_eq!(got[0].id, conn.id);
    }

    #[test]
    fn connection_with_tags_persists_join() {
        let store = fresh_store();
        let t1 = store
            .create_tag(TagInput {
                name: "prod".into(),
                color: "#ef4444".into(),
            })
            .unwrap();
        let t2 = store
            .create_tag(TagInput {
                name: "primary".into(),
                color: "#3b82f6".into(),
            })
            .unwrap();
        store
            .create_connection(ConnectionInput {
                name: "Prod".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                tag_ids: vec![t1.id.clone(), t2.id.clone()],
            })
            .unwrap();
        let got = store.get_connections().unwrap();
        assert_eq!(got[0].tag_ids.len(), 2);
        assert!(got[0].tag_ids.contains(&t1.id));
        assert!(got[0].tag_ids.contains(&t2.id));
    }

    #[test]
    fn delete_folder_sets_connection_folder_null() {
        let store = fresh_store();
        let folder = store
            .create_folder(FolderInput { tag_ids: None,
                name: "f".into(),
                parent_id: None,
            })
            .unwrap();
        store
            .create_connection(ConnectionInput {
                name: "C".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: Some(folder.id.clone()),
                tag_ids: vec![],
            })
            .unwrap();
        store.delete_folder(&folder.id).unwrap();
        let conns = store.get_connections().unwrap();
        assert!(conns[0].folder_id.is_none());
    }

    #[test]
    fn delete_tag_removes_from_connection() {
        let store = fresh_store();
        let tag = store
            .create_tag(TagInput {
                name: "prod".into(),
                color: "#ef4444".into(),
            })
            .unwrap();
        store
            .create_connection(ConnectionInput {
                name: "C".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                tag_ids: vec![tag.id.clone()],
            })
            .unwrap();
        store.delete_tag(&tag.id).unwrap();
        let conns = store.get_connections().unwrap();
        assert!(conns[0].tag_ids.is_empty());
    }

    #[test]
    fn settings_get_returns_defaults_when_empty() {
        let store = fresh_store();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.theme, "dark");
        assert_eq!(settings.font_size, "medium");
        assert!(settings.confirm_before_delete);
        assert_eq!(
            settings.default_ports.get("postgresql"),
            Some(&Some(5432))
        );
    }

    #[test]
    fn settings_update_persists() {
        let store = fresh_store();
        store.update_setting("theme", "light").unwrap();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.theme, "light");
    }
}