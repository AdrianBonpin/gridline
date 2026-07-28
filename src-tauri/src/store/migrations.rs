use rusqlite::Connection;

/// All new-column additions for the connections table since version 1.
const CONNECTION_COLUMNS_V2: &[(&str, &str)] = &[
    ("database", "TEXT"),
    ("ssh_host", "TEXT"),
    ("ssh_port", "INTEGER"),
    ("ssh_user", "TEXT"),
    ("ssh_auth_method", "TEXT"),
    ("ssh_private_key_path", "TEXT"),
    ("ssl_mode", "TEXT"),
    ("ssl_ca_path", "TEXT"),
    ("ssl_cert_path", "TEXT"),
    ("ssl_key_path", "TEXT"),
];

/// New columns added since version 2.
const CONNECTION_COLUMNS_V3: &[(&str, &str)] = &[
    ("environment", "TEXT"),
];

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
             database TEXT,
             folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
             keychain_ref TEXT,
             ssh_host TEXT,
             ssh_port INTEGER,
             ssh_user TEXT,
             ssh_auth_method TEXT,
             ssh_private_key_path TEXT,
             ssl_mode TEXT,
             ssl_ca_path TEXT,
             ssl_cert_path TEXT,
             ssl_key_path TEXT,
             environment TEXT,
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

    // --- Version-specific migrations ----------------------------------------

    let current_ver: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if current_ver < 2 {
        // Discover which columns the connections table already has.
        let existing: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(connections)")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (col_name, col_type) in CONNECTION_COLUMNS_V2 {
            if !existing.contains(&col_name.to_string()) {
                let sql = format!(
                    "ALTER TABLE connections ADD COLUMN {} {}",
                    col_name, col_type
                );
                conn.execute(&sql, []).map_err(|e| e.to_string())?;
            }
        }

        // Record the migration.
        conn.execute(
            "INSERT INTO schema_version (version) VALUES (2)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    if current_ver < 3 {
        let existing: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(connections)")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (col_name, col_type) in CONNECTION_COLUMNS_V3 {
            if !existing.contains(&col_name.to_string()) {
                let sql = format!(
                    "ALTER TABLE connections ADD COLUMN {} {}",
                    col_name, col_type
                );
                conn.execute(&sql, []).map_err(|e| e.to_string())?;
            }
        }

        conn.execute(
            "INSERT INTO schema_version (version) VALUES (3)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

    // v4: backup_history
    if current_ver < 4 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS backup_history (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('dump', 'restore', 'sync')),
                format TEXT,
                file_path TEXT,
                source_connection_id TEXT,
                status TEXT NOT NULL DEFAULT 'running'
                    CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
                error_message TEXT,
                size_bytes INTEGER,
                started_at TEXT NOT NULL,
                completed_at TEXT
            );"
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO schema_version (version) VALUES (4)",
            [],
        )
        .map_err(|e| e.to_string())?;
    }

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
    fn v4_creates_backup_history_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM backup_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migrations_are_idempotent() {
        let conn = fresh_db();
        // Running again must not error
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }
}