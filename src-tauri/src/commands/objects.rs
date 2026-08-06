use tauri::State;
use crate::db::pool::{ConnectionPoolManager, DbHandle};
use crate::db::object_crud::{build_ddl, rebuild_script, RebuildConstraint, RebuildFk, RebuildFkIn, RebuildGrant, RebuildIndex, RebuildInput, RebuildOwnedSequence, TableColumn};
use crate::db::object_ddl::*;
use crate::models::db_viewer::{ObjectSearchHit, DependencyInfo, ExtensionInfo};

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

pub(crate) async fn get_object_dependencies_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, schema: &str, object_type: &str, name: &str) -> Result<Vec<DependencyInfo>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Dependencies are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    if object_type.eq_ignore_ascii_case("schema") {
        let rows = client.query(&pg_schema_contents_query(), &[&name]).await.map_err(|e| sanitize(&e.to_string()))?;
        return Ok(rows.iter().map(|r| DependencyInfo {
            deptype: "n".into(), class: format!("pg_class: {}", r.get::<_, String>(1)), name: r.get(0),
        }).collect());
    }
    let oid_sql = pg_object_oid_query(&object_type.to_lowercase());
    if oid_sql.is_empty() { return Err(format!("Unsupported object type: {object_type}")); }
    let oid: tokio_postgres::types::Oid = client.query_one(&oid_sql, &[&name, &schema]).await.map_err(|e| sanitize(&e.to_string()))?.get(0);
    let rows = client.query(&pg_depend_query(), &[&oid]).await.map_err(|e| sanitize(&e.to_string()))?;
    Ok(rows.iter().map(|r| DependencyInfo {
        deptype: r.get(0), class: r.get(1), name: r.get::<_, String>(2),
    }).collect())
}

#[tauri::command]
pub async fn get_object_dependencies(connection_id: String, schema: String, object_type: String, name: String, state: State<'_, crate::AppState>) -> Result<Vec<DependencyInfo>, String> {
    get_object_dependencies_inner(&state.pool_manager, &connection_id, &schema, &object_type, &name).await
}

/// Build SQL for an object CRUD operation. The pool is resolved only to enforce
/// PostgreSQL-only / present-connection; the SQL itself is built by the pure
/// `crate::db::object_crud::build_ddl` dispatcher (one statement per String).
pub(crate) async fn build_object_ddl_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, kind: &str, params: serde_json::Value) -> Result<Vec<String>, String> {
    let mut pm = pm.lock().await;
    match pm.get(connection_id) {
        Some(DbHandle::Postgresql(_, _)) => build_ddl(kind, params),
        Some(_) => Err("Object management is PostgreSQL-only".into()),
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn build_object_ddl(connection_id: String, kind: String, params: serde_json::Value, state: State<'_, crate::AppState>) -> Result<Vec<String>, String> {
    build_object_ddl_inner(&state.pool_manager, &connection_id, &kind, params).await
}

/// List extensions installable on this server (`pg_available_extensions`):
/// name + default version + comment. The picker uses name/version only;
/// `schema` is left empty (available extensions are schema-wide).
pub(crate) async fn get_available_extensions_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str) -> Result<Vec<ExtensionInfo>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Extensions are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let rows = client.query(&crate::db::introspection::pg_available_extensions_query(), &[]).await.map_err(|e| sanitize(&e.to_string()))?;
    Ok(rows.iter().map(|r| ExtensionInfo {
        name: r.get(0),
        schema: String::new(),
        version: r.get(1),
        comment: r.get(2),
    }).collect())
}

#[tauri::command]
pub async fn get_available_extensions(connection_id: String, state: State<'_, crate::AppState>) -> Result<Vec<ExtensionInfo>, String> {
    get_available_extensions_inner(&state.pool_manager, &connection_id).await
}

