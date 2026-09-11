use super::*;
use crate::commands::ssh::{Ssh2Backend, SshTunnelManager};
use crate::db::pool::DbConfig;
use std::sync::Arc;

fn mariadb_config(port: Option<i64>) -> DbConfig {
    DbConfig {
        db_type: "mariadb".into(),
        host: "127.0.0.1".into(),
        port,
        username: Some("root".into()),
        password: None,
        database: Some("test".into()),
        ..Default::default()
    }
}

#[test]
fn validate_test_input_accepts_mariadb_with_port() {
    assert_eq!(validate_test_input(&mariadb_config(Some(3306))), None);
}

#[test]
fn validate_test_input_rejects_mariadb_without_port() {
    assert!(validate_test_input(&mariadb_config(None)).is_some());
}

/// Live test against a real MariaDB server. Run with:
/// `GRIDLINE_TEST_MARIADB_HOST=… GRIDLINE_TEST_MARIADB_PORT=3306 \
///  GRIDLINE_TEST_MARIADB_USER=… GRIDLINE_TEST_MARIADB_PASSWORD=… \
///  GRIDLINE_TEST_MARIADB_DB=… cargo test -- --ignored mariadb_live`
#[test]
#[ignore]
fn mariadb_live_test_connection_reports_mariadb_version() {
    let config = DbConfig {
        host: std::env::var("GRIDLINE_TEST_MARIADB_HOST").expect("GRIDLINE_TEST_MARIADB_HOST"),
        port: std::env::var("GRIDLINE_TEST_MARIADB_PORT")
            .ok()
            .and_then(|p| p.parse::<i64>().ok()),
        username: std::env::var("GRIDLINE_TEST_MARIADB_USER").ok(),
        password: std::env::var("GRIDLINE_TEST_MARIADB_PASSWORD").ok(),
        database: std::env::var("GRIDLINE_TEST_MARIADB_DB").ok(),
        ..mariadb_config(None)
    };
    let rt = tokio::runtime::Runtime::new().unwrap();
    let ssh = std::sync::Mutex::new(SshTunnelManager::new(Arc::new(Ssh2Backend)));
    let result = rt.block_on(async { test_mysql_connection(&config, &ssh).await });
    assert!(result.ok, "connection failed: {:?}", result.error);
    let version = result.server_version.unwrap_or_default().to_lowercase();
    assert!(
        version.contains("mariadb"),
        "expected a MariaDB server, got version: {version:?}"
    );
}
