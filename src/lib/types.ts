export type DbType = "postgresql" | "mysql" | "sqlite" | "redis";

export type Theme = "dark" | "light" | "system";
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
  database?: string | null;
  folder_id: string | null;
  keychain_ref: string | null;
  tag_ids: string[];
  created_at: string;
  updated_at: string;
  // SSH/SSL fields (persisted, excluding secrets)
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_method?: string | null;
  ssh_private_key_path?: string | null;
  ssl_mode?: string | null;
  ssl_ca_path?: string | null;
  ssl_cert_path?: string | null;
  ssl_key_path?: string | null;
  // Environment label (production, staging, development, etc.)
  environment?: string | null;
}

export type NewConnectionMode = "simple" | "detailed";

export interface ConnectionInput {
  name: string;
  db_type: DbType;
  host: string;
  port: number | null;
  username?: string | null;
  folder_id?: string | null;
  tag_ids?: string[];
  // Form-only fields; backend may ignore them until persisted.
  connection_string?: string | null;
  environment?: string | null;
  password?: string | null;
  database?: string | null;
  use_keychain?: boolean;
  // SSH tunnel fields
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_method?: "password" | "key" | null;
  ssh_private_key_path?: string | null;
  ssh_passphrase?: string | null;
  // SSL/TLS fields
  ssl_mode?: "disable" | "require" | "verify-ca" | "verify-full" | null;
  ssl_ca_path?: string | null;
  ssl_cert_path?: string | null;
  ssl_key_path?: string | null;
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

export type ActiveView = "home" | "settings" | "new-connection" | "db-viewer";

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

// ─── DB Viewer Types ────────────────────────────────────────────

export interface TableInfo {
  name: string;
  schema: string;
  table_type: "TABLE" | "VIEW";
  columns?: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_pk: boolean;
  is_fk: boolean;
  fk_ref: [string, string] | null;
  default_value: string | null;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: unknown[][];
  total_rows: number;
  page: number;
  page_size: number;
  execution_time_ms?: number | null;
  error?: string | null;
}

export type ChangeStatus = "pending" | "applied" | "error";

export type ChangeItemType =
  | "create_table"
  | "alter_table"
  | "drop_table"
  | "insert"
  | "update"
  | "delete"
  | "create_index"
  | "drop_index";

export interface ChangeItem {
  type: ChangeItemType;
  sql: string;
  status: ChangeStatus;
  error?: string | null;
  id: string;
  description?: string | null;
}

export interface DbViewerTab {
  id: string;
  connection_id: string;
  title: string;
  query?: string | null;
  result?: QueryResult | null;
  changes?: ChangeItem[];
  created_at: string;
  updated_at: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string | null;
  server_version?: string | null;
  latency_ms?: number | null;
}