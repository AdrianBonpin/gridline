use crate::models::ConnectionInput;
use crate::store::Store;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

const VALID_DB_TYPES: [&str; 4] = ["postgresql", "mysql", "sqlite", "redis"];

#[derive(Debug, Deserialize)]
pub(crate) struct ImportRecord {
    name: Option<String>,
    db_type: String,
    host: String,
    port: Option<i64>,
    username: Option<String>,
    folder_id: Option<String>,
    tag_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedRecord {
    pub index: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub skipped_records: Vec<SkippedRecord>,
}

#[allow(dead_code)]
pub fn parse_import(json: &str) -> Result<Vec<ImportRecord>, String> {
    let records: Vec<ImportRecord> = serde_json::from_str(json).map_err(|e| format!("invalid JSON: {}", e))?;
    for (i, rec) in records.iter().enumerate() {
        if rec.name.as_deref().unwrap_or("").is_empty() {
            return Err(format!("record {}: name is required", i));
        }
        if !VALID_DB_TYPES.contains(&rec.db_type.as_str()) {
            return Err(format!("record {}: invalid db_type: {}", i, rec.db_type));
        }
    }
    Ok(records)
}

pub fn import_connections_inner(state: &Mutex<Store>, json: String) -> Result<ImportResult, String> {
    let records: Vec<ImportRecord> = serde_json::from_str(&json).map_err(|e| format!("invalid JSON: {}", e))?;
    let store = state.lock().map_err(|e| e.to_string())?;
    let mut imported = 0usize;
    let mut skipped_records = Vec::new();
    for (i, rec) in records.iter().enumerate() {
        let name = match &rec.name {
            Some(n) if !n.is_empty() => n.clone(),
            _ => {
                skipped_records.push(SkippedRecord { index: i, reason: "missing or empty name".into() });
                continue;
            }
        };
        if !VALID_DB_TYPES.contains(&rec.db_type.as_str()) {
            skipped_records.push(SkippedRecord { index: i, reason: format!("invalid db_type: {}", rec.db_type) });
            continue;
        }
        if rec.host.is_empty() {
            skipped_records.push(SkippedRecord { index: i, reason: "missing or empty host".into() });
            continue;
        }
        let input = ConnectionInput {
            name,
            db_type: rec.db_type.clone(),
            host: rec.host.clone(),
            port: rec.port,
            username: rec.username.clone(),
            folder_id: rec.folder_id.clone(),
            tag_ids: rec.tag_ids.clone().unwrap_or_default(),
        };
        match store.create_connection(input) {
            Ok(_) => imported += 1,
            Err(e) => skipped_records.push(SkippedRecord { index: i, reason: e }),
        }
    }
    Ok(ImportResult { imported, skipped: skipped_records.len(), skipped_records })
}

pub fn export_connections_inner(state: &Mutex<Store>) -> Result<String, String> {
    let store = state.lock().map_err(|e| e.to_string())?;
    let conns = store.get_connections()?;
    let export = serde_json::json!({ "version": 1, "connections": conns });
    serde_json::to_string_pretty(&export).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_connections(state: tauri::State<crate::DbState>, json: String) -> Result<ImportResult, String> {
    import_connections_inner(&state.0, json)
}

#[tauri::command]
pub fn export_connections(state: tauri::State<crate::DbState>) -> Result<String, String> {
    export_connections_inner(&state.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use crate::models::ConnectionInput;

    fn state() -> std::sync::Mutex<Store> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::store::migrations::run_migrations(&conn).unwrap();
        std::sync::Mutex::new(Store::from_connection(conn))
    }

    #[test]
    fn parse_import_validates_required_fields() {
        let json = r#"[{ "name": "X", "db_type": "postgresql", "host": "h", "port": 5432 }]"#;
        let parsed = parse_import(json).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].name.as_deref(), Some("X"));
    }

    #[test]
    fn parse_import_rejects_missing_name() {
        let json = r#"[{ "db_type": "postgresql", "host": "h", "port": 5432 }]"#;
        assert!(parse_import(json).is_err());
    }

    #[test]
    fn parse_import_rejects_invalid_db_type() {
        let json = r#"[{ "name": "X", "db_type": "mongodb", "host": "h", "port": 5432 }]"#;
        assert!(parse_import(json).is_err());
    }

    #[test]
    fn import_connections_inserts_all() {
        let st = state();
        let json = r#"[{ "name": "A", "db_type": "postgresql", "host": "h", "port": 5432 }, { "name": "B", "db_type": "redis", "host": "r", "port": 6379 }]"#;
        let result = import_connections_inner(&st, json.to_string()).unwrap();
        assert_eq!(result.imported, 2);
        assert_eq!(result.skipped, 0);
    }

    #[test]
    fn import_connections_skips_invalid_keeps_valid() {
        let st = state();
        let json = r#"[{ "name": "A", "db_type": "postgresql", "host": "h", "port": 5432 }, { "db_type": "postgresql", "host": "h", "port": 5432 }, { "name": "B", "db_type": "redis", "host": "r", "port": 6379 }]"#;
        let result = import_connections_inner(&st, json.to_string()).unwrap();
        assert_eq!(result.imported, 2);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.skipped_records[0].reason, "missing or empty name");
    }

    #[test]
    fn export_connections_returns_json() {
        let st = state();
        let _ = st.lock().unwrap().create_connection(ConnectionInput {
            name: "A".into(), db_type: "postgresql".into(), host: "h".into(),
            port: Some(5432), username: None, folder_id: None, tag_ids: vec![],
        });
        let json = export_connections_inner(&st).unwrap();
        assert!(json.contains("\"name\""));
        assert!(json.contains("\"version\""));
    }
}