/// Build a reorder-only table rebuild script (executed transactionally via
/// `execute_change`'s `RebuildTable` arm). Headless inner: locks the pool once,
/// validates the new column list against the live snapshot (names + types must
/// be preserved), assembles a `RebuildInput` from live introspection, and
/// delegates to `rebuild_script`.
pub(crate) async fn build_rebuild_script_inner(
    pm: &tokio::sync::Mutex<ConnectionPoolManager>,
    connection_id: &str,
    schema: &str,
    table: &str,
    new_columns: serde_json::Value,
) -> Result<String, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Rebuild is PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let new_cols: Vec<TableColumn> = serde_json::from_value(new_columns).map_err(|e| e.to_string())?;

    // 1. live columns — validate reorder-only: the (name,type) multiset must be
    //    unchanged (attribute edits belong in the diff path, not the rebuild).
    let live = client
        .query(&crate::db::introspection::pg_columns_query(schema, table), &[])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    let mut live_pairs: Vec<(String, String)> = live
        .iter()
        .map(|r| (r.get::<_, String>(0), r.get::<_, String>(1).trim().to_string()))
        .collect();
    let mut new_pairs: Vec<(String, String)> = new_cols
        .iter()
        .map(|c| (c.name.clone(), c.type_.trim().to_string()))
        .collect();
    live_pairs.sort();
    new_pairs.sort();
    if live_pairs != new_pairs {
        return Err(
            "Reorder must preserve column names and types; undo attribute changes or stage a diff"
                .into(),
        );
    }

    // 2. assemble RebuildInput from live introspection (one client, all sub-queries).
    let fk_out_rows = client
        .query(&crate::db::introspection::pg_table_fk_out_query(), &[&schema, &table])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    let fk_in_rows = client
        .query(&crate::db::introspection::pg_table_fk_in_query(), &[&schema, &table])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    let grant_rows = client
        .query(&crate::db::introspection::pg_table_grants_query(), &[&schema, &table])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    let seq_rows = client
        .query(&crate::db::introspection::pg_table_owned_sequences_query(), &[&schema, &table])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    let index_rows = client
        .query(&crate::db::introspection::pg_indexes_query(schema), &[&schema])
        .await
        .map_err(|e| sanitize(&e.to_string()))?;
    // PK/UNIQUE/CHECK (contype p/u/c) scoped to this table; FKs are carried
    // separately as fks_out/fks_in so they are not double-applied.
    let constraint_rows = client
        .query(
            "SELECT c.conname AS name, ns.nspname AS schema, cl.relname AS table_name, \
             c.contype::text, pg_get_constraintdef(c.oid) AS definition \
             FROM pg_constraint c \
             JOIN pg_class cl ON c.conrelid = cl.oid \
             JOIN pg_namespace ns ON cl.relnamespace = ns.oid \
             WHERE ns.nspname = $1 AND cl.relname = $2 AND c.contype IN ('p','u','c') \
             ORDER BY c.conname",
            &[&schema, &table],
        )
        .await
        .map_err(|e| sanitize(&e.to_string()))?;

    let input = RebuildInput {
        schema: schema.to_string(),
        name: table.to_string(),
        constraints: constraint_rows
            .iter()
            .map(|r| RebuildConstraint {
                name: r.get(0),
                definition: r.get(4),
            })
            .collect(),
        indexes: index_rows
            .iter()
            .filter(|r| r.get::<_, String>(2) == table)
            .map(|r| RebuildIndex {
                name: r.get(0),
                definition: r.get(3),
            })
            .collect(),
        fks_out: fk_out_rows
            .iter()
            .map(|r| RebuildFk {
                name: r.get(0),
                definition: r.get(1),
            })
            .collect(),
        fks_in: fk_in_rows
            .iter()
            .map(|r| RebuildFkIn {
                name: r.get(0),
                own_schema: r.get(1),
                own_table: r.get(2),
                definition: r.get(3),
            })
            .collect(),
        grants: grant_rows
            .iter()
            .map(|r| RebuildGrant {
                grantee: r.get(0),
                privileges: r.get(1),
                grantable: r.get(2),
            })
            .collect(),
        owned_sequences: seq_rows
            .iter()
            .map(|r| RebuildOwnedSequence {
                seq_schema: r.get(0),
                seq_name: r.get(1),
                column: r.get(2),
            })
            .collect(),
    };
    rebuild_script(&input, &new_cols)
}

#[tauri::command]
pub async fn build_rebuild_script(
    connection_id: String,
    schema: String,
    table: String,
    new_columns: serde_json::Value,
    state: State<'_, crate::AppState>,
) -> Result<String, String> {
    build_rebuild_script_inner(&state.pool_manager, &connection_id, &schema, &table, new_columns)
        .await
}

// ---------------------------------------------------------------------------
// Roles, privileges, rebuild readiness, tablespaces
// ---------------------------------------------------------------------------

/// List non-system roles with all attributes, memberships grouped by member role.
pub(crate) async fn get_roles_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str) -> Result<Vec<crate::models::RoleInfo>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Roles are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let roles = client.query(&crate::db::introspection::pg_roles_query(), &[]).await
        .map_err(|e| sanitize(&e.to_string()))?;
    let mems = client.query(&crate::db::introspection::pg_role_memberships_query(), &[]).await
        .map_err(|e| sanitize(&e.to_string()))?;
    let mut by_name: std::collections::HashMap<String, crate::models::RoleInfo> = std::collections::HashMap::new();
    for r in roles {
        let name: String = r.get("rolname");
        by_name.insert(name.clone(), crate::models::RoleInfo {
            name, superuser: r.get("rolsuper"), inherit: r.get("rolinherit"),
            create_db: r.get("rolcreatedb"), create_role: r.get("rolcreaterole"),
            can_login: r.get("rolcanlogin"), replication: r.get("rolreplication"),
            bypass_rls: r.get("rolbypassrls"), connection_limit: r.get("rolconnlimit"),
            valid_until: { let v: String = r.get("rolvaliduntil"); if v.is_empty() { None } else { Some(v) } },
            memberships: vec![],
        });
    }
    for m in mems {
        let member: String = m.get("member");
        if let Some(ri) = by_name.get_mut(&member) {
            ri.memberships.push(crate::models::RoleMembership {
                role: m.get("role"), member, grantor: m.get("grantor"), admin_option: m.get("admin_option"),
            });
        }
    }
    Ok(by_name.into_values().collect())
}

