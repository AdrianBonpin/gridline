import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionInput, ConnectionTestResult, Folder, FolderInput, Tag, TagInput, Settings, ImportResult, TableInfo, QueryResult, ChangeItem } from "./types";

export async function getConnections(): Promise<Connection[]> { return invoke<Connection[]>("get_connections"); }
export async function createConnection(input: ConnectionInput): Promise<Connection> { return invoke<Connection>("create_connection", { input }); }
export async function deleteConnection(id: string): Promise<void> { return invoke<void>("delete_connection", { id }); }
export async function addConnectionTags(connectionId: string, tagIds: string[]): Promise<void> { return invoke<void>("add_connection_tags", { connection_id: connectionId, tag_ids: tagIds }); }
export async function getFolders(): Promise<Folder[]> { return invoke<Folder[]>("get_folders"); }
export async function createFolder(input: FolderInput): Promise<Folder> { return invoke<Folder>("create_folder", { input }); }
export async function updateFolder(id: string, input: FolderInput): Promise<Folder> { return invoke<Folder>("update_folder", { id, input }); }
export async function deleteFolder(id: string): Promise<void> { return invoke<void>("delete_folder", { id }); }
export async function addFolderTags(folderId: string, tagIds: string[]): Promise<void> { return invoke<void>("add_folder_tags", { folder_id: folderId, tag_ids: tagIds }); }
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

// ─── DB Viewer Lifecycle ────────────────────────────────────────
// NOTE: Tauri v2 matches invoke() argument keys to the Rust function
// parameter names case-sensitively. The Rust commands use snake_case
// (connection_id, config, page_size, ...), so the keys here must too.

export async function dbConnect(connectionId: string, input: ConnectionInput): Promise<void> {
  return invoke<void>("db_connect", { connection_id: connectionId, config: input });
}

export async function dbDisconnect(connectionId: string): Promise<void> {
  return invoke<void>("db_disconnect", { connection_id: connectionId });
}

export async function getDatabases(connectionId: string): Promise<string[]> {
  return invoke<string[]>("get_databases", { connection_id: connectionId });
}

export async function getSchemas(connectionId: string): Promise<string[]> {
  return invoke<string[]>("get_schemas", { connection_id: connectionId });
}

export async function getTables(connectionId: string, schema?: string): Promise<TableInfo[]> {
  return invoke<TableInfo[]>("get_tables", { connection_id: connectionId, schema });
}

export async function getTableData(
  connectionId: string,
  schema: string,
  table: string,
  page?: number,
  pageSize?: number,
): Promise<QueryResult> {
  return invoke<QueryResult>("get_table_data", {
    connection_id: connectionId,
    schema,
    table,
    page,
    page_size: pageSize,
  });
}

export async function executeChange(connectionId: string, change: ChangeItem): Promise<void> {
  return invoke<void>("execute_change", { connection_id: connectionId, change });
}

export async function refreshConnection(connectionId: string): Promise<void> {
  return invoke<void>("refresh_connection", { connection_id: connectionId });
}