use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::ssh::SshTunnelManager;
use crate::db::pool::DbConfig;

/// The SSH tunnel manager behind a mutex (as stored in `AppState`).
type SshManager = std::sync::Mutex<SshTunnelManager>;

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
        if let Some(scheme_end) = url_scheme_end(msg, i) {
            out.push_str("[redacted-url://");
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

/// If `msg[i..]` begins a `scheme://authority` URL — a 1-16 char scheme of
/// alphanumerics/`+`/`-`/`.` preceded by a non-word boundary — return the byte
/// index just past the `://`. This redacts embedded credentials for any scheme
/// (`postgres://`, `redis://`, `mysql://`, ...) without matching non-URL text.
fn url_scheme_end(msg: &str, i: usize) -> Option<usize> {
    let rest = &msg[i..];
    let colon = rest.find("://")?;
    if colon == 0 || colon > 16 {
        return None;
    }
    let scheme = &rest[..colon];
    if !scheme
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    {
        return None;
    }
    // Require a boundary before the scheme so mid-word text is not a URL.
    if let Some(c) = msg[..i].chars().next_back() {
        if c.is_ascii_alphanumeric() || c == '_' {
            return None;
        }
    }
    Some(i + colon + 3)
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

/// Effective connect target after optional SSH tunnel resolution.
struct ConnectTarget {
    host: String,
    port: u16,
    via_tunnel: bool,
    /// Key of the opened tunnel, if any — must be closed after the probe.
    tunnel_key: Option<String>,
}

/// Open an SSH tunnel if `config` has one configured, returning the loopback
/// target to connect through. The blocking ssh2 handshake runs in
/// `spawn_blocking` so it never blocks the async runtime.
///
/// The caller must close the tunnel (via `tunnel_key`) after the probe, on
/// every path.
async fn resolve_connect_target(
    config: &DbConfig,
    ssh: &SshManager,
    default_port: u16,
) -> Result<ConnectTarget, String> {
    match config.ssh_config() {
        Some(ssh_cfg) => {
            let key = format!("test-{}", uuid::Uuid::new_v4());
            let open_key = key.clone();
            let remote_host = config.host.clone();
            let remote_port = config.port.unwrap_or(default_port as i64) as u16;
            let pw = config.ssh_password.clone();
            let pp = config.ssh_passphrase.clone();
            let backend = ssh.lock().unwrap().backend_clone();
            let tunnel = tokio::task::spawn_blocking(move || {
                backend.open(
                    &open_key,
                    &ssh_cfg,
                    &remote_host,
                    remote_port,
                    pw.as_deref(),
                    pp.as_deref(),
                )
            })
            .await
            .map_err(|e| e.to_string())??;
            let lp = tunnel.local_port;
            ssh.lock().unwrap().insert_tunnel(key.clone(), tunnel);
            Ok(ConnectTarget {
                host: "127.0.0.1".to_string(),
                port: lp,
                via_tunnel: true,
                tunnel_key: Some(key),
            })
        }
        None => Ok(ConnectTarget {
            host: config.host.clone(),
            port: config.port.unwrap_or(default_port as i64) as u16,
            via_tunnel: false,
            tunnel_key: None,
        }),
    }
}

/// Close the probe tunnel if one was opened.
fn close_probe_tunnel(ssh: &SshManager, key: Option<&str>) {
    if let Some(k) = key {
        ssh.lock().unwrap().close_tunnel(k);
    }
}

/// Test a database connection for the given configuration.
///
/// Dispatches to the appropriate type-specific connection test based on
/// `config.db_type`. Returns a `TestConnectionResult` indicating success
/// or failure with a sanitized error message.
pub async fn test_database_connection(
    config: &DbConfig,
    ssh: &SshManager,
) -> TestConnectionResult {
    // Validate input first
    if let Some(err) = validate_test_input(config) {
        return TestConnectionResult {
            ok: false,
            error: Some(err),
        };
    }

    let result = match config.db_type.to_lowercase().as_str() {
        "postgresql" => test_pg_connection(config, ssh).await,
        "mysql" => test_mysql_connection(config, ssh).await,
        "sqlite" => test_sqlite_connection(config),
        "redis" => test_redis_connection(config, ssh).await,
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
/// Connects through an SSH tunnel when configured, with TLS selected from
/// `ssl_mode` (downgraded to encrypt-only through a tunnel). The connection
/// handler is spawned and immediately dropped after confirming the
/// connection is alive; any probe tunnel is closed in every path.
async fn test_pg_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    let user = config.username.as_deref().unwrap_or("postgres");
    let dbname = config.database.as_deref().unwrap_or("postgres");
    let password = config.password.as_deref().unwrap_or("");

    let target = match resolve_connect_target(config, ssh, 5432).await {
        Ok(t) => t,
        Err(e) => return TestConnectionResult { ok: false, error: Some(e) },
    };

    // TLS: through a tunnel the peer is loopback, so verify-ca/verify-full
    // degrade to encrypt-only `require`. Direct connections honor the mode.
    let decision = crate::commands::ssh::effective_tls_decision(
        crate::db::tls::tls_decision(config.ssl_mode.as_deref()),
        target.via_tunnel,
    );
    let tls = match crate::db::tls::build_tls_config(
        decision,
        config.ssl_ca_path.as_deref(),
        config.ssl_cert_path.as_deref(),
        config.ssl_key_path.as_deref(),
    ) {
        Ok(t) => t,
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            return TestConnectionResult { ok: false, error: Some(e) };
        }
    };

    // Config builder: user/password/dbname are sent as-is (no URL
    // percent-encoding needed), and the TLS connector is chosen explicitly.
    let mut pgconfig = tokio_postgres::Config::new();
    pgconfig
        .host(target.host)
        .port(target.port)
        .user(user)
        .password(password)
        .dbname(dbname)
        .connect_timeout(std::time::Duration::from_secs(10));

    let result = match tls {
        None => crate::commands::db_viewer::connect_pg_with(&pgconfig, tokio_postgres::NoTls).await,
        Some(cc) => {
            let connector =
                tokio_postgres_rustls::MakeRustlsConnect::new((*cc).clone());
            crate::commands::db_viewer::connect_pg_with(&pgconfig, connector).await
        }
    };

    match result {
        Ok((_client, _handle)) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            // Spawn the connection handler so it keeps running while we test.
            // (Already spawned inside `connect_pg_with`.)
            TestConnectionResult { ok: true, error: None }
        }
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: false,
                error: Some(e.to_string()),
            }
        }
    }
}

