use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
         CREATE TABLE IF NOT EXISTS folders (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             parent_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS connections (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             db_type TEXT NOT NULL,
             host TEXT NOT NULL,
             port INTEGER,
             username TEXT,
             folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
             keychain_ref TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tags (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL UNIQUE,
             color TEXT NOT NULL DEFAULT '#8b5cf6',
             created_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS connection_tags (
             connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
             tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
             PRIMARY KEY (connection_id, tag_id)
         );
         CREATE TABLE IF NOT EXISTS folder_tags (
             folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
             tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
             PRIMARY KEY (folder_id, tag_id)
         );
         CREATE TABLE IF NOT EXISTS settings (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO schema_version (version) VALUES (1)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn migrations_create_all_tables() {
        let conn = fresh_db();
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tables.contains(&"folders".to_string()));
        assert!(tables.contains(&"connections".to_string()));
        assert!(tables.contains(&"tags".to_string()));
        assert!(tables.contains(&"connection_tags".to_string()));
        assert!(tables.contains(&"settings".to_string()));
        assert!(tables.contains(&"schema_version".to_string()));
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = fresh_db();
        // Running again must not error
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }
}