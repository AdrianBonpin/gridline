import { invoke } from "@tauri-apps/api/core";
import type { Connection, ConnectionInput, Folder, FolderInput, Tag, TagInput, Settings, ImportResult } from "./types";

export async function getConnections(): Promise<Connection[]> { return invoke<Connection[]>("get_connections"); }
export async function createConnection(input: ConnectionInput): Promise<Connection> { return invoke<Connection>("create_connection", { input }); }
export async function deleteConnection(id: string): Promise<void> { return invoke<void>("delete_connection", { id }); }
export async function getFolders(): Promise<Folder[]> { return invoke<Folder[]>("get_folders"); }
export async function createFolder(input: FolderInput): Promise<Folder> { return invoke<Folder>("create_folder", { input }); }
export async function deleteFolder(id: string): Promise<void> { return invoke<void>("delete_folder", { id }); }
export async function getTags(): Promise<Tag[]> { return invoke<Tag[]>("get_tags"); }
export async function createTag(input: TagInput): Promise<Tag> { return invoke<Tag>("create_tag", { input }); }
export async function deleteTag(id: string): Promise<void> { return invoke<void>("delete_tag", { id }); }
export async function getSettings(): Promise<Settings> { return invoke<Settings>("get_settings"); }
export async function updateSetting(key: string, value: string): Promise<void> { return invoke<void>("update_setting", { key, value }); }
export async function importConnections(json: string): Promise<ImportResult> { return invoke<ImportResult>("import_connections", { json }); }
export async function exportConnections(): Promise<string> { return invoke<string>("export_connections"); }