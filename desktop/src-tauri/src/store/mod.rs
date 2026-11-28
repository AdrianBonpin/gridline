pub mod migrations;
pub mod permissions;
pub(crate) mod settings_schema;

use rusqlite::params;
use rusqlite::Connection as SqliteConnection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::models::{Connection, ConnectionInput, Folder, FolderInput, Settings, Tag, TagInput};

pub struct Store {
    conn: Mutex<SqliteConnection>,
}

/// Host-key blobs are persisted base64-encoded (the same encoding known-hosts
/// uses), never as raw bytes in a text column.
fn trust_blob_to_text(blob: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, blob)
}

fn row_to_trust_record(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<crate::models::HostTrustRecord> {
    let key_blob: String = row.get(4)?;
    let blob = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &key_blob)
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(crate::models::HostTrustRecord {
        host: row.get(0)?,
        port: row.get::<_, i64>(1)? as u16,
        key: crate::models::HostKey {
            key_type: row.get(2)?,
            blob,
        },
        fingerprint: row.get(3)?,
        enrolled_at: row.get(5)?,
    })
}

/// A saved query row (returned from the store).
#[derive(Debug, Clone)]
pub struct SavedQueryRow {
    pub id: String,
    pub connection_id: Option<String>,
    pub name: String,
    pub query_text: String,
    pub folder: String,
    pub created_at: String,
    pub updated_at: String,
}

const MAX_NAME_LEN: usize = 200;
const MAX_FOLDER_LEN: usize = 100;
const MAX_QUERY_TEXT_LEN: usize = 1_048_576; // 1 MB

impl Store {
    /// Wrap an already-opened connection as a store.
    ///
    /// Referential enforcement is part of the store contract, so it is enabled
    /// here as well as in [`Store::open`]: SQLite applies `foreign_keys` per
    /// connection and its default depends on how the library was built, which
    /// is exactly how Connection-owned Data used to become unreachable. Failure
    /// is reported to the caller, never swallowed: a store without enforcement
    /// would let dangling rows accumulate silently.
    pub fn from_connection(conn: SqliteConnection) -> Result<Self, String> {
        Self::enforce_referential_integrity(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Turn on foreign keys for this connection and verify they are active.
    /// A silent no-op (SQLite ignores the pragma inside a transaction) or a
    /// library built with a different default fails the store instead of being
    /// trusted.
    fn enforce_referential_integrity(conn: &SqliteConnection) -> Result<(), String> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| {
                format!("failed to enable referential enforcement on the local store: {e}")
            })?;
        let active: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .map_err(|e| format!("failed to read local store enforcement state: {e}"))?;
        if active != 1 {
            return Err("referential enforcement is not active on the local store".to_string());
        }
        Ok(())
    }

    pub fn open(path: &str) -> Result<Self, String> {
        let db_path = Path::new(path);
        // Secure the directory before the file is created, then restrict the
        // file and any sidecars left by a previous run. Both steps are
        // idempotent, so an existing installation is tightened on this open.
        permissions::secure_store_directory(db_path)?;
        let conn = SqliteConnection::open(db_path).map_err(|e| e.to_string())?;
        permissions::secure_store_files(db_path)?;
        migrations::run_migrations(&conn).map_err(|e| e.to_string())?;
        Self::from_connection(conn)
    }

    fn now() -> String {
        chrono::Utc::now().to_rfc3339()
    }

