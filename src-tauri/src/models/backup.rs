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
}
