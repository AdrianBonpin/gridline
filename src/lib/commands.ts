import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionInput, ConnectionTestResult, Folder, FolderInput, Tag, TagInput, Settings, ImportResult, TableInfo, QueryResult, BackupOptions, RestoreOptions, SyncOptions, PgToolStatus, FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, SchemaGraph, IndexInfo, ConstraintInfo, RecentConnection } from "./types";
import type { FilterRule, SortRule } from "../stores/dbViewerStore";
import type { ChangePayload } from "./changePayload";

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