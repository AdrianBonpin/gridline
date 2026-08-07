import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionInput, ConnectionTestResult, Folder, FolderInput, Tag, TagInput, Settings, ImportResult, TableInfo, QueryResult, BackupOptions, RestoreOptions, SyncOptions, PgToolStatus, MySqlToolStatus, MySqlBackupOptions, MySqlRestoreOptions, SqliteBackupOptions, SqliteRestoreOptions, FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, SchemaGraph, IndexInfo, ConstraintInfo, RecentConnection, ObjectSearchHit, DependencyInfo, RoleInfo, PrivilegeEntry, RebuildReadiness, MaintenanceResult, TablespaceInfo, ColumnInfo } from "./types";
import type { FilterRule, SortRule } from "../stores/dbViewerStore";
import type { ChangePayload } from "./changePayload";
import { buildObjectDdl as buildObjectDdlImpl, type ObjectKind, type DdlParams } from "./objectCrud";

export { type ObjectKind, type DdlParams };

/** Build one or more SQL statements for an object CRUD operation. */
export function buildObjectDdl(connectionId: string, kind: ObjectKind, params: DdlParams): Promise<string[]> {
  return buildObjectDdlImpl(connectionId, kind, params);
}

// NOTE on argument key naming:
// Tauri v2's #[tauri::command] macro converts Rust snake_case parameter names
// to camelCase keys on the IPC boundary. So a Rust param `connection_id` must be
// sent as `connectionId` here, `page_size` as `pageSize`, `tag_ids` as `tagIds`,
// `folder_id` as `folderId`. Single-word params (id, input, config, json, schema,
// table, page, key, value, change) are unchanged.

export async function getConnections(): Promise<Connection[]> { return invoke<Connection[]>("get_connections"); }
export async function createConnection(input: ConnectionInput): Promise<Connection> { return invoke<Connection>("create_connection", { input }); }
export async function updateConnection(id: string, input: ConnectionInput): Promise<Connection> { return invoke<Connection>("update_connection", { id, input }); }
export async function deleteConnection(id: string): Promise<void> { return invoke<void>("delete_connection", { id }); }
export async function addConnectionTags(connectionId: string, tagIds: string[]): Promise<void> { return invoke<void>("add_connection_tags", { connectionId, tagIds }); }
export async function getFolders(): Promise<Folder[]> { return invoke<Folder[]>("get_folders"); }
export async function createFolder(input: FolderInput): Promise<Folder> { return invoke<Folder>("create_folder", { input }); }
export async function updateFolder(id: string, input: FolderInput): Promise<Folder> { return invoke<Folder>("update_folder", { id, input }); }
export async function deleteFolder(id: string): Promise<void> { return invoke<void>("delete_folder", { id }); }
export async function addFolderTags(folderId: string, tagIds: string[]): Promise<void> { return invoke<void>("add_folder_tags", { folderId, tagIds }); }
export async function getTags(): Promise<Tag[]> { return invoke<Tag[]>("get_tags"); }
export async function createTag(input: TagInput): Promise<Tag> { return invoke<Tag>("create_tag", { input }); }
export async function deleteTag(id: string): Promise<void> { return invoke<void>("delete_tag", { id }); }
export async function updateTag(id: string, input: TagInput): Promise<Tag> { return invoke<Tag>("update_tag", { id, input }); }
export async function getSettings(): Promise<Settings> { return invoke<Settings>("get_settings"); }
export async function updateSetting(key: string, value: string): Promise<void> { return invoke<void>("update_setting", { key, value }); }
export async function importConnections(json: string): Promise<ImportResult> { return invoke<ImportResult>("import_connections", { json }); }
export async function exportConnections(): Promise<string> { return invoke<string>("export_connections"); }
export async function testConnection(input: ConnectionInput): Promise<ConnectionTestResult> {
  return invoke<ConnectionTestResult>("test_connection", { config: input });
}

// ─── Keychain ──────────────────────────────────────────────────

export async function saveConnectionPassword(connectionId: string, password: string): Promise<void> {
  return invoke<void>("save_connection_password", { connectionId, password });
}

