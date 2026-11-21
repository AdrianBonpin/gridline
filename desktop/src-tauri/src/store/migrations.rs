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
const CONNECTION_COLUMNS_V3: &[(&str, &str)] = &[("environment", "TEXT")];

/// New columns added in version 7.
const CONNECTION_COLUMNS_V7: &[(&str, &str)] = &[("favorite", "INTEGER NOT NULL DEFAULT 0")];

/// Orphan cleanup (schema version 9). Written as idempotent deletes so a second
/// run removes nothing; saved-query cleanup runs last so a failing step proves
/// the transaction rolls back every earlier delete.
const ORPHAN_CLEANUP_SQL: &str = "
    DELETE FROM connection_tags
     WHERE NOT EXISTS (SELECT 1 FROM connections c WHERE c.id = connection_tags.connection_id)
        OR NOT EXISTS (SELECT 1 FROM tags t WHERE t.id = connection_tags.tag_id);
    DELETE FROM folder_tags
     WHERE NOT EXISTS (SELECT 1 FROM folders f WHERE f.id = folder_tags.folder_id)
        OR NOT EXISTS (SELECT 1 FROM tags t WHERE t.id = folder_tags.tag_id);
    DELETE FROM recent_connections
     WHERE NOT EXISTS (SELECT 1 FROM connections c WHERE c.id = recent_connections.connection_id);
    DELETE FROM query_history
     WHERE NOT EXISTS (SELECT 1 FROM connections c WHERE c.id = query_history.connection_id);
    DELETE FROM queries
     WHERE connection_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM connections c WHERE c.id = queries.connection_id);