/// Test a MySQL connection using `sqlx`.
///
/// Uses `MySqlPoolOptions` with a pool size of 1 and a 10-second
/// `acquire_timeout`, connecting through an SSH tunnel when configured and
/// mapping `ssl_mode` onto `MySqlSslMode` (downgraded to encrypt-only
/// through a tunnel). Any probe tunnel is closed in every path.
async fn test_mysql_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};

    let target = match resolve_connect_target(config, ssh, 3306).await {
        Ok(t) => t,
        Err(e) => return TestConnectionResult { ok: false, error: Some(e) },
    };

    let mut opts = MySqlConnectOptions::new()
        .host(&target.host)
        .port(target.port)
        .username(config.username.as_deref().unwrap_or("root"))
        .password(config.password.as_deref().unwrap_or(""))
        .database(config.database.as_deref().unwrap_or("mysql"));

    // TLS: through a tunnel the peer is loopback, so verify-ca/verify-full
    // degrade to encrypt-only `require`. Direct connections honor the mode.
    let decision = crate::commands::ssh::effective_tls_decision(
        crate::db::tls::tls_decision(config.ssl_mode.as_deref()),
        target.via_tunnel,
    );
    match decision {
        crate::db::tls::TlsDecision::Disable => {
            opts = opts.ssl_mode(MySqlSslMode::Disabled);
        }
        crate::db::tls::TlsDecision::Require => {
            opts = opts.ssl_mode(MySqlSslMode::Required);
        }
        crate::db::tls::TlsDecision::Verify => {
            // sqlx 0.8 has no VerifyFull: verify-ca -> VerifyCa (chain only),
            // verify-full -> VerifyIdentity (chain + hostname).
            match config.ssl_mode.as_deref() {
                Some("verify-ca") => opts = opts.ssl_mode(MySqlSslMode::VerifyCa),
                _ => opts = opts.ssl_mode(MySqlSslMode::VerifyIdentity),
            }
            if let Some(ca) = config.ssl_ca_path.as_deref() {
                opts = opts.ssl_ca(ca);
            }
        }
    }

    match MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(opts)
        .await
    {
        Ok(pool) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            pool.close().await;
            TestConnectionResult { ok: true, error: None }
        }
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: false,
                error: Some(e.to_string()),
            }
        }
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
/// 10-second timeout via `tokio::time::timeout`. Connects through an SSH
/// tunnel when configured; any probe tunnel is closed in every path.
async fn test_redis_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    use tokio::time::timeout;

    let target = match resolve_connect_target(config, ssh, 6379).await {
        Ok(t) => t,
        Err(e) => return TestConnectionResult { ok: false, error: Some(e) },
    };
    let password = config.password.as_deref();

    let conn_str = if let Some(pwd) = password {
        format!("redis://:{}@{}:{}/", pwd, target.host, target.port)
    } else {
        format!("redis://{}:{}/", target.host, target.port)
    };

    match redis::Client::open(conn_str.as_str()) {
        Ok(client) => {
            match timeout(
                std::time::Duration::from_secs(10),
                client.get_multiplexed_async_connection(),
            )
            .await
            {
                Ok(Ok(_conn)) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult { ok: true, error: None }
                }
                Ok(Err(e)) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult {
                        ok: false,
                        error: Some(e.to_string()),
                    }
                }
                Err(_) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult {
                        ok: false,
                        error: Some("connection timed out after 10 seconds".to_string()),
                    }
                }
            }
        }
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: false,
                error: Some(e.to_string()),
            }
        }
    }
}

/// Tauri command to test a database connection.
///
/// Calls `test_database_connection` and returns the result. `state` is
/// auto-injected; the frontend only passes `config`.
#[tauri::command]
pub async fn test_connection(
    config: DbConfig,
    state: State<'_, crate::AppState>,
) -> Result<TestConnectionResult, String> {
    Ok(test_database_connection(&config, &state.ssh_manager).await)
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

    #[test]
    fn sanitize_error_redacts_tunnel_style_urls() {
        // Tunnel connect errors can carry a URL with embedded credentials, e.g.
        // the redis:// string built for SSH-tunneled connections.
        let msg = "SSH tunnel connect failed: redis://:hunter2@127.0.0.1:6379/";
        let sanitized = sanitize_error(msg);
        assert!(
            !sanitized.contains("hunter2"),
            "must redact URL password: {sanitized}"
        );
        assert!(
            sanitized.contains("SSH tunnel connect failed"),
            "must keep the diagnostic prefix: {sanitized}"
        );
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