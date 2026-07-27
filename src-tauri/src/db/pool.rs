use std::time::Instant;

/// Configuration for establishing a database connection.
///
/// Fields map to connection parameters. For SQLite, `host` stores the
/// file path and `port` is always `None`.
#[derive(Debug, Clone)]
pub struct DbConfig {
    pub db_type: String,
    pub host: String,
    pub port: Option<i64>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,
}

impl DbConfig {
    /// Create a `DbConfig` for a SQLite database at `path`.
    ///
    /// `host` is set to the file path; all other optional fields are `None`.
    pub fn sqlite(path: &str) -> Self {
        Self {
            db_type: "SQLite".into(),
            host: path.into(),
            port: None,
            username: None,
            password: None,
            database: None,
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
        }
    }
}

/// A handle to an active database connection.
///
/// Currently only `Sqlite` is supported. Variants for PostgreSQL, MySQL,
/// and Redis will be added in later tasks.
#[derive(Debug)]
pub enum DbHandle {
    /// A synchronous SQLite connection via `rusqlite`.
    Sqlite(rusqlite::Connection),
}

/// Internal entry stored in the pool manager.
///
/// Tracks the database handle and the last time it was accessed for LRU
/// eviction.
#[derive(Debug)]
pub(crate) struct DbPoolEntry {
    pub(crate) handle: DbHandle,
    pub(crate) last_accessed: Instant,
}

/// A connection pool manager with LRU eviction.
///
/// Manages a set of active database handles keyed by a user-defined
/// identifier. When the number of registered pools exceeds `max_pools`,
/// the least-recently-used entry (i.e. the pool whose handle was accessed
/// furthest in the past) is evicted.
///
/// Default `max_pools` is 5.
pub struct ConnectionPoolManager {
    pools: indexmap::IndexMap<String, DbPoolEntry>,
    max_pools: usize,
}

impl ConnectionPoolManager {
    /// Create a new manager with a maximum of 5 pools.
    pub fn new() -> Self {
        Self {
            pools: indexmap::IndexMap::new(),
            max_pools: 5,
        }
    }

    /// Set the maximum number of pools before LRU eviction kicks in.
    ///
    /// If the current pool count exceeds the new maximum, the oldest
    /// entries are evicted immediately.
    pub fn set_max_pools(&mut self, max: usize) {
        self.max_pools = max;
        while self.pools.len() > self.max_pools {
            self.pools.shift_remove_index(0);
        }
    }

    /// Register a new database handle under `id`.
    ///
    /// * If `id` already exists the old entry is removed first.
    /// * The new entry is inserted as the most-recently-used.
    /// * If the total pool count exceeds `max_pools` the least-recently-used
    ///   (oldest) entry is evicted.
    pub fn register(&mut self, id: &str, handle: DbHandle) {
        // Remove existing entry if present
        self.pools.shift_remove(id);

        let entry = DbPoolEntry {
            handle,
            last_accessed: Instant::now(),
        };
        self.pools.insert(id.to_string(), entry);

        // LRU eviction: remove oldest (front) entries until within capacity
        while self.pools.len() > self.max_pools {
            self.pools.shift_remove_index(0);
        }
    }

    /// Get a mutable reference to the handle for `id`, or `None`.
    ///
    /// Updates the last-accessed timestamp and re-orders the entry to
    /// mark it as most-recently-used.
    pub fn get(&mut self, id: &str) -> Option<&mut DbHandle> {
        if let Some((key, mut entry)) = self.pools.shift_remove_entry(id) {
            entry.last_accessed = Instant::now();
            self.pools.insert(key, entry);
            // The newly inserted entry is at the end (MRU position)
            self.pools.last_mut().map(|(_, e)| &mut e.handle)
        } else {
            None
        }
    }

    /// Remove the pool with `id` from the manager.
    pub fn remove(&mut self, id: &str) {
        self.pools.shift_remove(id);
    }

    /// Return a reference to the underlying pool map.
    pub(crate) fn pools(&self) -> &indexmap::IndexMap<String, DbPoolEntry> {
        &self.pools
    }