export async function getConnectionPassword(connectionId: string): Promise<string | null> {
  return invoke<string | null>("get_connection_password", { connectionId });
}

export async function deleteConnectionPassword(connectionId: string): Promise<void> {
  return invoke<void>("delete_connection_password", { connectionId });
}

// ─── Keychain: SSH secrets ────────────────────────────────────

export async function saveConnectionSshPassword(connectionId: string, password: string): Promise<void> {
  return invoke<void>("save_connection_ssh_password", { connectionId, password });
}

export async function getConnectionSshPassword(connectionId: string): Promise<string | null> {
  return invoke<string | null>("get_connection_ssh_password", { connectionId });
}

export async function deleteConnectionSshPassword(connectionId: string): Promise<void> {
  return invoke<void>("delete_connection_ssh_password", { connectionId });
}

export async function saveConnectionSshPassphrase(connectionId: string, passphrase: string): Promise<void> {
  return invoke<void>("save_connection_ssh_passphrase", { connectionId, passphrase });
}

export async function getConnectionSshPassphrase(connectionId: string): Promise<string | null> {
  return invoke<string | null>("get_connection_ssh_passphrase", { connectionId });
}

export async function deleteConnectionSshPassphrase(connectionId: string): Promise<void> {
  return invoke<void>("delete_connection_ssh_passphrase", { connectionId });
}

export async function recreateDemoDb(): Promise<string> {
  return invoke<string>("recreate_demo_db");
}

export async function regenerateDemoDb(): Promise<string> {
  return invoke<string>("regenerate_demo_db");
}

// ─── DB Viewer Lifecycle ────────────────────────────────────────

export async function dbConnect(connectionId: string, input: ConnectionInput): Promise<void> {
  return invoke<void>("db_connect", { connectionId, config: input });
}

export async function dbDisconnect(connectionId: string): Promise<void> {
  return invoke<void>("db_disconnect", { connectionId });
}

export async function getDatabases(connectionId: string): Promise<string[]> {
  return invoke<string[]>("get_databases", { connectionId });
}

export async function getSchemas(connectionId: string): Promise<string[]> {
  return invoke<string[]>("get_schemas", { connectionId });
}

export async function getTables(connectionId: string, schema?: string): Promise<TableInfo[]> {
  return invoke<TableInfo[]>("get_tables", { connectionId, schema });
}

export async function getTableData(
  connectionId: string,
  schema: string,
  table: string,
  page?: number,
  pageSize?: number,
  filters?: FilterRule[],
  sorts?: SortRule[],
): Promise<QueryResult> {
  return invoke<QueryResult>("get_table_data", { connectionId, schema, table, page, pageSize, filters, sorts });
}

export async function executeChange(connectionId: string, change: ChangePayload): Promise<void> {
  return invoke<void>("execute_change", { connectionId, change });
}

export async function getTableDdl(connectionId: string, schema: string, table: string): Promise<string> {
  return invoke<string>("get_table_ddl", { connectionId, schema, table });
}

export async function getFkPreview(
  connectionId: string,
  schema: string,
  table: string,
  column: string,
  value: string,
): Promise<QueryResult> {
  return invoke<QueryResult>("get_fk_preview", { connectionId, schema, table, column, value });
}

export async function refreshConnection(connectionId: string): Promise<void> {
  return invoke<void>("refresh_connection", { connectionId });
}

// ─── Backup / Restore / Sync ──────────────────────────────────

export async function detectPgTools(): Promise<PgToolStatus> {
  return invoke<PgToolStatus>("detect_pg_tools");
}

export async function pgDump(connectionId: string, options: BackupOptions): Promise<string> {
  return invoke<string>("pg_dump", { connectionId, options });
}

export async function pgRestore(connectionId: string, options: RestoreOptions): Promise<string> {
  return invoke<string>("pg_restore", { connectionId, options });
}

export async function dbSync(options: SyncOptions): Promise<string> {
  return invoke<string>("db_sync", { options });
}

// ─── v0.7.8: Cancel / MySQL / SQLite / Settings export-import ────

export async function cancelQuery(connectionId: string): Promise<void> {
  return invoke<void>("cancel_query", { connectionId });
}

