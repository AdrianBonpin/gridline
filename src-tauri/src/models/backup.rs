use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOptions {
    pub format: String, // "plain" | "custom" | "tar" | "directory"
    pub file_path: String,
    pub schema: Option<String>,
    pub tables: Option<Vec<String>>,
    pub no_owner: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptions {
    pub format: String,
    pub file_path: String,
    pub clean: bool,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOptions {
    pub source_connection_id: String,
    pub target_connection_id: String,
    pub schema: Option<String>,
    pub tables: Option<Vec<String>>,
    #[serde(default = "default_sync_db_type")]
    pub db_type: String,
}

fn default_sync_db_type() -> String {
    "postgresql".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PgToolStatus {
    pub pg_dump_found: bool,
    pub pg_restore_found: bool,
    pub pg_dump_version: Option<String>,
    pub pg_restore_version: Option<String>,
    pub pg_dump_source: Option<String>,    // "system" | "bundled" | None
    pub pg_restore_source: Option<String>,
}

/// Resolved on-disk paths for the three client tools (system-first, bundled-fallback).
#[derive(Debug, Clone)]
pub struct PgToolPaths {
    pub pg_dump: String,
    pub pg_restore: String,
    pub psql: String,
}

/// Connection params for a MySQL server (decoupled from store/keychain so the
/// dump/restore/sync core stays headless-testable). Mirrors `PgConnParams`.
#[derive(Debug, Clone)]
pub struct MySqlConnParams {
    pub host: String,
    pub port: i64,
    pub username: String,
    pub database: String,
    pub password: String,
}

impl MySqlConnParams {
    pub fn new(host: String, port: i64, username: String, database: String, password: String) -> Self {
        Self { host, port, username, database, password }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlBackupOptions {
    pub database: String,
    pub file_path: String,
    pub single_transaction: bool,
    pub no_data: bool,
    pub routines: bool,
    pub triggers: bool,
    pub events: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlRestoreOptions {
    pub database: String,
    pub file_path: String,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteBackupOptions {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqliteRestoreOptions {
    pub file_path: String,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlToolStatus {
    pub mysqldump_found: bool,
    pub mysql_found: bool,
    pub mysqldump_version: Option<String>,
    pub mysql_version: Option<String>,
    pub mysqldump_source: Option<String>,
    pub mysql_source: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MySqlToolPaths {
    pub mysqldump: String,
    pub mysql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupJob {
    pub id: String,
    pub connection_id: String,
    pub r#type: String, // "dump" | "restore" | "sync"
    pub format: Option<String>,
    pub file_path: Option<String>,
    pub source_connection_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub size_bytes: Option<i64>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupProgressEvent {
    pub job_id: String,
    pub status: String,
    pub progress: Option<f64>,
    pub output_line: Option<String>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_options_serialization() {
        let opts = BackupOptions {
            format: "plain".into(),
            file_path: "/tmp/dump.sql".into(),
            schema: Some("public".into()),
            tables: None,
            no_owner: true,
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("plain"));
        assert!(json.contains("noOwner"));
    }

    #[test]
    fn backup_job_serialization() {
        let job = BackupJob {
            id: "job-1".into(),
            connection_id: "conn-1".into(),
            r#type: "dump".into(),
            format: Some("plain".into()),
            file_path: Some("/tmp/dump.sql".into()),
            source_connection_id: None,
            status: "completed".into(),
            error_message: None,
            size_bytes: Some(1024),
            started_at: "2025-07-28T10:00:00Z".into(),
            completed_at: Some("2025-07-28T10:01:00Z".into()),
        };
        let json = serde_json::to_string(&job).unwrap();
        assert!(json.contains("dump"));
        assert!(json.contains("completed"));
    }

    #[test]
    fn pg_tool_status_reports_source() {
        let s = PgToolStatus { pg_dump_found: true, pg_restore_found: true,
            pg_dump_version: Some("pg_dump 16".into()), pg_restore_version: Some("pg_restore 16".into()),
            pg_dump_source: Some("system".into()), pg_restore_source: Some("bundled".into()) };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"pg_dump_source\":\"system\""));
        assert!(json.contains("\"pg_restore_source\":\"bundled\""));
    }

    #[test]
    fn mysql_backup_options_serialize_camel_case() {
        let opts = MySqlBackupOptions {
            database: "shop".into(),
            file_path: "/tmp/dump.sql".into(),
            single_transaction: true,
            no_data: false,
            routines: true,
            triggers: true,
            events: false,
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"singleTransaction\":true"));
        assert!(json.contains("\"filePath\":\"/tmp/dump.sql\""));
        assert!(!json.contains("no_owner"));
    }

    #[test]
    fn sqlite_restore_options_serialize_camel_case() {
        let opts = SqliteRestoreOptions { file_path: "/tmp/in.sql".into(), clean: true };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"filePath\":\"/tmp/in.sql\""));
        assert!(json.contains("\"clean\":true"));
    }

    #[test]
    fn mysql_tool_status_reports_source() {
        let s = MySqlToolStatus {
            mysqldump_found: true,
            mysql_found: true,
            mysqldump_version: Some("mariadb-dump 10.6".into()),
            mysql_version: Some("mariadb 10.6".into()),
            mysqldump_source: Some("bundled".into()),
            mysql_source: Some("system".into()),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"mysqldumpSource\":\"bundled\""));
    }

    #[test]
    fn sync_options_carry_db_type() {
        let s = SyncOptions {
            source_connection_id: "a".into(),
            target_connection_id: "b".into(),
            schema: None,
            tables: None,
            db_type: "mysql".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"dbType\":\"mysql\""));
    }
}