    /// Return `true` if a pool with `id` is registered.
    pub fn contains(&self, id: &str) -> bool {
        self.pools.contains_key(id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // DbConfig tests
    // ------------------------------------------------------------------

    #[test]
    fn create_pg_pool_with_minimal_config() {
        let cfg = DbConfig {
            db_type: "PostgreSQL".into(),
            host: "pg.example.com".into(),
            port: Some(5432),
            username: Some("admin".into()),
            password: Some("secret".into()),
            database: Some("mydb".into()),
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
        };

        assert_eq!(cfg.db_type, "PostgreSQL");
        assert_eq!(cfg.host, "pg.example.com");
        assert_eq!(cfg.port, Some(5432));
        assert_eq!(cfg.username.as_deref(), Some("admin"));
        assert_eq!(cfg.password.as_deref(), Some("secret"));
        assert_eq!(cfg.database.as_deref(), Some("mydb"));
        assert!(cfg.ssl_mode.is_none());
    }

    #[test]
    fn db_config_for_sqlite_has_no_port() {
        let cfg = DbConfig::sqlite("/tmp/test.db");

        assert_eq!(cfg.db_type, "SQLite");
        assert_eq!(cfg.host, "/tmp/test.db");
        assert!(cfg.port.is_none());
        assert!(cfg.username.is_none());
        assert!(cfg.database.is_none());
    }

    // ------------------------------------------------------------------
    // ConnectionPoolManager tests
    // ------------------------------------------------------------------

    #[test]
    fn pool_manager_starts_empty() {
        let manager = ConnectionPoolManager::new();
        assert_eq!(manager.pools().len(), 0);
    }

    #[test]
    fn pool_manager_register_and_evict() {
        let mut manager = ConnectionPoolManager::new();
        manager.set_max_pools(2);

        let conn_a = rusqlite::Connection::open_in_memory().unwrap();
        let conn_b = rusqlite::Connection::open_in_memory().unwrap();
        let conn_c = rusqlite::Connection::open_in_memory().unwrap();

        // Register A, B, then C with max=2 -- A should be evicted (LRU)
        manager.register("a", DbHandle::Sqlite(conn_a));
        manager.register("b", DbHandle::Sqlite(conn_b));
        manager.register("c", DbHandle::Sqlite(conn_c));

        assert_eq!(manager.pools().len(), 2);
        assert!(!manager.contains("a"), "'a' should have been evicted (LRU)");
        assert!(manager.contains("b"));
        assert!(manager.contains("c"));
    }

    #[test]
    fn pool_manager_remove_closes_pool() {
        let mut manager = ConnectionPoolManager::new();

        let conn = rusqlite::Connection::open_in_memory().unwrap();
        manager.register("tmp", DbHandle::Sqlite(conn));
        assert!(manager.contains("tmp"));

        manager.remove("tmp");
        assert!(!manager.contains("tmp"));
        assert_eq!(manager.pools().len(), 0);
    }

    #[test]
    fn pool_manager_get_updates_access_time() {
        let mut manager = ConnectionPoolManager::new();
        manager.set_max_pools(3);

        let conn_a = rusqlite::Connection::open_in_memory().unwrap();
        let conn_b = rusqlite::Connection::open_in_memory().unwrap();
        let conn_c = rusqlite::Connection::open_in_memory().unwrap();

        manager.register("a", DbHandle::Sqlite(conn_a));
        manager.register("b", DbHandle::Sqlite(conn_b));
        manager.register("c", DbHandle::Sqlite(conn_c));

        // Access "a" -- makes it MRU
        let _handle = manager.get("a").unwrap();

        // Register "d" with max=3 -- "b" (now LRU) should be evicted, not "a"
        let conn_d = rusqlite::Connection::open_in_memory().unwrap();
        manager.register("d", DbHandle::Sqlite(conn_d));

        assert_eq!(manager.pools().len(), 3);
        assert!(manager.contains("a"), "'a' was recently accessed, should survive");
        assert!(!manager.contains("b"), "'b' is LRU and should be evicted");
        assert!(manager.contains("c"));
        assert!(manager.contains("d"));
    }
}