export async function detectMysqlTools(): Promise<MySqlToolStatus> {
  return invoke<MySqlToolStatus>("detect_mysql_tools");
}

export async function mysqlDump(connectionId: string, options: MySqlBackupOptions): Promise<string> {
  return invoke<string>("mysql_dump", { connectionId, options });
}

export async function mysqlRestore(connectionId: string, options: MySqlRestoreOptions): Promise<string> {
  return invoke<string>("mysql_restore", { connectionId, options });
}

export async function mysqlSync(options: SyncOptions): Promise<string> {
  return invoke<string>("mysql_sync", { options });
}

export async function sqliteDump(connectionId: string, options: SqliteBackupOptions): Promise<string> {
  return invoke<string>("sqlite_dump", { connectionId, options });
}

export async function sqliteRestore(connectionId: string, options: SqliteRestoreOptions): Promise<string> {
  return invoke<string>("sqlite_restore", { connectionId, options });
}

export async function sqliteSync(options: SyncOptions): Promise<string> {
  return invoke<string>("sqlite_sync", { options });
}

export async function exportSettings(): Promise<string> {
  return invoke<string>("export_settings");
}

export async function importSettings(json: string): Promise<void> {
  return invoke<void>("import_settings", { json });
}

// ─── Object Explorer (Functions, Triggers, Sequences, Enums, Extensions) ────

export async function getFunctions(connectionId: string, schema?: string): Promise<FunctionInfo[]> {
  return invoke<FunctionInfo[]>("get_functions", { connectionId, schema });
}

export async function getTriggers(connectionId: string, schema?: string): Promise<TriggerInfo[]> {
  return invoke<TriggerInfo[]>("get_triggers", { connectionId, schema });
}

export async function getSequences(connectionId: string, schema?: string): Promise<SequenceInfo[]> {
  return invoke<SequenceInfo[]>("get_sequences", { connectionId, schema });
}

export async function getEnums(connectionId: string, schema?: string): Promise<EnumInfo[]> {
  return invoke<EnumInfo[]>("get_enums", { connectionId, schema });
}

export async function getExtensions(connectionId: string): Promise<ExtensionInfo[]> {
  return invoke<ExtensionInfo[]>("get_extensions", { connectionId });
}

export async function getSchemaGraph(
  connectionId: string,
  schema?: string,
): Promise<SchemaGraph> {
  return invoke<SchemaGraph>("get_schema_graph", { connectionId, schema });
}

// ─── Query History ──────────────────────────────────────────────

export interface QueryHistoryEntry {
  id: string;
  connection_id: string;
  query_text: string;
  execution_time_ms: number | null;
  row_count: number | null;
  status: string;
  error_message: string | null;
  executed_at: string;
  favorite: boolean; // NEW — v6
}

export interface SavedQuery {
  id: string;
  connection_id: string | null;
  name: string;
  query_text: string;
  folder: string;
  created_at: string;
  updated_at: string;
}

export interface SaveQueryInput {
  connectionId: string | null;
  name: string;
  queryText: string;
  folder: string;
}

export interface UpdateSavedQueryPatch {
  name?: string;
  queryText?: string;
  folder?: string;
}

export async function executeQuery(
  connectionId: string,
  query: string,
  page: number,
  pageSize: number,
): Promise<QueryResult> {
  return invoke<QueryResult>("execute_query", { connectionId, query, page, pageSize });
}

export async function getQueryHistory(
  connectionId: string | null,
  limit: number,
  offset: number,
): Promise<QueryHistoryEntry[]> {
  return invoke<QueryHistoryEntry[]>("get_query_history", { connectionId, limit, offset });
}

export async function clearQueryHistory(connectionId: string | null): Promise<void> {
  return invoke<void>("clear_query_history", { connectionId });
}

export async function setHistoryFavorite(
  id: string,
  connectionId: string,
): Promise<void> {
  return invoke<void>("set_history_favorite", { id, connectionId });
}

export async function saveQuery(input: SaveQueryInput): Promise<SavedQuery> {
  return invoke<SavedQuery>("save_query", {
    connectionId: input.connectionId,
    name: input.name,
    queryText: input.queryText,
    folder: input.folder,
  });
}

