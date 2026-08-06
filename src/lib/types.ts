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
  // Favorite flag (v0.5.0 — pinned connection)
  favorite: boolean;
  // Whether to save the password to the OS keychain (opt-out, default ON)
  use_keychain?: boolean;
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
  ssh_password?: string | null;
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
  table_refresh_rate: number;
  table_page_size: number;
  shortcuts: Record<string, string>;
  accent_color: string;
  editor_font_size: number;
  editor_font_family: string;
  editor_word_wrap: "off" | "on";
  editor_minimap: boolean;
  editor_tab_size: number;
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
  table_type: "TABLE" | "VIEW" | "MATERIALIZED VIEW";
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
  editable: boolean;
  is_generated: boolean;
}

export interface IndexInfo {
  name: string;
  schema: string;
  table: string;
  definition: string;
  is_unique: boolean;
  method: string;
  columns: string[];
  size_bytes: number | null;
  tablespace: string | null;
}

export interface ConstraintInfo {
  name: string;
  schema: string;
  table: string;
  contype: "CHECK" | "UNIQUE" | "EXCLUSION";
  definition: string;
  deferrable: boolean;
  validated: boolean;
  columns: string[];
}

export interface RecentConnection {
  connection_id: string;
  opened_at: string;
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
  | "drop_index"
  | "bulk_insert"
  | "empty_table"
  | "rebuild_table"
  | "ddl";

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

export interface FunctionInfo {
  name: string;
  schema: string;
  return_type: string;
  argument_types: string[];
  argument_names: string[];
  argument_modes: string[];
  language: string;
  source: string | null;
  kind: string;
}

export interface TriggerInfo {
  name: string;
  schema: string;
  table_schema: string;
  table_name: string;
  event_manipulation: string;
  action_timing: string;
  action_orientation: string;
  action_statement: string;
  enabled: string;
}

export interface SequenceInfo {
  name: string;
  schema: string;
  start_value: string;
  min_value: string;
  max_value: string;
  increment: string;
  current_value: string;
  cycle: boolean;
}

export interface EnumInfo {
  name: string;
  schema: string;
  labels: string[];
}

export interface ExtensionInfo {
  name: string;
  schema: string;
  version: string;
  comment: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string | null;
  server_version?: string | null;
  latency_ms?: number | null;
}

// ─── Backup Types ────────────────────────────────────────────────

export interface BackupOptions {
  format: "plain" | "custom" | "tar" | "directory";
  filePath: string;
  schema?: string;
  tables?: string[];
  noOwner: boolean;
}

export interface RestoreOptions {
  format: string;
  filePath: string;
  clean: boolean;
  schema?: string;
}

export interface SyncOptions {
  sourceConnectionId: string;
  targetConnectionId: string;
  schema?: string;
  tables?: string[];
}

export interface PgToolStatus {
  pg_dump_found: boolean;
  pg_restore_found: boolean;
  pg_dump_version: string | null;
  pg_restore_version: string | null;
  pg_dump_source: string | null;
  pg_restore_source: string | null;
}

export type PgObjectType =
  | "table" | "view" | "materialized view" | "function" | "procedure"
  | "trigger" | "sequence" | "enum" | "extension" | "index" | "constraint";

export type ObjectType =
  | "functions"
  | "triggers"
  | "sequences"
  | "enums"
  | "extensions"
  | "indexes"
  | "constraints"
  | "procedures"
  | "roles";

export interface ObjectSearchHit {
  name: string;
  schema: string;
  object_type: string; // TABLE | VIEW | MATERIALIZED VIEW | FUNCTION | PROCEDURE | TRIGGER | SEQUENCE | ENUM | EXTENSION | INDEX | CONSTRAINT
}

export interface DependencyInfo {
  deptype: string;
  class: string;
  name: string;
}

export interface BackupJob {
  id: string;
  connection_id: string;
  type: "dump" | "restore" | "sync";
  format: string | null;
  file_path: string | null;
  source_connection_id: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  error_message: string | null;
  size_bytes: number | null;
  started_at: string;
  completed_at: string | null;
}

// ─── Roles / Privileges / Maintenance (v0.7.7) ──────────────────

export interface RoleMembership {
  role: string;
  member: string;
  grantor: string;
  admin_option: boolean;
}

export interface RoleInfo {
  name: string;
  superuser: boolean;
  inherit: boolean;
  create_db: boolean;
  create_role: boolean;
  can_login: boolean;
  replication: boolean;
  bypass_rls: boolean;
  connection_limit: number;
  valid_until: string | null;
  memberships: RoleMembership[];
}

export interface PrivilegeEntry {
  object_class: "table" | "sequence" | "routine" | "schema" | "database";
  schema: string | null;
  name: string;
  privileges: string[];
  grantable: boolean;
}

export interface RebuildReadiness {
  ok: boolean;
  reasons: string[];
}

export interface MaintenanceResult {
  duration_ms: number;
  message: string;
}

export interface TablespaceInfo {
  name: string;
}

// ─── Schema Visualizer Types ────────────────────────────────────

export interface GraphColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_fk: boolean;
  is_unique: boolean;
  is_nullable: boolean;
  /** [referenced_schema, referenced_table, referenced_column] */
  fk_ref: [string, string, string] | null;
}

export interface TableNode {
  name: string;
  schema: string;
  table_type: string;
  columns: GraphColumn[];
}

export interface Relationship {
  source_schema: string;
  source_table: string;
  source_column: string;
  target_schema: string;
  target_table: string;
  target_column: string;
  /** Inferred cardinality: "1:1" | "1:N" | "N:M" */
  cardinality: string;
}

export interface SchemaGraph {
  tables: TableNode[];
  relationships: Relationship[];
}