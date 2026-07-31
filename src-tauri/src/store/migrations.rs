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

    // v5: query_history
    if current_ver < 5 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS query_history (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                query_text TEXT NOT NULL,
                execution_time_ms INTEGER,
                row_count INTEGER,
                status TEXT NOT NULL CHECK(status IN ('success', 'error')),
                error_message TEXT,
                executed_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_query_history_connection
                ON query_history(connection_id, executed_at DESC);"
        ).map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO schema_version (version) VALUES (5)",
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
        assert_eq!(count, 4);
    }

    #[test]
    fn v5_creates_query_history_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Verify the table exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM query_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        // Verify columns via PRAGMA
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(query_history)").unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert!(columns.contains(&"id".to_string()));
        assert!(columns.contains(&"connection_id".to_string()));
        assert!(columns.contains(&"query_text".to_string()));
        assert!(columns.contains(&"execution_time_ms".to_string()));
        assert!(columns.contains(&"row_count".to_string()));
        assert!(columns.contains(&"status".to_string()));
        assert!(columns.contains(&"error_message".to_string()));
        assert!(columns.contains(&"executed_at".to_string()));
    }

    #[test]
    fn query_history_cascades_on_connection_delete() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Insert a connection
        let conn_id = "test-conn-id";
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at) VALUES (?1, 't', 'postgresql', 'h', 5432, datetime('now'), datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        // Insert query history entry
        conn.execute(
            "INSERT INTO query_history (id, connection_id, query_text, status, executed_at) VALUES ('qh1', ?1, 'SELECT 1', 'success', datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        // Delete connection — should cascade
        conn.execute("DELETE FROM connections WHERE id = ?1", rusqlite::params![conn_id]).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM query_history WHERE connection_id = ?1", rusqlite::params![conn_id], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}