export async function getSavedQueries(
  connectionId: string | null,
): Promise<SavedQuery[]> {
  return invoke<SavedQuery[]>("get_saved_queries", { connectionId });
}

export async function updateSavedQuery(
  id: string,
  patch: UpdateSavedQueryPatch,
): Promise<void> {
  return invoke<void>("update_saved_query", { id, patch });
}

export async function deleteSavedQuery(id: string): Promise<void> {
  return invoke<void>("delete_saved_query", { id });
}

// ─── v0.5.0: Favorites / Recents / Indexes / Constraints ──────────

export async function setConnectionFavorite(connectionId: string, favorite: boolean): Promise<void> {
  return invoke<void>("set_connection_favorite", { connectionId, favorite });
}

export async function recordRecentConnection(connectionId: string): Promise<void> {
  return invoke<void>("record_recent_connection", { connectionId });
}

export async function getRecentConnections(limit: number): Promise<RecentConnection[]> {
  return invoke<RecentConnection[]>("get_recent_connections", { limit });
}

export async function clearRecentConnections(): Promise<void> {
  return invoke<void>("clear_recent_connections", {});
}

export async function getIndexes(connectionId: string, schema?: string): Promise<IndexInfo[]> {
  return invoke<IndexInfo[]>("get_indexes", { connectionId, schema });
}

export async function getConstraints(connectionId: string, schema?: string): Promise<ConstraintInfo[]> {
  return invoke<ConstraintInfo[]>("get_constraints", { connectionId, schema });
}

// ─── v0.7.5: Object management (schemas, search, DDL, dependencies) ──

export async function createSchema(connectionId: string, name: string): Promise<void> {
  return invoke<void>("create_schema", { connectionId, name });
}
export async function renameSchema(connectionId: string, oldName: string, newName: string): Promise<void> {
  return invoke<void>("rename_schema", { connectionId, oldName, newName });
}
export async function dropSchema(connectionId: string, name: string, cascade: boolean): Promise<void> {
  return invoke<void>("drop_schema", { connectionId, name, cascade });
}
export async function searchObjects(connectionId: string, schema: string, query: string): Promise<ObjectSearchHit[]> {
  return invoke<ObjectSearchHit[]>("search_objects", { connectionId, schema, query });
}
export async function getObjectDdl(connectionId: string, schema: string, objectType: string, name: string): Promise<string> {
  return invoke<string>("get_object_ddl", { connectionId, schema, objectType, name });
}
export async function getObjectDependencies(connectionId: string, schema: string, objectType: string, name: string): Promise<DependencyInfo[]> {
  return invoke<DependencyInfo[]>("get_object_dependencies", { connectionId, schema, objectType, name });
}

// ─── v0.7.7: Roles / privileges / rebuild / maintenance ──────────

export async function getRoles(connectionId: string): Promise<RoleInfo[]> {
  return invoke<RoleInfo[]>("get_roles", { connectionId });
}
export async function getRolePrivileges(connectionId: string, role: string): Promise<PrivilegeEntry[]> {
  return invoke<PrivilegeEntry[]>("get_role_privileges", { connectionId, role });
}
export async function getTableColumns(connectionId: string, schema: string, table: string): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("get_table_columns", { connectionId, schema, table });
}
export async function getTableRebuildReadiness(connectionId: string, schema: string, table: string): Promise<RebuildReadiness> {
  return invoke<RebuildReadiness>("get_table_rebuild_readiness", { connectionId, schema, table });
}
export async function runMaintenance(connectionId: string, schema: string, table: string, action: "vacuum" | "analyze" | "reindex"): Promise<MaintenanceResult> {
  return invoke<MaintenanceResult>("run_maintenance", { connectionId, schema, table, action });
}
export async function getTablespaces(connectionId: string): Promise<TablespaceInfo[]> {
  return invoke<TablespaceInfo[]>("get_tablespaces", { connectionId });
}
export async function buildRebuildScript<C extends { name: string; type: string; nullable: boolean; default: string | null; is_pk: boolean }[]>(connectionId: string, schema: string, table: string, newColumns: C): Promise<string> {
  return invoke<string>("build_rebuild_script", { connectionId, schema, table, newColumns });
}