#[tauri::command]
pub async fn get_roles(connection_id: String, state: State<'_, crate::AppState>) -> Result<Vec<crate::models::RoleInfo>, String> {
    get_roles_inner(&state.pool_manager, &connection_id).await
}

/// All privilege grants for a role across tables, sequences, routines, schemas, and databases.
pub(crate) async fn get_role_privileges_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, role: &str) -> Result<Vec<crate::models::PrivilegeEntry>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Privileges are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    validate_object_name(role)?; // role is interpolated into the privilege queries
    let mut out: Vec<crate::models::PrivilegeEntry> = Vec::new();
    let push = |out: &mut Vec<crate::models::PrivilegeEntry>, class: &str, schema: Option<String>, name: String, privileges: Vec<String>, grantable: bool| {
        out.push(crate::models::PrivilegeEntry { object_class: class.into(), schema, name, privileges, grantable });
    };
    for row in client.query(&crate::db::introspection::pg_table_privileges_query(role), &[]).await.map_err(|e| sanitize(&e.to_string()))? {
        push(&mut out, "table", Some(row.get("schema")), row.get("name"), row.get("privileges"), row.get("grantable"));
    }
    for row in client.query(&crate::db::introspection::pg_sequence_privileges_query(role), &[]).await.map_err(|e| sanitize(&e.to_string()))? {
        push(&mut out, "sequence", Some(row.get("schema")), row.get("name"), row.get("privileges"), row.get("grantable"));
    }
    for row in client.query(&crate::db::introspection::pg_routine_privileges_query(role), &[]).await.map_err(|e| sanitize(&e.to_string()))? {
        push(&mut out, "routine", Some(row.get("schema")), row.get("name"), row.get("privileges"), row.get("grantable"));
    }
    for row in client.query(&crate::db::introspection::pg_schema_privileges_query(role), &[]).await.map_err(|e| sanitize(&e.to_string()))? {
        push(&mut out, "schema", None, row.get("name"), row.get("privileges"), row.get("grantable"));
    }
    for row in client.query(&crate::db::introspection::pg_database_privileges_query(role), &[]).await.map_err(|e| sanitize(&e.to_string()))? {
        push(&mut out, "database", None, row.get("name"), row.get("privileges"), row.get("grantable"));
    }
    Ok(out)
}

#[tauri::command]
pub async fn get_role_privileges(connection_id: String, role: String, state: State<'_, crate::AppState>) -> Result<Vec<crate::models::PrivilegeEntry>, String> {
    get_role_privileges_inner(&state.pool_manager, &connection_id, &role).await
}

/// Check whether a table can be rebuilt (no triggers, policies, inheritance, partitioning, generated columns).
pub(crate) async fn get_table_rebuild_readiness_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str, schema: &str, table: &str) -> Result<crate::models::RebuildReadiness, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Rebuild is PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let row = client.query_one(&crate::db::introspection::pg_rebuild_readiness_query(), &[&schema, &table]).await
        .map_err(|e| sanitize(&e.to_string()))?;
    let mut reasons = Vec::new();
    if row.get::<_, bool>("has_triggers") { reasons.push("table has triggers".into()); }
    if row.get::<_, bool>("has_policies") { reasons.push("table has RLS policies".into()); }
    if row.get::<_, bool>("is_inherits") { reasons.push("table participates in inheritance".into()); }
    if row.get::<_, bool>("is_partitioned") { reasons.push("table is partitioned".into()); }
    if row.get::<_, bool>("has_generated") { reasons.push("table has generated/identity columns".into()); }
    Ok(crate::models::RebuildReadiness { ok: reasons.is_empty(), reasons })
}

#[tauri::command]
pub async fn get_table_rebuild_readiness(connection_id: String, schema: String, table: String, state: State<'_, crate::AppState>) -> Result<crate::models::RebuildReadiness, String> {
    get_table_rebuild_readiness_inner(&state.pool_manager, &connection_id, &schema, &table).await
}

/// List non-system tablespaces for the table-options picker.
pub(crate) async fn get_tablespaces_inner(pm: &tokio::sync::Mutex<ConnectionPoolManager>, connection_id: &str) -> Result<Vec<crate::models::TablespaceInfo>, String> {
    let mut pm = pm.lock().await;
    let client = match pm.get(connection_id) {
        Some(DbHandle::Postgresql(c, _)) => c,
        Some(_) => return Err("Tablespaces are PostgreSQL-only".into()),
        None => return Err("Connection not found".into()),
    };
    let rows = client.query(&crate::db::introspection::pg_tablespaces_query(), &[]).await
        .map_err(|e| sanitize(&e.to_string()))?;
    Ok(rows.into_iter().map(|r| crate::models::TablespaceInfo { name: r.get("spcname") }).collect())
}

#[tauri::command]
pub async fn get_tablespaces(connection_id: String, state: State<'_, crate::AppState>) -> Result<Vec<crate::models::TablespaceInfo>, String> {
    get_tablespaces_inner(&state.pool_manager, &connection_id).await
}

#[cfg(test)]
#[path = "objects.test.rs"]
mod tests;