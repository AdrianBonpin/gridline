use tauri::State;
use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::db::object_ddl::*;
#[allow(unused_imports)] // DependencyInfo consumed by Task 2.5 (object dependencies)
use crate::models::db_viewer::{ObjectSearchHit, DependencyInfo};

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

pub(crate) async fn search_objects_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, schema: &str, needle: &str) -> Result<Vec<ObjectSearchHit>, String> {
    let sql = pg_object_search_query();
    let mut pm = pm.lock().await;
    match pm.get(connection_id) {
        Some(DbHandle::Postgresql(client, _)) => {
            let rows = client.query(&sql, &[&needle, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(rows.iter().map(|r| ObjectSearchHit {
                name: r.get(0), schema: r.get(1), object_type: r.get(2),
            }).collect())
        }
        Some(DbHandle::Sqlite(_)) | Some(DbHandle::MySql(_)) => Ok(vec![]),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn search_objects(connection_id: String, schema: String, query: String, state: State<'_, crate::AppState>) -> Result<Vec<ObjectSearchHit>, String> {
    search_objects_inner(&state.pool_manager, &connection_id, &schema, &query).await
}

pub(crate) async fn get_object_ddl_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, schema: &str, object_type: &str, name: &str) -> Result<String, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Copy-as-DDL is PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    match object_type {
        "function" | "procedure" => {
            let row = client.query_one("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE p.proname=$1 AND n.nspname=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(row.get::<_, String>(0))
        }
        "trigger" => {
            let row = client.query_one("SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid WHERE t.tgname=$1 AND n.nspname=$2 AND NOT t.tgisinternal LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(row.get::<_, String>(0))
        }
        "index" => {
            let row = client.query_one("SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_class t ON t.oid=ix.indrelid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE i.relname=$1 AND n.nspname=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(row.get::<_, String>(0))
        }
        "constraint" => {
            let row = client.query_one("SELECT c.conname, ns.nspname, cl.relname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class cl ON c.conrelid=cl.oid JOIN pg_namespace ns ON cl.relnamespace=ns.oid WHERE c.conname=$1 AND ns.nspname=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(constraint_ddl(&crate::models::db_viewer::ConstraintInfo {
                name: row.get(0), schema: row.get(1), table: row.get(2), contype: "CHECK".into(),
                definition: row.get(3), deferrable: false, validated: true, columns: vec![] }))
        }
        "view" => {
            let row = client.query_one("SELECT pg_get_viewdef(c.oid, true) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE c.relname=$1 AND n.nspname=$2 AND c.relkind='v' LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(view_ddl(schema, name, &row.get::<_, String>(0)))
        }
        "materialized view" => {
            let row = client.query_one("SELECT definition FROM pg_matviews WHERE matviewname=$1 AND schemaname=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(matview_ddl(schema, name, &row.get::<_, String>(0)))
        }
        "sequence" => {
            let row = client.query_one("SELECT sequence_name, sequence_schema, start_value::text, minimum_value::text, maximum_value::text, increment::text, COALESCE(pg_catalog.pg_sequence_last_value(sequence_name::regclass)::text,'0'), cycle_option::text FROM information_schema.sequences WHERE sequence_name=$1 AND sequence_schema=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(sequence_ddl(&crate::models::db_viewer::SequenceInfo { name: row.get(0), schema: row.get(1), start_value: row.get(2), min_value: row.get(3), max_value: row.get(4), increment: row.get(5), current_value: row.get(6), cycle: row.get::<_, String>(7).eq_ignore_ascii_case("YES") }))
        }
        "enum" => {
            let row = client.query_one("SELECT t.typname, n.nspname, ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder) FROM pg_type t JOIN pg_namespace n ON t.typnamespace=n.oid WHERE t.typname=$1 AND n.nspname=$2 AND t.typtype='e' LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(enum_ddl(&crate::models::db_viewer::EnumInfo { name: row.get(0), schema: row.get(1), labels: row.get::<_, Vec<String>>(2) }))
        }
        "extension" => {
            let row = client.query_one("SELECT e.extname, n.nspname, e.extversion::text FROM pg_extension e JOIN pg_namespace n ON e.extnamespace=n.oid WHERE e.extname=$1 AND n.nspname=$2 LIMIT 1", &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?;
            Ok(extension_ddl(&crate::models::db_viewer::ExtensionInfo { name: row.get(0), schema: row.get(1), version: row.get(2), comment: None }))
        }
        "table" => {
            // Tables reuse the pg_dump path (bundled-aware); the command wrapper resolves the tool path via AppHandle.
            Err("table DDL uses get_table_ddl".into())
        }
        other => Err(format!("Unsupported object type for DDL: {other}")),
    }
}

#[tauri::command]
pub async fn get_object_ddl(connection_id: String, schema: String, object_type: String, name: String, state: State<'_, crate::AppState>, app: tauri::AppHandle) -> Result<String, String> {
    if object_type == "table" || object_type == "TABLE" {
        return crate::commands::db_viewer::get_table_ddl(connection_id, schema, name, state, app).await;
    }
    get_object_ddl_inner(&state.pool_manager, &connection_id, &schema, &object_type.to_lowercase(), &name).await
}

#[cfg(test)]
#[path = "objects.test.rs"]
mod tests;