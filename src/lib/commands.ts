import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionInput, ConnectionTestResult, Folder, FolderInput, Tag, TagInput, Settings, ImportResult, TableInfo, QueryResult, ChangeItem } from "./types";

// NOTE on argument key naming:
// Tauri v2's #[tauri::command] macro converts Rust snake_case parameter names
// to camelCase keys on the IPC boundary. So a Rust param `connection_id` must be
// sent as `connectionId` here, `page_size` as `pageSize`, `tag_ids` as `tagIds`,
// `folder_id` as `folderId`. Single-word params (id, input, config, json, schema,
// table, page, key, value, change) are unchanged.

export async function getConnections(): Promise<Connection[]> { return invoke<Connection[]>("get_connections"); }
export async function createConnection(input: ConnectionInput): Promise<Connection> { return invoke<Connection>("create_connection", { input }); }
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
): Promise<QueryResult> {
  return invoke<QueryResult>("get_table_data", { connectionId, schema, table, page, pageSize });
}

export async function executeChange(connectionId: string, change: ChangeItem): Promise<void> {
  return invoke<void>("execute_change", { connectionId, change });
}

export async function refreshConnection(connectionId: string): Promise<void> {
  return invoke<void>("refresh_connection", { connectionId });
}