";

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
        conn.execute("INSERT INTO schema_version (version) VALUES (2)", [])
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

        conn.execute("INSERT INTO schema_version (version) VALUES (3)", [])
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
            );",
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO schema_version (version) VALUES (4)", [])
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
                ON query_history(connection_id, executed_at DESC);",
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO schema_version (version) VALUES (5)", [])
            .map_err(|e| e.to_string())?;
    }

    // v6: query history favorites + saved queries
    if current_ver < 6 {
        conn.execute_batch(
            "ALTER TABLE query_history ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
            CREATE TABLE IF NOT EXISTS queries (
                id TEXT PRIMARY KEY,
                connection_id TEXT,
                name TEXT NOT NULL,
                query_text TEXT NOT NULL,
                folder TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_queries_connection ON queries(connection_id);
            CREATE INDEX IF NOT EXISTS idx_queries_folder ON queries(folder);",
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO schema_version (version) VALUES (6)", [])
            .map_err(|e| e.to_string())?;
    }

    // v7: connection favorites + recent_connections
    if current_ver < 7 {
        let existing: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(connections)")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (col_name, col_type) in CONNECTION_COLUMNS_V7 {
            if !existing.contains(&col_name.to_string()) {
                let sql = format!(
                    "ALTER TABLE connections ADD COLUMN {} {}",
                    col_name, col_type
                );
                conn.execute(&sql, []).map_err(|e| e.to_string())?;
            }
        }

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS recent_connections (
                connection_id TEXT PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
                opened_at TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO schema_version (version) VALUES (7)", [])
            .map_err(|e| e.to_string())?;
    }

    // v8: use_keychain opt-out flag on connections
    if current_ver < 8 {
        let existing: Vec<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(connections)")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        if !existing.iter().any(|c| c == "use_keychain") {
            conn.execute(
                "ALTER TABLE connections ADD COLUMN use_keychain INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(|e| e.to_string())?;
        }

        conn.execute("INSERT INTO schema_version (version) VALUES (8)", [])
            .map_err(|e| e.to_string())?;
    }

    // v9: transactional removal of orphaned Connection-owned Data and dangling
    // joins. Stores written before referential enforcement was guaranteed on
    // every connection can hold query history, recent records and
    // connection-specific saved queries whose connection is gone, plus tag and
    // folder joins pointing at rows that no longer exist. Global saved queries
    // (NULL connection_id) are not Connection-owned Data and are kept.
    if current_ver < 9 {
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(ORPHAN_CLEANUP_SQL)
            .map_err(|e| format!("local store cleanup failed: {e}"))?;
        tx.execute("INSERT INTO schema_version (version) VALUES (9)", [])
            .map_err(|e| e.to_string())?;
        // Committing records the migration; any earlier failure drops the
        // transaction and leaves the prior store unchanged.
        tx.commit()
            .map_err(|e| format!("local store cleanup failed: {e}"))?;
    }

    // v10: SSH host trust enrollments (ADR 0001). Non-secret metadata only:
    // endpoint, key identity and when the user accepted it.
    if current_ver < 10 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ssh_host_trust (
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                key_type TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                key_blob TEXT NOT NULL,
                enrolled_at TEXT NOT NULL,
                PRIMARY KEY (host, port)
            );",
        )
        .map_err(|e| e.to_string())?;

        conn.execute("INSERT INTO schema_version (version) VALUES (10)", [])
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

    /// A representative pre-fix store: the v8 schema plus rows written while
    /// referential enforcement was not guaranteed on every store connection, so
    /// Connection-owned Data can outlive its connection and joins can dangle.
    fn pre_fix_store_with_orphans() -> Connection {
        let conn = fresh_db();
        // Stop at the pre-fix schema and turn enforcement off, which is how a
        // store written by a build without per-connection enforcement looks.
        // Both the v9 cleanup and the v10 trust enrollment are later than that
        // build, so neither is recorded.
        conn.execute_batch(
            "DELETE FROM schema_version WHERE version >= 9;
             PRAGMA foreign_keys = OFF;",
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO folders (id, name, parent_id, created_at, updated_at)
                 VALUES ('f1', 'Work', NULL, 't', 't');
             INSERT INTO connections (id, name, db_type, host, port, folder_id, created_at, updated_at)
                 VALUES ('c1', 'Prod', 'postgresql', 'h', 5432, 'f1', 't', 't');
             INSERT INTO tags (id, name, color, created_at)
                 VALUES ('t1', 'env:prod', '#ef4444', 't');
             -- valid joins
             INSERT INTO connection_tags (connection_id, tag_id) VALUES ('c1', 't1');
             INSERT INTO folder_tags (folder_id, tag_id) VALUES ('f1', 't1');
             -- joins dangling on either side
             INSERT INTO connection_tags (connection_id, tag_id) VALUES ('c1', 'ghost-tag');
             INSERT INTO connection_tags (connection_id, tag_id) VALUES ('ghost-conn', 't1');
             INSERT INTO folder_tags (folder_id, tag_id) VALUES ('f1', 'ghost-tag');
             INSERT INTO folder_tags (folder_id, tag_id) VALUES ('ghost-folder', 't1');
             -- query history: reachable and unreachable
             INSERT INTO query_history (id, connection_id, query_text, status, executed_at)
                 VALUES ('h-valid', 'c1', 'SELECT 1', 'success', 't');
             INSERT INTO query_history (id, connection_id, query_text, status, executed_at)
                 VALUES ('h-orphan', 'ghost-conn', 'SELECT 2', 'success', 't');
             -- recent records: reachable and unreachable
             INSERT INTO recent_connections (connection_id, opened_at) VALUES ('c1', 't');
             INSERT INTO recent_connections (connection_id, opened_at) VALUES ('ghost-conn', 't');
             -- saved queries: connection-specific (reachable/unreachable) and global
             INSERT INTO queries (id, connection_id, name, query_text, folder)
                 VALUES ('q-valid', 'c1', 'valid', 'SELECT 1', '');
             INSERT INTO queries (id, connection_id, name, query_text, folder)
                 VALUES ('q-orphan', 'ghost-conn', 'orphan', 'SELECT 2', '');
             INSERT INTO queries (id, connection_id, name, query_text, folder)
                 VALUES ('q-global', NULL, 'global', 'SELECT 3', '');",
        )
        .unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn v9_removes_orphaned_connection_owned_data_and_dangling_joins() {
        let conn = pre_fix_store_with_orphans();
        run_migrations(&conn).unwrap();

        // Reachable Connection-owned Data survives.
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM query_history WHERE id = 'h-valid'"
            ),
            1
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM recent_connections WHERE connection_id = 'c1'"
            ),
            1
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM queries WHERE id = 'q-valid'"),
            1
        );

        // Unreachable Connection-owned Data is removed.
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM query_history WHERE connection_id = 'ghost-conn'"
            ),
            0,
            "query history for a missing connection must be removed"
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM recent_connections WHERE connection_id = 'ghost-conn'"
            ),
            0,
            "recent records for a missing connection must be removed"
        );
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM queries WHERE id = 'q-orphan'"),
            0,
            "connection-specific saved queries for a missing connection must be removed"
        );

        // Global saved queries are not Connection-owned Data.
        assert_eq!(
            count(&conn, "SELECT COUNT(*) FROM queries WHERE id = 'q-global'"),
            1,
            "global saved queries must survive"
        );

        // Dangling joins are removed on either side; valid joins stay.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM connection_tags"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM folder_tags"), 1);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM connection_tags WHERE connection_id = 'c1' AND tag_id = 't1'"
            ),
            1
        );
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM folder_tags WHERE folder_id = 'f1' AND tag_id = 't1'"
            ),
            1
        );
    }

    #[test]
    fn v9_cleanup_is_idempotent() {
        let conn = pre_fix_store_with_orphans();
        run_migrations(&conn).unwrap();
        // A second full run must not error, must not touch the surviving rows and
        // must not record the version twice.
        run_migrations(&conn).unwrap();
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM schema_version WHERE version = 9"
            ),
            1
        );
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM query_history"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM recent_connections"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM queries"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM connection_tags"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM folder_tags"), 1);
    }

    #[test]
    fn v9_cleanup_failure_rolls_back_and_leaves_the_store_unchanged() {
        let conn = pre_fix_store_with_orphans();
        // Simulate a failing cleanup step late in the transaction (saved queries
        // are cleaned last), so every earlier delete must be rolled back too.
        conn.execute_batch(
            "CREATE TRIGGER fail_queries_cleanup BEFORE DELETE ON queries
             BEGIN SELECT RAISE(ABORT, 'simulated cleanup failure'); END;",
        )
        .unwrap();

        let err = run_migrations(&conn).expect_err("a failing cleanup must be reported");
        assert!(
            err.contains("simulated cleanup failure"),
            "failure must be reported visibly, got: {err}"
        );

        // Prior store content is untouched, including rows an earlier step had
        // already deleted inside the aborted transaction.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM query_history"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM recent_connections"), 2);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM queries"), 3);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM connection_tags"), 3);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM folder_tags"), 3);
        assert_eq!(
            count(
                &conn,
                "SELECT COUNT(*) FROM schema_version WHERE version = 9"
            ),
            0,
            "an aborted cleanup must not record its schema version"
        );

        // Once the cause is removed the same store migrates normally.
        conn.execute_batch("DROP TRIGGER fail_queries_cleanup;")
            .unwrap();
        run_migrations(&conn).unwrap();
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM query_history"), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM queries"), 2);
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
        assert_eq!(
            count, 9,
            "versions 2..=10 are recorded exactly once each"
        );
    }

    #[test]
    fn migration_v8_adds_use_keychain_column_default_1() {
        let conn = Connection::open_in_memory().unwrap();
        // v7 baseline
        run_migrations(&conn).unwrap();
        // simulate an existing connection row (pre-v8 shape had no use_keychain)
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, username, database, folder_id, keychain_ref, ssh_host, ssh_port, ssh_user, ssh_auth_method, ssh_private_key_path, ssl_mode, ssl_ca_path, ssl_cert_path, ssl_key_path, environment, created_at, updated_at) VALUES ('c1','n','postgresql','h',5432,'u','d',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'t','t','t')",
            [],
        )
        .unwrap();
        run_migrations(&conn).unwrap();
        let uses: i64 = conn
            .query_row(
                "SELECT use_keychain FROM connections WHERE id='c1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            uses, 1,
            "existing connections default to use_keychain=1 (ON)"
        );
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version=8",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "schema_version row 8 inserted exactly once");
    }

    #[test]
    fn migration_v8_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();
        let v8: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version=8",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v8, 1);
        // PRAGMA confirms exactly one use_keychain column
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(connections)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(cols.iter().filter(|c| c == &"use_keychain").count(), 1);
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
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
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
        conn.execute(
            "DELETE FROM connections WHERE id = ?1",
            rusqlite::params![conn_id],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM query_history WHERE connection_id = ?1",
                rusqlite::params![conn_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn v6_adds_favorite_column_to_query_history() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Verify the favorite column exists via PRAGMA
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(query_history)").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert!(
            columns.contains(&"favorite".to_string()),
            "Expected query_history to have a 'favorite' column after v6 migration"
        );
        // Existing rows default to 0
        let fav: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM query_history WHERE favorite != 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fav, 0);
    }

    #[test]
    fn v6_creates_queries_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Table exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM queries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
        // Column check
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(queries)").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        for c in &[
            "id",
            "connection_id",
            "name",
            "query_text",
            "folder",
            "created_at",
            "updated_at",
        ] {
            assert!(
                columns.contains(&c.to_string()),
                "Expected queries table to have column: {}",
                c
            );
        }
    }

    #[test]
    fn v6_queries_cascade_on_connection_delete() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        // Insert a connection
        let conn_id = "test-qc-conn";
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at) VALUES (?1, 't', 'postgresql', 'h', 5432, datetime('now'), datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        // Insert a saved query for that connection
        conn.execute(
            "INSERT INTO queries (id, connection_id, name, query_text, folder) VALUES ('q1', ?1, 'my query', 'SELECT 1', '')",
            rusqlite::params![conn_id],
        ).unwrap();
        // Insert a global saved query (connection_id NULL)
        conn.execute(
            "INSERT INTO queries (id, connection_id, name, query_text, folder) VALUES ('q2', NULL, 'global query', 'SELECT 2', '')",
            [],
        ).unwrap();
        // Delete connection — should cascade the non-NULL row
        conn.execute(
            "DELETE FROM connections WHERE id = ?1",
            rusqlite::params![conn_id],
        )
        .unwrap();
        let count_scoped: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM queries WHERE connection_id = ?1",
                rusqlite::params![conn_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count_scoped, 0,
            "Scoped saved query should be cascade-deleted"
        );
        // NULL-saved query survives
        let count_global: i64 = conn
            .query_row("SELECT COUNT(*) FROM queries WHERE id = 'q2'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            count_global, 1,
            "Global saved query (connection_id NULL) should survive"
        );
    }

    #[test]
    fn v6_bumps_schema_version_to_6() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version = 6",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 1,
            "Schema version 6 should be recorded after v6 migration"
        );
    }

    #[test]
    fn v7_adds_favorite_column_to_connections() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let columns: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(connections)").unwrap();
            let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
            rows.filter_map(|r| r.ok()).collect()
        };
        assert!(
            columns.contains(&"favorite".to_string()),
            "Expected connections to have a 'favorite' column after v7"
        );
        let conn_id = "fav-test";
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at) VALUES (?1, 't', 'postgresql', 'h', 5432, datetime('now'), datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        let fav: i64 = conn
            .query_row(
                "SELECT favorite FROM connections WHERE id = ?1",
                rusqlite::params![conn_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(fav, 0, "favorite defaults to 0");
    }

    #[test]
    fn v7_creates_recent_connections_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_connections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn v7_recent_connections_cascade_on_connection_delete() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let conn_id = "rc-cascade";
        conn.execute(
            "INSERT INTO connections (id, name, db_type, host, port, created_at, updated_at) VALUES (?1, 't', 'postgresql', 'h', 5432, datetime('now'), datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        conn.execute(
            "INSERT INTO recent_connections (connection_id, opened_at) VALUES (?1, datetime('now'))",
            rusqlite::params![conn_id],
        ).unwrap();
        conn.execute(
            "DELETE FROM connections WHERE id = ?1",
            rusqlite::params![conn_id],
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM recent_connections WHERE connection_id = ?1",
                rusqlite::params![conn_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn schema_version_bumps_to_latest() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 10);
    }

    #[test]
    fn migration_v10_creates_the_ssh_host_trust_table() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let ver: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ver, 10);
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(ssh_host_trust)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(
            columns,
            vec![
                "host".to_string(),
                "port".to_string(),
                "key_type".to_string(),
                "fingerprint".to_string(),
                "key_blob".to_string(),
                "enrolled_at".to_string(),
            ],
            "trust metadata only, keyed by endpoint"
        );
    }

    #[test]
    fn v10_host_trust_applies_on_top_of_a_v9_store() {
        // A store written by the v9 (orphan-cleanup) code must gain the trust
        // table without losing the earlier migration.
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        conn.execute("DELETE FROM schema_version WHERE version = 10", [])
            .unwrap();
        conn.execute("DROP TABLE ssh_host_trust", []).unwrap();
        run_migrations(&conn).unwrap();
        let v9: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version = 9",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v9, 1, "the v9 cleanup stays recorded");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        let trust: i64 = conn
            .query_row("SELECT COUNT(*) FROM ssh_host_trust", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 9);
        assert_eq!(trust, 0);
    }
}