    pub fn get_folders(&self) -> Result<Vec<Folder>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, parent_id, created_at, updated_at FROM folders ORDER BY name",
            )
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
                "SELECT id, name, db_type, host, port, username, database, folder_id, keychain_ref, ssh_host, ssh_port, ssh_user, ssh_auth_method, ssh_private_key_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, environment, favorite, created_at, updated_at, use_keychain FROM connections ORDER BY name",
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
                    database: row.get(6)?,
                    folder_id: row.get(7)?,
                    keychain_ref: row.get(8)?,
                    ssh_host: row.get(9)?,
                    ssh_port: row.get(10)?,
                    ssh_user: row.get(11)?,
                    ssh_auth_method: row.get(12)?,
                    ssh_private_key_path: row.get(13)?,
                    ssl_mode: row.get(14)?,
                    ssl_ca_path: row.get(15)?,
                    ssl_cert_path: row.get(16)?,
                    ssl_key_path: row.get(17)?,
                    environment: row.get(18)?,
                    favorite: row.get(19)?,
                    tag_ids: vec![],
                    created_at: row.get(20)?,
                    updated_at: row.get(21)?,
                    use_keychain: row.get(22)?,
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
            "INSERT INTO connections (id, name, db_type, host, port, username, database, folder_id, keychain_ref, ssh_host, ssh_port, ssh_user, ssh_auth_method, ssh_private_key_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, environment, created_at, updated_at, use_keychain) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
            params![id, input.name, input.db_type, input.host, input.port, input.username, input.database, input.folder_id, input.ssh_host, input.ssh_port, input.ssh_user, input.ssh_auth_method, input.ssh_private_key_path, input.ssl_mode, input.ssl_ca_path, input.ssl_cert_path, input.ssl_key_path, input.environment, now, now, input.use_keychain],
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
            database: input.database,
            keychain_ref: None,
            environment: input.environment,
            favorite: false,
            ssh_host: input.ssh_host,
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user,
            ssh_auth_method: input.ssh_auth_method,
            ssh_private_key_path: input.ssh_private_key_path,
            ssl_mode: input.ssl_mode,
            ssl_ca_path: input.ssl_ca_path,
            ssl_cert_path: input.ssl_cert_path,
            ssl_key_path: input.ssl_key_path,
            tag_ids: input.tag_ids,
            use_keychain: input.use_keychain,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn set_connection_favorite(&self, id: &str, favorite: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let fav: i64 = if favorite { 1 } else { 0 };
        conn.execute(
            "UPDATE connections SET favorite = ?1, updated_at = ?2 WHERE id = ?3",
            params![fav, Self::now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_recent_connections(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::models::RecentConnection>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT connection_id, opened_at FROM recent_connections ORDER BY opened_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(crate::models::RecentConnection {
                    connection_id: row.get(0)?,
                    opened_at: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn record_recent_connection(&self, connection_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();
        conn.execute(
            "INSERT INTO recent_connections (connection_id, opened_at) VALUES (?1, ?2)
             ON CONFLICT(connection_id) DO UPDATE SET opened_at = excluded.opened_at",
            params![connection_id, now],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM recent_connections WHERE connection_id NOT IN (
                SELECT connection_id FROM recent_connections ORDER BY opened_at DESC LIMIT 20
            )",
            [],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear_recent_connections(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM recent_connections", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ------------------------------------------------------------------
    // SSH host trust (ADR 0001)
    //
    // Non-secret metadata only: the endpoint, the host-key identity and when
    // the user accepted it. Passwords, private keys and passphrases live in
    // the OS keychain, never here.
    // ------------------------------------------------------------------

    pub fn get_ssh_host_trust(
        &self,
        host: &str,
        port: u16,
    ) -> Result<Option<crate::models::HostTrustRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT host, port, key_type, fingerprint, key_blob, enrolled_at
                 FROM ssh_host_trust WHERE host = ?1 AND port = ?2",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![host, port as i64], row_to_trust_record)
            .map_err(|e| e.to_string())?;
        match rows.next() {
            Some(Ok(record)) => Ok(Some(record)),
            Some(Err(e)) => Err(e.to_string()),
            None => Ok(None),
        }
    }

    pub fn remember_ssh_host_trust(
        &self,
        record: &crate::models::HostTrustRecord,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO ssh_host_trust
                 (host, port, key_type, fingerprint, key_blob, enrolled_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(host, port) DO UPDATE SET
                 key_type = excluded.key_type,
                 fingerprint = excluded.fingerprint,
                 key_blob = excluded.key_blob,
                 enrolled_at = excluded.enrolled_at",
            params![
                record.host,
                record.port as i64,
                record.key.key_type,
                record.fingerprint,
                trust_blob_to_text(&record.key.blob),
                record.enrolled_at
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Forget an enrollment so the next connection re-enrolls. Deliberate
    /// re-enrollment uses this; authentication never does.
    pub fn forget_ssh_host_trust(&self, host: &str, port: u16) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ssh_host_trust WHERE host = ?1 AND port = ?2",
            params![host, port as i64],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM connections WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_connection(
        &self,
        id: &str,
        input: ConnectionInput,
    ) -> Result<Connection, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();
        conn.execute(
            "UPDATE connections SET name=?1, db_type=?2, host=?3, port=?4, username=?5, database=?6, folder_id=?7, ssh_host=?8, ssh_port=?9, ssh_user=?10, ssh_auth_method=?11, ssh_private_key_path=?12, ssl_mode=?13, ssl_ca_path=?14, ssl_cert_path=?15, ssl_key_path=?16, environment=?17, use_keychain=?18, updated_at=?19 WHERE id=?20",
            params![
                input.name, input.db_type, input.host, input.port, input.username,
                input.database, input.folder_id, input.ssh_host, input.ssh_port,
                input.ssh_user, input.ssh_auth_method, input.ssh_private_key_path,
                input.ssl_mode, input.ssl_ca_path, input.ssl_cert_path, input.ssl_key_path,
                input.environment, input.use_keychain, now, id
            ],
        ).map_err(|e| e.to_string())?;
        // Update tags
        conn.execute(
            "DELETE FROM connection_tags WHERE connection_id = ?1",
            params![id],
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
            id: id.to_string(),
            name: input.name,
            db_type: input.db_type,
            host: input.host,
            port: input.port,
            username: input.username,
            database: input.database,
            folder_id: input.folder_id,
            keychain_ref: None,
            environment: input.environment,
            favorite: false,
            ssh_host: input.ssh_host,
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user,
            ssh_auth_method: input.ssh_auth_method,
            ssh_private_key_path: input.ssh_private_key_path,
            ssl_mode: input.ssl_mode,
            ssl_ca_path: input.ssl_ca_path,
            ssl_cert_path: input.ssl_cert_path,
            ssl_key_path: input.ssl_key_path,
            tag_ids: input.tag_ids.clone(),
            use_keychain: input.use_keychain,
            created_at: String::new(), // not updated
            updated_at: now,
        })
    }

    pub fn get_settings(&self) -> Result<Settings, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut map: HashMap<String, String> = HashMap::new();
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for r in rows.filter_map(|r| r.ok()) {
            map.insert(r.0, r.1);
        }
        // Every value below goes through the declared rule table, which is the
        // single source of validity: a value an older build wrote that no longer
        // satisfies its rule is normalised here, so read-back never errors.
        let ports_json = settings_schema::read_back(&map, "default_ports");
        let default_ports: HashMap<String, Option<i64>> =
            serde_json::from_str(&ports_json).unwrap_or_default();
        let shortcuts_json = settings_schema::read_back(&map, "shortcuts");
        let shortcuts: HashMap<String, String> =
            serde_json::from_str(&shortcuts_json).unwrap_or_default();
        Ok(Settings {
            confirm_before_delete: settings_schema::read_back_bool(&map, "confirm_before_delete"),
            default_folder_id: settings_schema::read_back_optional(&map, "default_folder_id"),
            theme: settings_schema::read_back(&map, "theme"),
            font_size: settings_schema::read_back(&map, "font_size"),
            default_ports,
            tag_order: settings_schema::read_back_optional(&map, "tag_order"),
            table_refresh_rate: settings_schema::read_back_int(&map, "table_refresh_rate"),
            table_page_size: settings_schema::read_back_int(&map, "table_page_size"),
            shortcuts,
            accent_color: settings_schema::read_back(&map, "accent_color"),
            editor_font_size: settings_schema::read_back_int(&map, "editor_font_size"),
            editor_font_family: settings_schema::read_back(&map, "editor_font_family"),
            editor_word_wrap: settings_schema::read_back(&map, "editor_word_wrap"),
            editor_minimap: settings_schema::read_back_bool(&map, "editor_minimap"),
            editor_tab_size: settings_schema::read_back_int(&map, "editor_tab_size"),
        })
    }

    /// Write one setting, judged by the declared rule table.
    ///
    /// The store is the boundary, not the IPC layer: a future caller that reaches
    /// the store directly is governed by the same rule, and a key the table does
    /// not know is refused rather than stored (ADR 0003).
    pub fn update_setting(&self, key: &str, value: &str) -> Result<(), String> {
        settings_schema::check(key, value).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Bulk-write settings keys in one transaction (used by settings import).
    ///
    /// Every entry is judged before the transaction opens, so a batch with one bad
    /// entry stores none of them — a half-applied settings set is neither the old
    /// one nor the new one and the user cannot tell which (ADR 0003). The rules
    /// stay declared in [`settings_schema`], never re-stated by the caller.
    pub fn apply_settings(
        &self,
        map: &std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        settings_schema::check_batch(map.iter()).map_err(|e| e.to_string())?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        for (k, v) in map.iter() {
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                rusqlite::params![k, v],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Insert a row into the `query_history` table.
    /// Dedups consecutive identical queries per connection (UPDATE the last row
    /// instead of INSERTing a new one) and prunes to at most 500 rows per connection.
    pub fn insert_query_history(
        &self,
        id: &str,
        connection_id: &str,
        query_text: &str,
        execution_time_ms: Option<i64>,
        row_count: Option<i64>,
        status: &str,
        error_message: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();

        // DEDUP: check last row for this connection
        let last: Option<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT id, query_text FROM query_history
                     WHERE connection_id = ?1
                     ORDER BY executed_at DESC LIMIT 1",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_row(params![connection_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok()
        };

        if let Some((existing_id, existing_text)) = last {
            if existing_text == query_text {
                // Consecutive identical — UPDATE the existing row
                conn.execute(
                    "UPDATE query_history SET execution_time_ms = ?1, row_count = ?2, status = ?3, error_message = ?4, executed_at = ?5 WHERE id = ?6",
                    params![execution_time_ms, row_count, status, error_message, now, existing_id],
                )
                .map_err(|e| e.to_string())?;
                // Still run pruning in case updates shifted retention needs
                prune_query_history(&conn, connection_id, 500)?;
                return Ok(());
            }
        }

        // INSERT new row
        conn.execute(
            "INSERT INTO query_history (id, connection_id, query_text, execution_time_ms, row_count, status, error_message, executed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, connection_id, query_text, execution_time_ms, row_count, status, error_message, now],
        )
        .map_err(|e| e.to_string())?;

        // PRUNING: keep at most `max_rows` per connection
        prune_query_history(&conn, connection_id, 500)?;

        Ok(())
    }

    /// Fetch query history rows, optionally filtered by `connection_id`.
    /// Returns results ordered by `executed_at DESC`.
    pub fn get_query_history(
        &self,
        connection_id: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<crate::commands::query::QueryHistoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(cid) =
            connection_id
        {
            (
                    "SELECT id, connection_id, query_text, execution_time_ms, row_count, status, error_message, executed_at, favorite FROM query_history WHERE connection_id = ?1 ORDER BY executed_at DESC LIMIT ?2 OFFSET ?3".to_string(),
                    vec![Box::new(cid.to_string()), Box::new(limit), Box::new(offset)],
                )
        } else {
            (
                    "SELECT id, connection_id, query_text, execution_time_ms, row_count, status, error_message, executed_at, favorite FROM query_history ORDER BY executed_at DESC LIMIT ?1 OFFSET ?2".to_string(),
                    vec![Box::new(limit), Box::new(offset)],
                )
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(&refs), |row| {
                Ok(crate::commands::query::QueryHistoryEntry {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    query_text: row.get(2)?,
                    execution_time_ms: row.get(3)?,
                    row_count: row.get(4)?,
                    status: row.get(5)?,
                    error_message: row.get(6)?,
                    executed_at: row.get(7)?,
                    favorite: row.get::<_, i64>(8)? != 0, // convert INTEGER to bool
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Delete all query history rows, optionally filtered by `connection_id`.
    pub fn clear_query_history(&self, connection_id: Option<&str>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        if let Some(cid) = connection_id {
            conn.execute(
                "DELETE FROM query_history WHERE connection_id = ?1",
                params![cid],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute("DELETE FROM query_history", [])
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Toggle the `favorite` flag for a query history entry.
    /// Returns an error if no row with the given id + connection_id exists.
    pub fn set_history_favorite(&self, id: &str, connection_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let affected = conn
            .execute(
                "UPDATE query_history SET favorite = 1 - favorite WHERE id = ?1 AND connection_id = ?2",
                params![id, connection_id],
            )
            .map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err("History entry not found".to_string());
        }
        Ok(())
    }

    pub fn save_query(
        &self,
        connection_id: Option<&str>,
        name: &str,
        query_text: &str,
        folder: &str,
    ) -> Result<SavedQueryRow, String> {
        if name.is_empty() || name.len() > MAX_NAME_LEN {
            return Err("Name must be 1–200 characters".to_string());
        }
        if folder.len() > MAX_FOLDER_LEN {
            return Err("Folder must be ≤100 characters".to_string());
        }
        if query_text.len() > MAX_QUERY_TEXT_LEN {
            return Err("Query text must be ≤1 MB".to_string());
        }

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = Self::now();
        conn.execute(
            "INSERT INTO queries (id, connection_id, name, query_text, folder, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, connection_id, name, query_text, folder, now, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(SavedQueryRow {
            id,
            connection_id: connection_id.map(|s| s.to_string()),
            name: name.to_string(),
            query_text: query_text.to_string(),
            folder: folder.to_string(),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_saved_queries(
        &self,
        connection_id: Option<&str>,
    ) -> Result<Vec<SavedQueryRow>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let (sql, params_vec): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(cid) =
            connection_id
        {
            (
                    "SELECT id, connection_id, name, query_text, folder, created_at, updated_at FROM queries WHERE connection_id = ?1 ORDER BY updated_at DESC".to_string(),
                    vec![Box::new(cid.to_string())],
                )
        } else {
            (
                    "SELECT id, connection_id, name, query_text, folder, created_at, updated_at FROM queries ORDER BY updated_at DESC".to_string(),
                    vec![],
                )
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(&refs), |row| {
                Ok(SavedQueryRow {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    name: row.get(2)?,
                    query_text: row.get(3)?,
                    folder: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn update_saved_query(
        &self,
        id: &str,
        name: Option<&str>,
        query_text: Option<&str>,
        folder: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = Self::now();
        // Build dynamic SET clauses
        let mut sets: Vec<String> = vec!["updated_at = ?1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        let mut idx = 2i32; // next param index (after ?1 for updated_at)

        if let Some(n) = name {
            if n.is_empty() || n.len() > MAX_NAME_LEN {
                return Err("Name must be 1–200 characters".to_string());
            }
            sets.push(format!("name = ?{idx}"));
            params.push(Box::new(n.to_string()));
            idx += 1;
        }
        if let Some(qt) = query_text {
            if qt.len() > MAX_QUERY_TEXT_LEN {
                return Err("Query text must be ≤1 MB".to_string());
            }
            sets.push(format!("query_text = ?{idx}"));
            params.push(Box::new(qt.to_string()));
            idx += 1;
        }
        if let Some(f) = folder {
            if f.len() > MAX_FOLDER_LEN {
                return Err("Folder must be ≤100 characters".to_string());
            }
            sets.push(format!("folder = ?{idx}"));
            params.push(Box::new(f.to_string()));
            idx += 1;
        }

        let sql = format!("UPDATE queries SET {} WHERE id = ?{idx}", sets.join(", "),);
        let mut all_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let id_param: Box<dyn rusqlite::types::ToSql> = Box::new(id.to_string());
        all_refs.push(id_param.as_ref());

        conn.execute(&sql, rusqlite::params_from_iter(&all_refs))
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_saved_query(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM queries WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Delete oldest rows for a connection, keeping at most `max_rows`.
fn prune_query_history(
    conn: &rusqlite::Connection,
    connection_id: &str,
    max_rows: i64,
) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM query_history WHERE connection_id = ?1",
            params![connection_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count > max_rows {
        conn.execute(
            "DELETE FROM query_history WHERE connection_id = ?1 AND id NOT IN (
                SELECT id FROM query_history WHERE connection_id = ?1
                ORDER BY executed_at DESC LIMIT ?2
            )",
            params![connection_id, max_rows],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ConnectionInput, FolderInput, TagInput};

    fn fresh_store() -> Store {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        Store::from_connection(conn).expect("test store")
    }

    /// A unique on-disk store directory (the production shape) plus its store
    /// file path. Removed by `remove_store_dir`.
    fn temp_store(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir =
            std::env::temp_dir().join(format!("gridline_store_{tag}_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("gridline.db");
        (dir, db)
    }

    fn remove_store_dir(dir: &std::path::Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn opened_store_rejects_connection_owned_data_for_a_missing_connection() {
        let (dir, db) = temp_store("enforced_open");
        let store = Store::open(db.to_str().unwrap()).unwrap();

        assert!(
            store
                .insert_query_history(
                    "h1",
                    "missing-connection",
                    "SELECT 1",
                    None,
                    None,
                    "success",
                    None
                )
                .is_err(),
            "an opened store must reject query history for an unreachable connection"
        );
        assert!(
            store
                .record_recent_connection("missing-connection")
                .is_err(),
            "an opened store must reject recent records for an unreachable connection"
        );
        assert!(
            store
                .save_query(Some("missing-connection"), "q", "SELECT 1", "")
                .is_err(),
            "an opened store must reject connection-specific saved queries for an unreachable connection"
        );

        remove_store_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn opening_an_existing_installation_restricts_its_files() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, db) = temp_store("perm_open");
        // A store written by an older build: permissive directory and file
        // modes. (Sidecars are covered by the permissions unit tests because
        // SQLite removes a stale journal while opening the store.)
        std::fs::write(&db, b"").unwrap();
        std::fs::set_permissions(&db, std::fs::Permissions::from_mode(0o644)).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();

        let _store = Store::open(db.to_str().unwrap()).unwrap();

        let mode = |p: &std::path::Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode(&dir),
            0o700,
            "the store directory is tightened on open"
        );
        assert_eq!(mode(&db), 0o600, "the store file is tightened on open");

        remove_store_dir(&dir);
    }

    #[test]
    fn opening_a_store_that_cannot_be_migrated_is_reported() {
        let (dir, db) = temp_store("unreadable");
        // Not a SQLite database: the app must fail loudly instead of running on
        // an uninitialised (and therefore unenforced) store.
        std::fs::write(&db, b"this is not a sqlite database").unwrap();
        let err = match Store::open(db.to_str().unwrap()) {
            Ok(_) => panic!("a store that cannot be migrated must be reported"),
            Err(e) => e,
        };
        assert!(!err.is_empty(), "the failure must carry a reason");

        remove_store_dir(&dir);
    }

    #[test]
    fn store_from_connection_enables_referential_enforcement() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        let before: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 0, "precondition: enforcement starts disabled");

        let store = Store::from_connection(conn).expect("referential enforcement");
        let guard = store.conn.lock().unwrap();
        let after: i64 = guard
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            after, 1,
            "every store handle must enforce referential integrity, not just migrated ones"
        );
    }

    #[test]
    fn deleting_a_connection_removes_its_connection_owned_data() {
        let (dir, db) = temp_store("delete_owned");
        let store = Store::open(db.to_str().unwrap()).unwrap();
        let conn = create_test_connection(&store, "owned");
        store
            .insert_query_history(
                "h1",
                &conn.id,
                "SELECT 1",
                Some(1),
                Some(1),
                "success",
                None,
            )
            .unwrap();
        store.record_recent_connection(&conn.id).unwrap();
        store
            .save_query(Some(&conn.id), "scoped", "SELECT 1", "")
            .unwrap();
        store
            .save_query(None, "global", "SELECT version()", "")
            .unwrap();

        store.delete_connection(&conn.id).unwrap();

        assert!(
            store
                .get_query_history(Some(&conn.id), 10, 0)
                .unwrap()
                .is_empty(),
            "query history is Connection-owned Data"
        );
        assert!(
            store.get_recent_connections(10).unwrap().is_empty(),
            "recent records are Connection-owned Data"
        );
        assert!(
            store.list_saved_queries(Some(&conn.id)).unwrap().is_empty(),
            "connection-specific saved queries are Connection-owned Data"
        );
        assert_eq!(
            store.list_saved_queries(None).unwrap().len(),
            1,
            "global saved queries are not Connection-owned Data"
        );

        remove_store_dir(&dir);
    }

    #[test]
    fn create_and_get_folder() {
        let store = fresh_store();
        let folder = store
            .create_folder(FolderInput {
                tag_ids: None,
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
            .create_folder(FolderInput {
                tag_ids: None,
                name: "root".into(),
                parent_id: None,
            })
            .unwrap();
        let child = store
            .create_folder(FolderInput {
                tag_ids: None,
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
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
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
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![t1.id.clone(), t2.id.clone()],
                use_keychain: true,
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
            .create_folder(FolderInput {
                tag_ids: None,
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
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
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
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![tag.id.clone()],
                use_keychain: true,
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
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.font_size, "medium");
        assert!(settings.confirm_before_delete);
        assert_eq!(settings.accent_color, "#2563EB");
        assert_eq!(settings.default_ports.get("postgresql"), Some(&Some(5432)));
    }

    #[test]
    fn settings_update_persists() {
        let store = fresh_store();
        store.update_setting("theme", "light").unwrap();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn settings_accent_color_persists() {
        let store = fresh_store();
        store.update_setting("accent_color", "#22C55E").unwrap();
        let settings = store.get_settings().unwrap();
        assert_eq!(settings.accent_color, "#22C55E");
    }

    #[test]
    fn ssh_ssl_fields_persist_and_retrieve() {
        let store = fresh_store();
        let _conn = store
            .create_connection(ConnectionInput {
                name: "SSH-Tunnel-DB".into(),
                db_type: "postgresql".into(),
                host: "localhost".into(),
                port: Some(5432),
                username: Some("dbuser".into()),
                folder_id: None,
                password: None,
                database: Some("analytics".into()),
                ssh_host: Some("jumphost.example.com".into()),
                ssh_port: Some(2222),
                ssh_user: Some("tunneluser".into()),
                ssh_auth_method: Some("Key".into()),
                ssh_private_key_path: Some("/home/user/.ssh/id_rsa".into()),
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: Some("verify-full".into()),
                ssl_ca_path: Some("/etc/ssl/certs/ca.pem".into()),
                ssl_cert_path: Some("/etc/ssl/certs/client-cert.pem".into()),
                ssl_key_path: Some("/etc/ssl/private/client-key.pem".into()),
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap();
        let got = store.get_connections().unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].database.as_deref(), Some("analytics"));
        assert_eq!(got[0].ssh_host.as_deref(), Some("jumphost.example.com"));
        assert_eq!(got[0].ssh_port, Some(2222));
        assert_eq!(got[0].ssh_user.as_deref(), Some("tunneluser"));
        assert_eq!(got[0].ssh_auth_method.as_deref(), Some("Key"));
        assert_eq!(
            got[0].ssh_private_key_path.as_deref(),
            Some("/home/user/.ssh/id_rsa")
        );
        assert_eq!(got[0].ssl_mode.as_deref(), Some("verify-full"));
        assert_eq!(got[0].ssl_ca_path.as_deref(), Some("/etc/ssl/certs/ca.pem"));
        assert_eq!(
            got[0].ssl_cert_path.as_deref(),
            Some("/etc/ssl/certs/client-cert.pem")
        );
        assert_eq!(
            got[0].ssl_key_path.as_deref(),
            Some("/etc/ssl/private/client-key.pem")
        );
    }

    #[test]
    fn insert_query_history_dedups_consecutive_identical() {
        let store = fresh_store();
        // Insert connection needed for FK
        let conn = store
            .create_connection(ConnectionInput {
                name: "dedup-conn".into(),
                db_type: "postgresql".into(),
                host: "localhost".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                password: None,
                database: Some("public".into()),
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap();

        // First insert
        store
            .insert_query_history(
                "h1",
                &conn.id,
                "SELECT 1",
                Some(10),
                Some(5),
                "success",
                None,
            )
            .unwrap();
        // Consecutive identical — should UPDATE, not INSERT
        store
            .insert_query_history(
                "h2",
                &conn.id,
                "SELECT 1",
                Some(20),
                Some(8),
                "success",
                None,
            )
            .unwrap();
        // There should still be 1 row (not 2), with updated stats
        let rows = store.get_query_history(Some(&conn.id), 10, 0).unwrap();
        assert_eq!(
            rows.len(),
            1,
            "Consecutive identical queries should dedup to one row"
        );
        assert_eq!(
            rows[0].execution_time_ms,
            Some(20),
            "Stats should update after dedup"
        );
        assert_eq!(rows[0].id, "h1", "Original ID should persist after dedup");

        // Different query — should INSERT a new row
        store
            .insert_query_history(
                "h3",
                &conn.id,
                "SELECT 2",
                Some(5),
                Some(0),
                "success",
                None,
            )
            .unwrap();
        let rows2 = store.get_query_history(Some(&conn.id), 10, 0).unwrap();
        assert_eq!(rows2.len(), 2, "Different query should create a new row");
        assert_eq!(rows2[0].id, "h3", "Most recent row should be the new one");
    }

    #[test]
    fn insert_query_history_prunes_oldest_beyond_500() {
        let store = fresh_store();
        let conn = store
            .create_connection(ConnectionInput {
                name: "prune-conn".into(),
                db_type: "postgresql".into(),
                host: "localhost".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                password: None,
                database: Some("public".into()),
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap();
        // Insert 510 rows — should trigger pruning beyond 500
        for i in 0..510 {
            store
                .insert_query_history(
                    &format!("ph{}", i),
                    &conn.id,
                    &format!("SELECT {}", i),
                    Some(1),
                    Some(1),
                    "success",
                    None,
                )
                .unwrap();
        }
        let rows = store.get_query_history(Some(&conn.id), 1000, 0).unwrap();
        assert_eq!(rows.len(), 500, "Should be pruned to 500 rows");
        // Oldest rows (ph0..ph9) should be pruned; most recent (ph509) kept
        let all_ids: Vec<String> = rows.iter().map(|r| r.id.clone()).collect();
        assert!(
            !all_ids.contains(&"ph0".to_string()),
            "Oldest rows should be pruned"
        );
        assert!(
            all_ids.contains(&"ph509".to_string()),
            "Most recent rows should be kept"
        );
    }

    #[test]
    fn get_query_history_includes_favorite_column() {
        let store = fresh_store();
        let conn = store
            .create_connection(ConnectionInput {
                name: "fav-conn".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap();
        store
            .insert_query_history(
                "fh1",
                &conn.id,
                "SELECT 1",
                Some(5),
                Some(1),
                "success",
                None,
            )
            .unwrap();
        let rows = store.get_query_history(Some(&conn.id), 10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].favorite, false, "Default favorite should be false");
    }

    #[test]
    fn set_history_favorite_toggles() {
        let store = fresh_store();
        let conn = store
            .create_connection(ConnectionInput {
                name: "ft-conn".into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap();
        store
            .insert_query_history(
                "ft1",
                &conn.id,
                "SELECT 1",
                Some(5),
                Some(1),
                "success",
                None,
            )
            .unwrap();

        // Toggle on
        store.set_history_favorite("ft1", &conn.id).unwrap();
        let rows = store.get_query_history(Some(&conn.id), 10, 0).unwrap();
        assert_eq!(rows[0].favorite, true);

        // Toggle off
        store.set_history_favorite("ft1", &conn.id).unwrap();
        let rows2 = store.get_query_history(Some(&conn.id), 10, 0).unwrap();
        assert_eq!(rows2[0].favorite, false);
    }

    #[test]
    fn set_history_favorite_unknown_id_returns_error() {
        let store = fresh_store();
        let result = store.set_history_favorite("nonexistent", "any-conn");
        assert!(result.is_err(), "Unknown id should be an error");
    }

    #[test]
    fn set_connection_favorite_toggles_and_persists() {
        let store = fresh_store();
        let conn = create_test_connection(&store, "fav-conn");
        store.set_connection_favorite(&conn.id, true).unwrap();
        let conns = store.get_connections().unwrap();
        assert_eq!(conns[0].favorite, true);
        store.set_connection_favorite(&conn.id, false).unwrap();
        assert_eq!(store.get_connections().unwrap()[0].favorite, false);
    }

    #[test]
    fn record_recent_connection_upserts_and_caps_at_20() {
        let store = fresh_store();
        for i in 0..25 {
            let conn = create_test_connection(&store, &format!("c{}", i));
            store.record_recent_connection(&conn.id).unwrap();
        }
        let recent = store.get_recent_connections(100).unwrap();
        assert_eq!(recent.len(), 20, "recent list capped at 20");
    }

    #[test]
    fn record_recent_connection_dedupes_and_bumps_to_top() {
        let store = fresh_store();
        let a = create_test_connection(&store, "a");
        let b = create_test_connection(&store, "b");
        store.record_recent_connection(&a.id).unwrap();
        store.record_recent_connection(&b.id).unwrap();
        store.record_recent_connection(&a.id).unwrap(); // a re-opened -> should be most recent
        let recent = store.get_recent_connections(10).unwrap();
        assert_eq!(recent.len(), 2, "dedupe keeps one row per connection");
        let pos_a = recent.iter().position(|r| r.connection_id == a.id).unwrap();
        let pos_b = recent.iter().position(|r| r.connection_id == b.id).unwrap();
        assert!(pos_a < pos_b, "re-opened a must be most recent");
    }

    #[test]
    fn clear_recent_connections_empties_table() {
        let store = fresh_store();
        let conn = create_test_connection(&store, "x");
        store.record_recent_connection(&conn.id).unwrap();
        store.clear_recent_connections().unwrap();
        assert_eq!(store.get_recent_connections(10).unwrap().len(), 0);
    }

    fn create_test_connection(store: &Store, name: &str) -> crate::models::Connection {
        store
            .create_connection(ConnectionInput {
                name: name.into(),
                db_type: "postgresql".into(),
                host: "h".into(),
                port: Some(5432),
                username: None,
                folder_id: None,
                password: None,
                database: None,
                ssh_host: None,
                ssh_port: None,
                ssh_user: None,
                ssh_auth_method: None,
                ssh_private_key_path: None,
                ssh_password: None,
                ssh_passphrase: None,
                ssl_mode: None,
                ssl_ca_path: None,
                ssl_cert_path: None,
                ssl_key_path: None,
                environment: None,
                tag_ids: vec![],
                use_keychain: true,
            })
            .unwrap()
    }

    #[test]
    fn save_and_list_saved_queries() {
        let store = fresh_store();
        let conn = create_test_connection(&store, "sq-conn");

        let saved = store
            .save_query(Some(&conn.id), "My Query", "SELECT 1", "reports")
            .unwrap();
        assert_eq!(saved.name, "My Query");
        assert_eq!(saved.query_text, "SELECT 1");
        assert_eq!(saved.folder, "reports");
        assert_eq!(saved.connection_id, Some(conn.id.clone()));

        let list = store.list_saved_queries(Some(&conn.id)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);
    }

    #[test]
    fn save_global_saved_query() {
        let store = fresh_store();
        let saved = store
            .save_query(None, "Global Query", "SELECT version()", "")
            .unwrap();
        assert_eq!(saved.connection_id, None);
        let list = store.list_saved_queries(None).unwrap();
        assert!(list.iter().any(|q| q.id == saved.id));
    }

    #[test]
    fn update_and_delete_saved_query() {
        let store = fresh_store();
        let conn = create_test_connection(&store, "ud-conn");
        let saved = store
            .save_query(Some(&conn.id), "Original", "SELECT 1", "")
            .unwrap();

        // Update name
        store
            .update_saved_query(&saved.id, Some("Renamed"), None, None)
            .unwrap();
        let after = store.list_saved_queries(Some(&conn.id)).unwrap();
        assert_eq!(after[0].name, "Renamed");

        // Update query text
        store
            .update_saved_query(&saved.id, None, Some("SELECT 2"), None)
            .unwrap();
        let after2 = store.list_saved_queries(Some(&conn.id)).unwrap();
        assert_eq!(after2[0].query_text, "SELECT 2");

        // Delete
        store.delete_saved_query(&saved.id).unwrap();
        let empty = store.list_saved_queries(Some(&conn.id)).unwrap();
        assert!(empty.is_empty());
    }

    #[test]
    fn saved_query_name_validated() {
        let store = fresh_store();
        // Name > 200 chars should fail
        let long_name = "a".repeat(201);
        let result = store.save_query(None, &long_name, "SELECT 1", "");
        assert!(result.is_err(), "Over-long name should be rejected");
    }

    #[test]
    fn saved_query_folder_validated() {
        let store = fresh_store();
        let long_folder = "b".repeat(101);
        let result = store.save_query(None, "ok", "SELECT 1", &long_folder);
        assert!(result.is_err(), "Over-long folder should be rejected");
    }

    #[test]
    fn saved_query_text_size_validated() {
        let store = fresh_store();
        let huge_text = "x".repeat(1_048_577); // 1MB + 1 byte
        let result = store.save_query(None, "ok", &huge_text, "");
        assert!(result.is_err(), "Over-size query text should be rejected");
    }

    #[test]
    fn editor_settings_defaults_when_unset() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Store::from_connection(conn).expect("test store");
        let s = store.get_settings().unwrap();
        assert_eq!(s.editor_font_size, 13);
        assert_eq!(s.editor_font_family, "Space Mono");
        assert_eq!(s.editor_word_wrap, "off");
        assert!(!s.editor_minimap);
        assert_eq!(s.editor_tab_size, 4);
    }

    #[test]
    fn editor_settings_clamp_out_of_range() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Store::from_connection(conn).expect("test store");
        // Stored by a build that clamped on read only: the write path now refuses
        // these, so they are planted directly to exercise read-back.
        put_stored_setting(&store, "editor_font_size", "999");
        put_stored_setting(&store, "editor_tab_size", "1");
        store.update_setting("editor_minimap", "true").unwrap();
        let s = store.get_settings().unwrap();
        assert_eq!(s.editor_font_size, 24, "font_size clamps to 24");
        assert_eq!(s.editor_tab_size, 2, "tab_size clamps to 2");
        assert!(s.editor_minimap);
    }

    #[test]
    fn editor_settings_garbage_and_disallowed_fall_back() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        let store = Store::from_connection(conn).expect("test store");
        put_stored_setting(&store, "editor_font_size", "abc");
        put_stored_setting(&store, "editor_font_family", "Comic Sans");
        put_stored_setting(&store, "editor_word_wrap", "weird");
        let s = store.get_settings().unwrap();
        assert_eq!(s.editor_font_size, 13, "garbage -> default");
        assert_eq!(
            s.editor_font_family, "Space Mono",
            "disallowed font -> default"
        );
        assert_eq!(s.editor_word_wrap, "off", "invalid wrap -> default");
    }

    // ── One declared validity rule per settings key (ADR 0003) ────────

    /// Store a value the way a previous build could have: straight into the row,
    /// bypassing the write path that now refuses it. Read-back must still cope.
    fn put_stored_setting(store: &Store, key: &str, value: &str) {
        let conn = store.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .unwrap();
    }

    fn stored_setting_count(store: &Store, key: &str) -> i64 {
        let conn = store.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .unwrap()
    }

    /// The raw stored text for a key, if a row exists.
    fn stored_setting_value(store: &Store, key: &str) -> Option<String> {
        let conn = store.conn.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .ok()
    }

    /// Every value the settings interface can produce, as `(key, value)` pairs.
    /// Kept independent of the validator table on purpose: the table must cover
    /// what the interface writes, not the other way round.
    const INTERFACE_WRITES: &[(&str, &str)] = &[
        ("theme", "dark"),
        ("theme", "light"),
        ("theme", "system"),
        ("font_size", "small"),
        ("font_size", "medium"),
        ("font_size", "large"),
        ("accent_color", "#2563EB"),
        ("accent_color", "#22C55E"),
        // "None" in the default-folder dropdown, and a real folder id.
        ("default_folder_id", ""),
        ("default_folder_id", "4d1a2f8e-0b7c-4b3e-9c1d-2f6a8b0c9e11"),
        ("confirm_before_delete", "true"),
        ("confirm_before_delete", "false"),
        ("table_refresh_rate", "0"),
        ("table_refresh_rate", "300000"),
        ("table_page_size", "50"),
        ("table_page_size", "500"),
        (
            "default_ports",
            "{\"postgresql\":5432,\"mysql\":3306,\"sqlite\":null,\"redis\":6379}",
        ),
        // A cleared port field in the advanced tab.
        ("default_ports", "{\"postgresql\":null}"),
        ("tag_order", "[\"tag-b\",\"tag-a\"]"),
        ("shortcuts", "{\"open_command_palette\":\"Meta+K\"}"),
        ("editor_font_size", "8"),
        ("editor_font_size", "24"),
        ("editor_font_family", "Space Mono"),
        ("editor_font_family", "Fira Code"),
        ("editor_font_family", "monospace"),
        ("editor_word_wrap", "off"),
        ("editor_word_wrap", "on"),
        ("editor_minimap", "true"),
        ("editor_minimap", "false"),
        ("editor_tab_size", "2"),
        ("editor_tab_size", "8"),
    ];

    /// Every key the store knows, with the inclusive bounds of its range where it
    /// has one. The bounds are the ones the interface offers (a page size of 500,
    /// an editor font size of 24, …) and are written out here deliberately.
    const RANGED_KEYS: &[(&str, i64, i64)] = &[
        ("table_page_size", 1, 500),
        ("table_refresh_rate", 0, 300000),
        ("editor_font_size", 8, 24),
        ("editor_tab_size", 2, 8),
    ];

    #[test]
    fn every_setting_the_interface_writes_has_a_rule_that_accepts_it() {
        let store = fresh_store();
        for (key, value) in INTERFACE_WRITES {
            assert!(
                store.update_setting(key, value).is_ok(),
                "the interface writes {key}={value:?}, so a rule must accept it"
            );
        }
    }

    #[test]
    fn a_write_of_an_unknown_key_is_refused_with_the_key_named() {
        let store = fresh_store();
        for key in ["theme_extra", "Theme", "table_page_sizes", ""] {
            let err = store
                .update_setting(key, "anything")
                .expect_err("an unknown key must not be stored");
            assert!(
                err.contains(&format!("{key:?}")) || (key.is_empty() && err.contains("\"\"")),
                "the refusal must name the key {key:?}: {err}"
            );
            assert_eq!(
                stored_setting_count(&store, key),
                0,
                "an unknown key must not be persisted"
            );
        }
    }

    #[test]
    fn the_boundaries_of_every_ranged_key_are_accepted_and_their_neighbours_refused() {
        for (key, min, max) in RANGED_KEYS {
            let store = fresh_store();
            for good in [*min, *max] {
                store
                    .update_setting(key, &good.to_string())
                    .unwrap_or_else(|e| {
                        panic!("{key}={good} is the boundary and must be accepted: {e}")
                    });
            }
            for bad in [min - 1, max + 1] {
                let err = store
                    .update_setting(key, &bad.to_string())
                    .expect_err("a value outside the range must be refused");
                assert!(err.contains(key), "the refusal must name {key}: {err}");
                assert!(
                    err.contains(&min.to_string()) && err.contains(&max.to_string()),
                    "the refusal must state the valid range {min}..={max}: {err}"
                );
            }
            assert_eq!(
                stored_setting_value(&store, key),
                Some(max.to_string()),
                "a refused write must leave the last valid value in place"
            );
        }
    }

    #[test]
    fn malformed_values_are_refused_rather_than_stored() {
        let malformed: &[(&str, &str)] = &[
            ("table_page_size", "ten"),
            ("table_page_size", "12.5"),
            ("table_page_size", ""),
            ("table_refresh_rate", "soon"),
            ("editor_font_size", "abc"),
            ("editor_tab_size", "1.5"),
            ("theme", "purple"),
            ("font_size", "huge"),
            ("accent_color", "blue"),
            ("accent_color", "#12345"),
            ("confirm_before_delete", "yes"),
            ("editor_minimap", "1"),
            ("editor_word_wrap", "weird"),
            ("editor_font_family", "Comic Sans"),
            ("default_ports", "not json"),
            ("default_ports", "{\"postgresql\":70000}"),
            ("default_ports", "{\"postgresql\":\"5432\"}"),
            ("default_ports", "[]"),
            ("shortcuts", "not json"),
            ("shortcuts", "[]"),
            ("tag_order", "{\"tag\":1}"),
            ("tag_order", "[1,2]"),
        ];
        for (key, value) in malformed {
            let store = fresh_store();
            let err = match store.update_setting(key, value) {
                Ok(()) => panic!("{key}={value:?} must be refused"),
                Err(e) => e,
            };
            assert!(err.contains(key), "the refusal must name {key}: {err}");
            assert_eq!(
                stored_setting_count(&store, key),
                0,
                "a malformed value must not be stored"
            );
        }
    }

    #[test]
    fn read_back_normalises_what_a_previous_build_could_have_stored() {
        let store = fresh_store();
        let old_values: &[(&str, &str)] = &[
            ("table_page_size", "100000"),
            ("table_refresh_rate", "-1"),
            ("editor_font_size", "999"),
            ("editor_tab_size", "1"),
            ("editor_font_family", "Comic Sans"),
            ("editor_word_wrap", "weird"),
            ("editor_minimap", "1"),
            ("theme", "purple"),
            ("font_size", "huge"),
            ("accent_color", "chartreuse"),
            ("confirm_before_delete", "yes"),
            ("default_ports", "not json"),
            ("shortcuts", "[]"),
            ("tag_order", "oops"),
            ("default_folder_id", "null"),
        ];
        for (key, value) in old_values {
            put_stored_setting(&store, key, value);
        }

        let s = store
            .get_settings()
            .expect("read-back must never error on a stored value it did not write");
        assert_eq!(s.table_page_size, 500);
        assert_eq!(s.table_refresh_rate, 0);
        assert_eq!(s.editor_font_size, 24);
        assert_eq!(s.editor_tab_size, 2);
        assert_eq!(s.editor_font_family, "Space Mono");
        assert_eq!(s.editor_word_wrap, "off");
        assert!(!s.editor_minimap);
        assert_eq!(s.theme, "system");
        assert_eq!(s.font_size, "medium");
        assert_eq!(s.accent_color, "#2563EB");
        assert!(s.confirm_before_delete);
        assert_eq!(s.default_ports.get("postgresql"), Some(&Some(5432)));
        assert!(s.shortcuts.is_empty());
        assert_eq!(s.tag_order, None);
        assert_eq!(s.default_folder_id, None);

        // A stored value that cannot be salvaged becomes the declared default
        // rather than an error or empty output.
        let unsalvageable = fresh_store();
        put_stored_setting(&unsalvageable, "table_page_size", "not a number");
        put_stored_setting(&unsalvageable, "editor_tab_size", "");
        let s = unsalvageable.get_settings().unwrap();
        assert_eq!(s.table_page_size, 50);
        assert_eq!(s.editor_tab_size, 4);
    }

    #[test]
    fn read_back_keeps_a_stored_value_that_still_satisfies_its_rule() {
        let store = fresh_store();
        put_stored_setting(&store, "table_page_size", "200");
        put_stored_setting(&store, "theme", "light");
        let s = store.get_settings().unwrap();
        assert_eq!(s.table_page_size, 200);
        assert_eq!(s.theme, "light");
    }

    #[test]
    fn a_bulk_write_validates_every_entry_before_writing_any_of_them() {
        let store = fresh_store();
        store.update_setting("theme", "dark").unwrap();

        let mut batch = HashMap::new();
        batch.insert("theme".to_string(), "light".to_string());
        batch.insert("table_page_size".to_string(), "100000".to_string());
        let err = store
            .apply_settings(&batch)
            .expect_err("an invalid entry must reject the whole batch");
        assert!(err.contains("table_page_size"), "{err}");
        assert_eq!(
            store.get_settings().unwrap().theme,
            "dark",
            "a refused batch must apply none of its entries"
        );

        let mut unknown = HashMap::new();
        unknown.insert("not_a_setting".to_string(), "1".to_string());
        let err = store
            .apply_settings(&unknown)
            .expect_err("an unknown key must reject the whole batch");
        assert!(err.contains("not_a_setting"), "{err}");
    }

    fn trust_record(host: &str, port: u16, seed: u8) -> crate::models::HostTrustRecord {
        let mut blob = Vec::new();
        blob.extend_from_slice(&11u32.to_be_bytes());
        blob.extend_from_slice(b"ssh-ed25519");
        blob.extend_from_slice(&[seed; 32]);
        crate::models::HostTrustRecord {
            host: host.to_string(),
            port,
            key: crate::models::HostKey {
                key_type: "ssh-ed25519".into(),
                blob,
            },
            fingerprint: format!("SHA256:seed-{seed}"),
            enrolled_at: "2026-11-21T00:00:00Z".into(),
        }
    }

    #[test]
    fn ssh_host_trust_round_trips_and_is_keyed_by_endpoint() {
        let store = fresh_store();
        assert!(store
            .get_ssh_host_trust("db.example.com", 22)
            .unwrap()
            .is_none());

        let record = trust_record("db.example.com", 2222, 1);
        store.remember_ssh_host_trust(&record).unwrap();

        let got = store
            .get_ssh_host_trust("db.example.com", 2222)
            .unwrap()
            .expect("record persisted");
        assert_eq!(got.key, record.key, "the key blob survives the round trip");
        assert_eq!(got.fingerprint, record.fingerprint);

        // Non-standard ports are part of the identity: another port is a
        // different endpoint, not the same trust.
        assert!(store
            .get_ssh_host_trust("db.example.com", 22)
            .unwrap()
            .is_none());
        assert!(store
            .get_ssh_host_trust("other.example.com", 2222)
            .unwrap()
            .is_none());
    }

    #[test]
    fn remembering_a_trust_record_replaces_the_endpoint_row() {
        let store = fresh_store();
        store
            .remember_ssh_host_trust(&trust_record("db.example.com", 22, 1))
            .unwrap();
        store
            .remember_ssh_host_trust(&trust_record("db.example.com", 22, 2))
            .unwrap();

        let got = store
            .get_ssh_host_trust("db.example.com", 22)
            .unwrap()
            .unwrap();
        assert_eq!(got.fingerprint, "SHA256:seed-2");
        let rows: i64 = {
            let conn = store.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM ssh_host_trust", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(rows, 1, "one trust record per endpoint");
    }

    #[test]
    fn forgetting_a_trust_record_removes_it() {
        let store = fresh_store();
        store
            .remember_ssh_host_trust(&trust_record("db.example.com", 22, 1))
            .unwrap();
        store.forget_ssh_host_trust("db.example.com", 22).unwrap();
        assert!(store
            .get_ssh_host_trust("db.example.com", 22)
            .unwrap()
            .is_none());
    }

    #[test]
    fn ssh_host_trust_rows_carry_no_credentials() {
        let store = fresh_store();
        store
            .remember_ssh_host_trust(&trust_record("db.example.com", 22, 1))
            .unwrap();

        // Structural guarantee: the table has no credential columns at all.
        let columns: Vec<String> = {
            let conn = store.conn.lock().unwrap();
            let mut stmt = conn.prepare("PRAGMA table_info(ssh_host_trust)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert_eq!(
            columns,
            vec![
                "host".to_string(),
                "port".to_string(),
                "key_type".to_string(),
                "fingerprint".to_string(),
                "key_blob".to_string(),
                "enrolled_at".to_string(),
            ]
        );
    }
}
