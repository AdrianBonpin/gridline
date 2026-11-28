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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
}

/// Strip credentials and sensitive information from error messages while
/// preserving the useful diagnostic detail (severity, message, SQLSTATE).
///
/// Redacts `password=...`, `user=...`, `secret…`, and any `scheme://user:pwd@host`
/// URL rather than discarding the whole message — so the user can still see
/// e.g. "password authentication failed for user 'foo'" without the password
/// itself. The work is one bounded, linear, Unicode-safe pass
/// ([`crate::diagnostics::redact`]): a megabyte of subprocess stderr cannot
/// stall the command, and a cut inside a multi-byte character cannot panic.
pub fn sanitize_error(msg: &str) -> String {
    crate::diagnostics::redact(msg, crate::diagnostics::MAX_CONNECTION_ERROR_BYTES)
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

    let valid_types = ["postgresql", "mysql", "mariadb", "sqlite", "redis"];
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
                    "port must be an integer between 1 and 65535 for this db_type".to_string(),
                );
            }
        }
    }

    // TLS: an unrecognized mode is refused here — before any SSH handshake or
    // connection attempt — instead of silently testing without encryption.
    if let Err(e) = crate::db::tls::validate_ssl_mode(config.ssl_mode.as_deref()) {
        return Some(e);
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
            .map_err(|e| e.to_string())?
            .map_err(|e: crate::commands::ssh_trust::SshTunnelError| e.message())?;
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

/// A failed probe (no version, no latency).
fn probe_failure(error: String) -> TestConnectionResult {
    TestConnectionResult {
        ok: false,
        error: Some(error),
        server_version: None,
        latency_ms: None,
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
pub async fn test_database_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    // Validate input first
    if let Some(err) = validate_test_input(config) {
        return TestConnectionResult {
            ok: false,
            error: Some(err),
            server_version: None,
            latency_ms: None,
        };
    }

    let result = match config.db_type.to_lowercase().as_str() {
        "postgresql" => test_pg_connection(config, ssh).await,
        "mysql" => test_mysql_connection(config, ssh).await,
        "mariadb" => test_mysql_connection(config, ssh).await,
        "sqlite" => test_sqlite_connection(config),
        "redis" => test_redis_connection(config, ssh).await,
        other => TestConnectionResult {
            ok: false,
            error: Some(format!("unsupported database type: {other}")),
            server_version: None,
            latency_ms: None,
        },
    };

    TestConnectionResult {
        ok: result.ok,
        error: result.error.map(|e| sanitize_error(&e)),
        server_version: result.server_version,
        latency_ms: result.latency_ms,
    }
}

/// Test a PostgreSQL connection using `tokio-postgres`.
///
/// Connects through an SSH tunnel when configured, with TLS selected from
/// `ssl_mode`. An unknown mode is refused before the probe starts, and through
/// a tunnel the certificate is verified against the real database hostname
/// (the tunnel only supplies the TCP endpoint). The connection handler is
/// spawned and immediately dropped after confirming the connection is alive;
/// any probe tunnel is closed in every path.
async fn test_pg_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    let user = config.username.as_deref().unwrap_or("postgres");
    let dbname = config.database.as_deref().unwrap_or("postgres");
    let password = config.password.as_deref().unwrap_or("");

    // TLS first: an unknown mode must never open a tunnel or reach a driver.
    let decision = match crate::db::tls::tls_decision_for(&config.host, config.ssl_mode.as_deref())
    {
        Ok(d) => d,
        Err(e) => return probe_failure(e),
    };
    let tls = match crate::db::tls::build_tls_config(
        decision,
        config.ssl_ca_path.as_deref(),
        config.ssl_cert_path.as_deref(),
        config.ssl_key_path.as_deref(),
    ) {
        Ok(t) => t,
        Err(e) => return probe_failure(e),
    };

    let target = match resolve_connect_target(config, ssh, 5432).await {
        Ok(t) => t,
        Err(e) => return probe_failure(e),
    };

    // Endpoint plan: through a tunnel the driver dials the tunnel's loopback
    // listener (`hostaddr`) but still verifies the certificate against
    // `config.host`, so verification is never weakened to encryption-only.
    let plan = crate::db::tls::PgConnectPlan::new(
        &config.host,
        config.port,
        decision,
        target.via_tunnel.then_some(target.port),
    );

    // Config builder: user/password/dbname are sent as-is (no URL
    // percent-encoding needed), and the TLS connector is chosen explicitly.
    let mut pgconfig = tokio_postgres::Config::new();
    plan.apply(&mut pgconfig);
    pgconfig
        .user(user)
        .password(password)
        .dbname(dbname)
        .connect_timeout(std::time::Duration::from_secs(10));

    let start = std::time::Instant::now();
    // connect_timeout only bounds TCP establishment, not TLS/authentication
    // or the version query. Bound the whole probe while retaining its tunnel.
    let result = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        let (client, handle) = match tls {
            None => {
                crate::commands::db_viewer::connect_pg_with(&pgconfig, tokio_postgres::NoTls).await
            }
            Some(cc) => {
                let connector = tokio_postgres_rustls::MakeRustlsConnect::new((*cc).clone());
                crate::commands::db_viewer::connect_pg_with(&pgconfig, connector).await
            }
        }?;
        // Latency stays "time to a usable connection": the version query is a
        // diagnostic extra, so it is not folded into the number.
        let latency_ms = start.elapsed().as_millis() as u64;
        let server_version = client
            .query_one("SELECT current_setting('server_version')", &[])
            .await
            .ok()
            .and_then(|row| row.try_get::<_, String>(0).ok());
        handle.abort();
        Ok::<_, tokio_postgres::Error>((server_version, latency_ms))
    })
    .await;
    close_probe_tunnel(ssh, target.tunnel_key.as_deref());

    match result {
        Ok(Ok((server_version, latency_ms))) => TestConnectionResult {
            ok: true,
            error: None,
            server_version,
            latency_ms: Some(latency_ms),
        },
        Ok(Err(e)) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
            server_version: None,
            latency_ms: None,
        },
        Err(_) => TestConnectionResult {
            ok: false,
            error: Some("connection timed out after 10 seconds".into()),
            server_version: None,
            latency_ms: None,
        },
    }
}

