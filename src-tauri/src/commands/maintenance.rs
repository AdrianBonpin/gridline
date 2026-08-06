use tauri::State;
use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::models::MaintenanceResult;

/// Run a table-scoped maintenance command via the SIMPLE query protocol
/// (never inside a transaction — VACUUM cannot run in a transaction block).
pub(crate) async fn run_maintenance_inner(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, schema: &str, table: &str, action: &str,
) -> Result<MaintenanceResult, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Maintenance is PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    crate::db::object_ddl::validate_object_name(&schema)?;
    crate::db::object_ddl::validate_object_name(&table)?;
    let verb = match action {
        "vacuum" => "VACUUM",
        "analyze" => "ANALYZE",
        "reindex" => "REINDEX TABLE",
        _ => return Err(format!("Unknown maintenance action: {action}")),
    };
    let sql = format!("{} {}.{}", verb,
        crate::db::object_ddl::quote_ident(&schema), crate::db::object_ddl::quote_ident(&table));
    let start = std::time::Instant::now();
    client.simple_query(&sql).await
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
    Ok(MaintenanceResult { duration_ms: start.elapsed().as_millis() as i64, message: format!("{} completed on {}.{}", verb, schema, table) })
}

#[tauri::command]
pub async fn run_maintenance(connection_id: String, schema: String, table: String, action: String, state: State<'_, crate::AppState>) -> Result<MaintenanceResult, String> {
    run_maintenance_inner(&state.pool_manager, &connection_id, &schema, &table, &action).await
}

#[cfg(test)]
#[path = "maintenance.test.rs"]
mod maintenance_test;