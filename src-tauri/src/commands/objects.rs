use tauri::State;
use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::db::object_ddl::*;

fn sanitize(e: &str) -> String { crate::commands::db_viewer::sanitize_error(e) }

async fn exec_sql(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, sql: String) -> Result<(), String> {
    let mut pm = pm.lock().await;
    match pm.get(connection_id) {
        Some(DbHandle::Postgresql(client, _)) => client.execute(&sql, &[]).await.map(|_| ()).map_err(|e| sanitize(&e.to_string())),
        Some(_) => Err("Schema CRUD is PostgreSQL-only".into()),
        None => Err("Connection not found".into()),
    }
}

pub(crate) async fn create_schema_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, name: &str) -> Result<(), String> {
    exec_sql(pm, connection_id, create_schema_sql(name)?).await
}
pub(crate) async fn rename_schema_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, old: &str, new: &str) -> Result<(), String> {
    exec_sql(pm, connection_id, rename_schema_sql(old, new)?).await
}
pub(crate) async fn drop_schema_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, name: &str, cascade: bool) -> Result<(), String> {
    exec_sql(pm, connection_id, drop_schema_sql(name, cascade)?).await
}

#[tauri::command]
pub async fn create_schema(connection_id: String, name: String, state: State<'_, crate::AppState>) -> Result<(), String> {
    create_schema_inner(&state.pool_manager, &connection_id, &name).await
}
#[tauri::command]
pub async fn rename_schema(connection_id: String, old_name: String, new_name: String, state: State<'_, crate::AppState>) -> Result<(), String> {
    rename_schema_inner(&state.pool_manager, &connection_id, &old_name, &new_name).await
}
#[tauri::command]
pub async fn drop_schema(connection_id: String, name: String, cascade: bool, state: State<'_, crate::AppState>) -> Result<(), String> {
    drop_schema_inner(&state.pool_manager, &connection_id, &name, cascade).await
}

#[cfg(test)]
#[path = "objects.test.rs"]
mod tests;