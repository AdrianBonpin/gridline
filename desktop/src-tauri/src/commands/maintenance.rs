use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::models::MaintenanceResult;
use tauri::State;

/// Run a table-scoped maintenance command via the SIMPLE query protocol
/// (never inside a transaction — VACUUM cannot run in a transaction block).
pub(crate) async fn run_maintenance_inner(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    schema: &str,
    table: &str,
    action: &str,
) -> Result<MaintenanceResult, String> {
    let db_handle = crate::db::pool::acquire_handle(pm, connection_id).await?;
    let client = match db_handle {
        DbHandle::Postgresql(c, _) => c,
        _ => return Err("Maintenance is PostgreSQL-only".into()),
    };
    let client = client.lock().await;
    crate::db::object_ddl::validate_object_name(&schema)?;
    crate::db::object_ddl::validate_object_name(&table)?;
    let verb = match action {
        "vacuum" => "VACUUM",
        "analyze" => "ANALYZE",
        "reindex" => "REINDEX TABLE",
        _ => return Err(format!("Unknown maintenance action: {action}")),
    };
    let sql = format!(
        "{} {}.{}",
        verb,
        crate::db::object_ddl::quote_ident(&schema),
        crate::db::object_ddl::quote_ident(&table)
    );
    let start = std::time::Instant::now();
    client
        .simple_query(&sql)
        .await
        .map_err(|e| crate::commands::db_viewer::sanitize_error(&format!("{e}")))?;
    Ok(MaintenanceResult {
        duration_ms: start.elapsed().as_millis() as i64,
        message: format!("{} completed on {}.{}", verb, schema, table),
    })
}

#[tauri::command]
pub async fn run_maintenance(
    connection_id: String,
    schema: String,
    table: String,
    action: String,
    state: State<'_, crate::AppState>,
) -> Result<MaintenanceResult, String> {
    run_maintenance_inner(
        &state.pool_manager,
        &connection_id,
        &schema,
        &table,
        &action,
    )
    .await
}

#[cfg(test)]
#[path = "maintenance.test.rs"]
mod maintenance_test;