/// Test a MySQL connection using `sqlx`.
///
/// Uses `MySqlPoolOptions` with a pool size of 1 and a 10-second
/// `acquire_timeout`, connecting through an SSH tunnel when configured and
/// mapping `ssl_mode` onto `MySqlSslMode` with the same policy the viewer uses
/// (`verify-full` through a tunnel is refused, never weakened). An unknown mode
/// is refused before any probe tunnel is opened. Any probe tunnel is closed in
/// every path.
async fn test_mysql_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions};

    // TLS first: the mode is validated, and a mode this engine cannot honor
    // through a tunnel is refused, before a tunnel is opened on its behalf.
    let tls = match crate::commands::db_viewer::mysql_tls_mode(
        &config.host,
        config.ssl_mode.as_deref(),
        config.ssh_config().is_some(),
    ) {
        Ok(t) => t,
        Err(e) => return probe_failure(e),
    };

    let target = match resolve_connect_target(config, ssh, 3306).await {
        Ok(t) => t,
        Err(e) => {
            return TestConnectionResult {
                ok: false,
                error: Some(e),
                server_version: None,
                latency_ms: None,
            }
        }
    };

    let opts = MySqlConnectOptions::new()
        .host(&target.host)
        .port(target.port)
        .username(config.username.as_deref().unwrap_or("root"))
        .password(config.password.as_deref().unwrap_or(""))
        .database(config.database.as_deref().unwrap_or("mysql"));

    // Same TLS policy as browsing, so a Test cannot succeed under a weaker mode
    // than the connection will actually use.
    let opts =
        crate::commands::db_viewer::apply_mysql_tls(opts, tls, config.ssl_ca_path.as_deref());

    let start = std::time::Instant::now();
    match MySqlPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(opts)
        .await
    {
        Ok(pool) => {
            // Latency stays "time to a usable connection"; the version query is
            // a diagnostic extra and is not folded into the number.
            let latency_ms = Some(start.elapsed().as_millis() as u64);
            // Query the version BEFORE the probe tunnel is closed: through a
            // tunnel every query travels the forwarded connection, so closing
            // first would hang the query and report no version (or, worse, a
            // loopback artifact) for a target that is perfectly reachable.
            let server_version = sqlx::query_scalar::<_, String>("SELECT VERSION()")
                .fetch_one(&pool)
                .await
                .ok();
            pool.close().await;
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: true,
                error: None,
                server_version,
                latency_ms,
            }
        }
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: false,
                error: Some(e.to_string()),
                server_version: None,
                latency_ms: None,
            }
        }
    }
}

