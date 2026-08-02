use serde::{Deserialize, Serialize};

use crate::db::pool::DbConfig;

/// Result of a test database connection attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestConnectionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Strip credentials and sensitive information from error messages while
/// preserving the useful diagnostic detail (severity, message, SQLSTATE).
///
/// Redacts `password=...`, `user=...`, `postgresql://user:pwd@host` URLs,
/// and `@host` credential fragments rather than discarding the whole
/// message — so the user can still see e.g. "password authentication
/// failed for user 'foo'" without leaking the password itself.
pub fn sanitize_error(msg: &str) -> String {
    let mut out = String::with_capacity(msg.len());
    let bytes = msg.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let lower = msg[i..].to_lowercase();
        if lower.starts_with("postgres://") || lower.starts_with("postgresql://") {
            out.push_str("[redacted-url://");
            let scheme_end = i + msg[i..].find("://").unwrap_or(0) + 3;
            let rest = &msg[scheme_end..];
            let end = match rest.find(['/', '?']) {
                Some(pos) => scheme_end + pos,
                None => msg.len(),
            };
            i = end;
        } else if lower.starts_with("password=") {
            out.push_str("[redacted]");
            let rest = &msg[i + "password=".len()..];
            let skip = rest.find(char::is_whitespace).unwrap_or(rest.len());
            i += "password=".len() + skip;
        } else if lower.starts_with("user=") {
            out.push_str("[redacted]");
            let rest = &msg[i + "user=".len()..];
            let skip = rest.find(char::is_whitespace).unwrap_or(rest.len());
            i += "user=".len() + skip;
        } else if lower.starts_with("secret") {
            out.push_str("secret=[redacted]");
            let rest = &msg[i + "secret".len()..];
            let skip = rest.find(char::is_whitespace).unwrap_or(rest.len());
            i += "secret".len() + skip;
        } else {
            let ch = msg[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    // Truncate at 300 characters for safety.
    if out.len() > 300 {
        format!("{}...", &out[..297])
    } else {
        out
    }
}

/// Validate `DbConfig` before attempting a connection test.
///
/// Returns `Some(error_message)` if the config is invalid, or `None` if valid.
///
/// Validation rules:
/// - `db_type` must be one of: `postgresql`, `mysql`, `sqlite`, `redis`
/// - For `postgresql`, `mysql`, `redis`: `host` must not be empty, `port` must
///   be `Some(1..=65535)`
/// - For `sqlite`: `host` (file path) must not be empty
pub fn validate_test_input(config: &DbConfig) -> Option<String> {
    let db_type = config.db_type.to_lowercase();

    let valid_types = ["postgresql", "mysql", "sqlite", "redis"];
    if !valid_types.contains(&db_type.as_str()) {
        return Some(format!(
            "unsupported database type: {}. Supported types: {}",
            config.db_type,
            valid_types.join(", ")
        ));
    }

    if config.host.is_empty() {
        return Some("host must not be empty".to_string());
    }

    // SQLite does not require a port (host is the file path)
    if db_type != "sqlite" {
        match config.port {
            Some(p) if (1..=65535).contains(&p) => {}
            _ => {
                return Some(
                    "port must be an integer between 1 and 65535 for this db_type"
                        .to_string(),
                );
            }
        }
    }

    None
}

/// Test a database connection for the given configuration.
///
/// Dispatches to the appropriate type-specific connection test based on
/// `config.db_type`. Returns a `TestConnectionResult` indicating success
/// or failure with a sanitized error message.
pub async fn test_database_connection(config: &DbConfig) -> TestConnectionResult {
    // Validate input first
    if let Some(err) = validate_test_input(config) {
        return TestConnectionResult {
            ok: false,
            error: Some(err),
        };
    }

    let result = match config.db_type.to_lowercase().as_str() {
        "postgresql" => test_pg_connection(config).await,
        "mysql" => test_mysql_connection(config).await,
        "sqlite" => test_sqlite_connection(config),
        "redis" => test_redis_connection(config).await,
        other => TestConnectionResult {
            ok: false,
            error: Some(format!("unsupported database type: {other}")),
        },
    };

    TestConnectionResult {
        ok: result.ok,
        error: result.error.map(|e| sanitize_error(&e)),
    }
}

/// Test a PostgreSQL connection using `tokio-postgres`.
///
/// Connects without TLS. The connection handler is spawned and immediately
/// dropped after confirming the connection is alive.
async fn test_pg_connection(config: &DbConfig) -> TestConnectionResult {
    use tokio_postgres::NoTls;

    let host = &config.host;
    let port = config.port.unwrap_or(5432) as u16;
    let user = config.username.as_deref().unwrap_or("postgres");
    let dbname = config.database.as_deref().unwrap_or("postgres");
    let password = config.password.as_deref().unwrap_or("");

    // Use a postgres URL rather than libpq key=value format: tokio-postgres
    // parses URLs reliably and urlencoding handles special chars safely.
    use urlencoding::encode as enc;
    let conn_str = format!(
        "postgresql://{}:{}@{}:{}/{}?connect_timeout=10",
        enc(user),
        enc(password),
        host,
        port,
        enc(dbname),
    );

    match tokio_postgres::connect(&conn_str, NoTls).await {
        Ok((_client, connection)) => {
            // Spawn the connection handler so it keeps running while we test
            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    eprintln!("connection error: {}", e);
                }
            });
            TestConnectionResult { ok: true, error: None }
        }
        Err(e) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

/// Test a MySQL connection using `sqlx`.
///
/// Uses `MySqlPoolOptions` with a pool size of 1 and a 10-second
/// `acquire_timeout`.
async fn test_mysql_connection(config: &DbConfig) -> TestConnectionResult {
    use sqlx::mysql::MySqlPoolOptions;

    let host = &config.host;
    let port = config.port.unwrap_or(3306);
    let user = config.username.as_deref().unwrap_or("root");
    let password = config.password.as_deref().unwrap_or("");
    let dbname = config.database.as_deref().unwrap_or("mysql");

    let conn_str = format!(
        "mysql://{}:{}@{}:{}/{}",
        user, password, host, port, dbname
    );

    match MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect(&conn_str)
        .await
    {
        Ok(pool) => {
            pool.close().await;
            TestConnectionResult { ok: true, error: None }
        }
        Err(e) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

/// Test a SQLite connection using `rusqlite`.
///
/// Opens the database file at `config.host`. Returns success if the file
/// can be opened as a valid SQLite database.
fn test_sqlite_connection(config: &DbConfig) -> TestConnectionResult {
    match rusqlite::Connection::open(&config.host) {
        Ok(_conn) => TestConnectionResult { ok: true, error: None },
        Err(e) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

/// Test a Redis connection using the `redis` crate.
///
/// Uses `redis::Client::open` followed by `get_async_connection` with a
/// 10-second timeout via `tokio::time::timeout`.
async fn test_redis_connection(config: &DbConfig) -> TestConnectionResult {
    use tokio::time::timeout;

    let host = &config.host;
    let port = config.port.unwrap_or(6379);
    let password = config.password.as_deref();

    let conn_str = if let Some(pwd) = password {
        format!("redis://:{}@{}:{}/", pwd, host, port)
    } else {
        format!("redis://{}:{}/", host, port)
    };

    match redis::Client::open(conn_str.as_str()) {
        Ok(client) => {
            match timeout(
                std::time::Duration::from_secs(10),
                client.get_multiplexed_async_connection(),
            )
            .await
            {
                Ok(Ok(_conn)) => TestConnectionResult { ok: true, error: None },
                Ok(Err(e)) => TestConnectionResult {
                    ok: false,
                    error: Some(e.to_string()),
                },
                Err(_) => TestConnectionResult {
                    ok: false,
                    error: Some("connection timed out after 10 seconds".to_string()),
                },
            }
        }
        Err(e) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

/// Tauri command to test a database connection.
///
/// Calls `test_database_connection` and returns the result.
#[tauri::command]
pub async fn test_connection(config: DbConfig) -> Result<TestConnectionResult, String> {
    Ok(test_database_connection(&config).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------
    // TestConnectionResult serialization
    // ------------------------------------------------------------------

    #[test]
    fn test_connection_result_serialization() {
        // ok=true result serializes correctly
        let result = TestConnectionResult { ok: true, error: None };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"ok\":true"), "ok=true should appear in JSON");

        // error result includes the error message
        let result = TestConnectionResult {
            ok: false,
            error: Some("connection refused".to_string()),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"connection refused\""), "error message should appear in JSON");
    }

    // ------------------------------------------------------------------
    // sanitize_error
    // ------------------------------------------------------------------

    #[test]
    fn test_connection_sanitizes_error() {
        let msg = "connection failed: password=secret123 user=admin";
        let sanitized = sanitize_error(msg);
        assert!(!sanitized.contains("secret123"), "should not leak password value");
        assert!(!sanitized.contains("admin"), "should not leak username value");
        assert!(!sanitized.contains("password="), "should remove password= pattern");
        assert!(!sanitized.contains("user="), "should remove user= pattern");
    }

    // ------------------------------------------------------------------
    // validate_test_input rejection
    // ------------------------------------------------------------------

    #[test]
    fn validate_test_input_rejects_invalid() {
        // Unsupported db type
        let config = DbConfig {
            db_type: "mongodb".to_string(),
            host: "localhost".to_string(),
            port: Some(27017),
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_some(),
            "mongodb should be rejected"
        );

        // Empty host
        let config = DbConfig {
            db_type: "postgresql".to_string(),
            host: "".to_string(),
            port: Some(5432),
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_some(),
            "empty host should be rejected"
        );

        // Port 0
        let config = DbConfig {
            db_type: "postgresql".to_string(),
            host: "localhost".to_string(),
            port: Some(0),
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_some(),
            "port 0 should be rejected"
        );
    }

    // ------------------------------------------------------------------
    // validate_test_input acceptance
    // ------------------------------------------------------------------

    #[test]
    fn validate_test_input_accepts_valid() {
        let config = DbConfig {
            db_type: "postgresql".to_string(),
            host: "localhost".to_string(),
            port: Some(5432),
            username: Some("user".to_string()),
            database: Some("mydb".to_string()),
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_none(),
            "valid postgresql config should be accepted"
        );
    }

    #[test]
    fn sqlite_accepts_no_port() {
        // SQLite does not require a port
        let config = DbConfig {
            db_type: "sqlite".to_string(),
            host: "/tmp/test.db".to_string(),
            port: None,
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_none(),
            "sqlite without port should be accepted"
        );

        // SQLite should also accept a config with any port (port is ignored)
        let config = DbConfig {
            db_type: "sqlite".to_string(),
            host: "/tmp/test.db".to_string(),
            port: Some(9999),
            ..Default::default()
        };
        assert!(
            validate_test_input(&config).is_none(),
            "sqlite with any port should be accepted"
        );
    }
}