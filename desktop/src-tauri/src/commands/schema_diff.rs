//! Thin `compare_schemas` command (spec §4: two pool lookups → snapshots →
//! diff; errors name the failing side; staging never happens here).

use crate::models::db_viewer::DiffReport;
use tauri::State;

/// Engine family for diff pairing: mysql and mariadb are one family.
pub fn engine_family(db_type: &str) -> String {
    match db_type {
        "mysql" | "mariadb" => "mysql".to_string(),
        "sqlite" => "sqlite".to_string(),
        "postgresql" => "postgresql".to_string(),
        other => other.to_string(),
    }
}

fn validate_same_family(source_db_type: &str, target_db_type: &str) -> Result<(), String> {
    let (s, t) = (engine_family(source_db_type), engine_family(target_db_type));
    if s != t {
        return Err(format!(
            "Schema diff requires the same engine family — source is {s}, target is {t}"
        ));
    }
    Ok(())
}

fn connection_db_type(
    db_store: &std::sync::Mutex<crate::store::Store>,
    connection_id: &str,
) -> Result<String, String> {
    let store = db_store.lock().map_err(|e| e.to_string())?;
    let conns = store.get_connections().map_err(|e| e.to_string())?;
    conns
        .iter()
        .find(|c| c.id == connection_id)
        .map(|c| c.db_type.clone())
        .ok_or_else(|| format!("connection {connection_id} not found"))
}

#[tauri::command]
pub async fn compare_schemas(
    source_connection_id: String,
    source_schema: String,
    target_connection_id: String,
    target_schema: String,
    state: State<'_, crate::AppState>,
) -> Result<DiffReport, String> {
    let source_db_type = connection_db_type(&state.db_store, &source_connection_id)
        .map_err(|e| format!("Source connection failed: {e}"))?;
    let target_db_type = connection_db_type(&state.db_store, &target_connection_id)
        .map_err(|e| format!("Target connection failed: {e}"))?;
    validate_same_family(&source_db_type, &target_db_type)?;

    let mut pm = state.pool_manager.lock().await;

    let source = {
        let handle = pm
            .get(&source_connection_id)
            .ok_or_else(|| "Source connection failed: not connected (open it in the DB viewer first)".to_string())?;
        crate::db::schema_diff::capture_snapshot(handle, &source_db_type, &source_schema)
            .await
            .map_err(|e| format!("Source connection failed: {e}"))?
    };

    let target = {
        let handle = pm
            .get(&target_connection_id)
            .ok_or_else(|| "Target connection failed: not connected".to_string())?;
        crate::db::schema_diff::capture_snapshot(handle, &target_db_type, &target_schema)
            .await
            .map_err(|e| format!("Target connection failed: {e}"))?
    };

    let mut report = crate::db::schema_diff::diff_snapshots(&source, &target);
    report.source_label = format!("{} · {}", report.source_label, source_connection_id);
    report.target_label = format!("{} · {}", report.target_label, target_connection_id);
    Ok(report)
}

#[cfg(test)]
#[path = "schema_diff.test.rs"]
mod schema_diff_tests;