/// Test a SQLite connection using `rusqlite`.
///
/// Opens the database file at `config.host` **read-write without create**, so a
/// missing file fails instead of being silently created — the test reports what
/// is there, never a database it just made up. Creating a new database is the
/// separate, explicit [`create_sqlite_database_at`] action.
///
/// Opening alone does not prove the file is a SQLite database (SQLite defers the
/// header check), so the probe also reads the schema; only that read validates
/// an existing file and rejects an arbitrary non-database file.
fn test_sqlite_connection(config: &DbConfig) -> TestConnectionResult {
    let start = std::time::Instant::now();
    let path = std::path::Path::new(&config.host);

    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => {
            return TestConnectionResult {
                ok: false,
                error: Some(format!("not a database file: {}", config.host)),
                server_version: None,
                latency_ms: None,
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return TestConnectionResult {
                ok: false,
                error: Some(format!(
                    "database file does not exist: {} (create it first if you meant to start a new database)",
                    config.host
                )),
                server_version: None,
                latency_ms: None,
            }
        }
        Err(e) => {
            return TestConnectionResult {
                ok: false,
                error: Some(format!("cannot access database file {}: {e}", config.host)),
                server_version: None,
                latency_ms: None,
            }
        }
    }

    // READ_WRITE without CREATE: the flags the real connect path uses, minus the
    // ability to conjure a file.
    let open =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE);
    match open {
        Ok(conn) => {
            if let Err(e) = conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| {
                r.get::<_, i64>(0)
            }) {
                return TestConnectionResult {
                    ok: false,
                    error: Some(format!("not a valid SQLite database: {}: {e}", config.host)),
                    server_version: None,
                    latency_ms: None,
                };
            }
            // Best-effort server version; None if the query fails.
            let server_version = conn
                .query_row("SELECT sqlite_version()", [], |r| r.get::<_, String>(0))
                .ok();
            TestConnectionResult {
                ok: true,
                error: None,
                server_version,
                latency_ms: Some(start.elapsed().as_millis() as u64),
            }
        }
        Err(e) => TestConnectionResult {
            ok: false,
            error: Some(e.to_string()),
            server_version: None,
            latency_ms: None,
        },
    }
}

/// Create a new SQLite database file at `path` — the explicit alternative to
/// testing a connection.
///
/// Fails closed on anything that could destroy data: an existing path is never
/// opened or truncated, and the parent directory must already exist (creation
/// does not build directory trees).
pub fn create_sqlite_database_at(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("file path must not be empty".to_string());
    }
    let file = std::path::Path::new(path);
    if file.exists() {
        return Err(format!(
            "a file already exists at {path}; refusing to overwrite it"
        ));
    }
    if let Some(parent) = file.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(format!("directory does not exist: {}", parent.display()));
        }
    }

    let conn = rusqlite::Connection::open_with_flags(
        file,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    )
    .map_err(|e| format!("could not create database at {path}: {e}"))?;
    // Write a real database header immediately, so the new file is a database
    // rather than an empty placeholder that only becomes one on first write.
    conn.execute_batch("VACUUM;")
        .map_err(|e| format!("could not initialise database at {path}: {e}"))?;
    Ok(())
}

