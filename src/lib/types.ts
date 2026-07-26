export type DbType = "postgresql" | "mysql" | "sqlite" | "redis";

export type Theme = "dark" | "light";
export type FontSize = "small" | "medium" | "large";

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  tag_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Connection {
  id: string;
  name: string;
  db_type: DbType;
  host: string;
  port: number | null;
  username: string | null;
  folder_id: string | null;
  keychain_ref: string | null;
  tag_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ConnectionInput {
  name: string;
  db_type: DbType;
  host: string;
  port: number | null;
  username?: string | null;
  folder_id?: string | null;
  tag_ids?: string[];
}

export interface FolderInput {
  name: string;
  parent_id: string | null;
  tag_ids?: string[];
}

export interface TagInput {
  name: string;
  color: string;
}

export interface Settings {
  confirm_before_delete: boolean;
  default_folder_id: string | null;
  theme: Theme;
  font_size: FontSize;
  default_ports: Record<string, number | null>;
  tag_order: string | null;
}

export type ActiveView = "home" | "settings" | "new-connection";

export interface FilterState {
  query: string;
  activeFolderId: string | null;
  activeTagIds: string[];
  activeDbTypes: DbType[];
}

export interface ValidationResult {
  ok: boolean;
  error: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  skippedRecords: { index: number; reason: string }[];
}