/// Create a new SQLite database file at the destination a **write** File Grant
/// authorized, returning that destination (display metadata only).
///
/// The path is resolved from the grant and nowhere else: a raw renderer-supplied
/// path, an empty string, an unknown id, an expired selection, a selection minted
/// for another intent, and a replayed id all fail closed with the specific
/// `file-grant-*` state and create nothing (`GLOSSARY.md` → File Grant).
pub fn create_sqlite_database_from_grant(
    grants: &crate::file_grant::FileGrantStore,
    grant_id: &str,
) -> Result<String, String> {
    let path = crate::file_grant::consume_granted_path(
        grants,
        grant_id,
        crate::file_grant::FileIntent::Write,
    )?;
    create_sqlite_database_at(&path)?;
    Ok(path)
}

/// Tauri command to create a new SQLite database file at the destination the
/// user chose in the operating system's save dialog.
///
/// `file_grant` is the id from `select_file_for_grant` (write intent) and is
/// consumed by this call; the destination is the grant's, never an argument, so
/// the webview cannot name the file it creates.
#[tauri::command]
pub fn create_sqlite_database(
    file_grant: String,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    create_sqlite_database_from_grant(&state.file_grants, &file_grant)
}

/// Test a Redis connection using the `redis` crate.
///
/// Builds a [`redis::ConnectionInfo`] directly instead of interpolating a
/// `redis://` URL: a stored password may contain any character (`@`, `:`, `/`,
/// `?`, `#`, `%`…), and URL userinfo/percent-encoding would either reject it or
/// hand Redis a mangled credential. Uses `get_multiplexed_async_connection` with
/// a 10-second timeout. Connects through an SSH tunnel when configured; any probe
/// tunnel is closed in every path.
async fn test_redis_connection(config: &DbConfig, ssh: &SshManager) -> TestConnectionResult {
    use tokio::time::timeout;

    let target = match resolve_connect_target(config, ssh, 6379).await {
        Ok(t) => t,
        Err(e) => {
            return TestConnectionResult {
                ok: false,
                error: Some(e),
                server_version: None,
                latency_ms: None,
            }
        }
    };

    let conn_info = redis::ConnectionInfo {
        addr: redis::ConnectionAddr::Tcp(target.host.clone(), target.port),
        redis: redis::RedisConnectionInfo {
            db: 0,
            username: config.username.clone().filter(|u| !u.is_empty()),
            password: config.password.clone(),
            protocol: redis::ProtocolVersion::RESP2,
        },
    };

    let start = std::time::Instant::now();
    match redis::Client::open(conn_info) {
        Ok(client) => {
            match timeout(
                std::time::Duration::from_secs(10),
                client.get_multiplexed_async_connection(),
            )
            .await
            {
                Ok(Ok(_conn)) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult {
                        ok: true,
                        error: None,
                        server_version: None,
                        latency_ms: Some(start.elapsed().as_millis() as u64),
                    }
                }
                Ok(Err(e)) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult {
                        ok: false,
                        error: Some(e.to_string()),
                        server_version: None,
                        latency_ms: None,
                    }
                }
                Err(_) => {
                    close_probe_tunnel(ssh, target.tunnel_key.as_deref());
                    TestConnectionResult {
                        ok: false,
                        error: Some("connection timed out after 10 seconds".to_string()),
                        server_version: None,
                        latency_ms: None,
                    }
                }
            }
        }
        Err(e) => {
            close_probe_tunnel(ssh, target.tunnel_key.as_deref());
            TestConnectionResult {
                ok: false,
                error: Some(e.to_string()),
                server_version: None,
                latency_ms: None,
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
        // ok=true result with server_version/latency serializes all fields
        let result = TestConnectionResult {
            ok: true,
            error: None,
            server_version: Some("15.2".to_string()),
            latency_ms: Some(12),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(
            json.contains("\"ok\":true"),
            "ok=true should appear in JSON: {json}"
        );
        assert!(
            json.contains("\"server_version\":\"15.2\""),
            "server_version should appear in JSON: {json}"
        );
        assert!(
            json.contains("\"latency_ms\":12"),
            "latency_ms should appear in JSON: {json}"
        );

        // error result includes the error message; None fields are skipped
        let result = TestConnectionResult {
            ok: false,
            error: Some("connection refused".to_string()),
            server_version: None,
            latency_ms: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(
            json.contains("\"connection refused\""),
            "error message should appear in JSON: {json}"
        );
        assert!(
            !json.contains("server_version"),
            "None server_version should be skipped: {json}"
        );
        assert!(
            !json.contains("latency_ms"),
            "None latency_ms should be skipped: {json}"
        );
    }

    // ------------------------------------------------------------------
    // sanitize_error
    // ------------------------------------------------------------------

    #[test]
    fn test_connection_sanitizes_error() {
        let msg = "connection failed: password=secret123 user=admin";
        let sanitized = sanitize_error(msg);
        assert!(
            !sanitized.contains("secret123"),
            "should not leak password value"
        );
        assert!(
            !sanitized.contains("admin"),
            "should not leak username value"
        );
        assert!(
            !sanitized.contains("password="),
            "should remove password= pattern"
        );
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

    #[test]
    fn validate_test_input_rejects_unknown_tls_mode_naming_the_valid_set() {
        let config = DbConfig {
            db_type: "postgresql".to_string(),
            host: "localhost".to_string(),
            port: Some(5432),
            ssl_mode: Some("prefer".to_string()),
            ..Default::default()
        };
        let err = validate_test_input(&config).expect("an unknown TLS mode must be rejected");
        assert!(err.contains("prefer"), "got: {err}");
        for valid in crate::db::tls::VALID_SSL_MODES {
            assert!(err.contains(valid), "error {err} must name {valid}");
        }
    }

    #[test]
    fn validate_test_input_accepts_every_supported_tls_mode() {
        for mode in crate::db::tls::VALID_SSL_MODES {
            let config = DbConfig {
                db_type: "postgresql".to_string(),
                host: "localhost".to_string(),
                port: Some(5432),
                ssl_mode: Some(mode.to_string()),
                ..Default::default()
            };
            assert!(
                validate_test_input(&config).is_none(),
                "{mode} should be accepted"
            );
        }
    }

    /// The probe refuses an unknown mode before any tunnel is opened, and never
    /// reports success for a mode it could not honor.
    #[tokio::test]
    async fn postgres_probe_refuses_an_unknown_tls_mode_before_opening_a_tunnel() {
        let backend =
            std::sync::Arc::new(crate::commands::ssh_trust::fake::FakeTunnelBackend::default());
        let ssh = std::sync::Mutex::new(SshTunnelManager::new(backend.clone()));
        let config = DbConfig {
            db_type: "postgresql".to_string(),
            host: "db.internal".to_string(),
            port: Some(5432),
            ssl_mode: Some("allow".to_string()),
            ssh_host: Some("bastion.internal".to_string()),
            ssh_port: Some(22),
            ssh_user: Some("tunnel".to_string()),
            ssh_auth_method: Some("password".to_string()),
            ..Default::default()
        };

        let result = test_database_connection(&config, &ssh).await;

        assert!(!result.ok);
        let err = result.error.unwrap_or_default();
        assert!(err.contains("allow"), "got: {err}");
        assert!(
            backend.opened().is_empty(),
            "no probe tunnel may be opened for a rejected TLS mode"
        );
    }

    /// MySQL cannot verify `verify-full` against the real hostname through a
    /// tunnel, so the probe refuses it instead of testing under a weaker mode.
    #[tokio::test]
    async fn mysql_probe_refuses_verify_full_through_a_tunnel() {
        let backend =
            std::sync::Arc::new(crate::commands::ssh_trust::fake::FakeTunnelBackend::default());
        let ssh = std::sync::Mutex::new(SshTunnelManager::new(backend.clone()));
        let config = DbConfig {
            db_type: "mysql".to_string(),
            host: "db.internal".to_string(),
            port: Some(3306),
            ssl_mode: Some("verify-full".to_string()),
            ssh_host: Some("bastion.internal".to_string()),
            ssh_port: Some(22),
            ssh_user: Some("tunnel".to_string()),
            ssh_auth_method: Some("password".to_string()),
            ..Default::default()
        };

        let result = test_database_connection(&config, &ssh).await;

        assert!(!result.ok);
        let err = result.error.unwrap_or_default();
        assert!(err.contains("verify-full"), "got: {err}");
        assert!(backend.opened().is_empty());
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

#[cfg(test)]
#[path = "test_connection.test.rs"]
mod test_connection_tests;
