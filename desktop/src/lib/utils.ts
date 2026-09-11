import type {
  Connection,
  DbType,
  Folder,
  Tag,
  ConnectionInput,
  FolderInput,
  TagInput,
  ValidationResult,
} from "./types";

// ─── Data type abbreviations ─────────────────────────────

const TYPE_ABBREV: Record<string, string> = {
  "integer": "int",
  "bigint": "int8",
  "smallint": "int2",
  "character varying": "varchar",
  "character": "char",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  "time with time zone": "timetz",
  "time without time zone": "time",
  "boolean": "bool",
  "double precision": "float8",
  "real": "float4",
};

export function abbreviateType(dataType: string): string {
  const lower = dataType.toLowerCase();
  return TYPE_ABBREV[lower] ?? dataType;
}

const VALID_DB_TYPES: DbType[] = ["postgresql", "mysql", "mariadb", "sqlite", "redis"];

export function validateConnectionInput(input: ConnectionInput): ValidationResult {
  if (!input.name || input.name.length === 0) return { ok: false, error: "name is required" };
  if (input.name.length > 100) return { ok: false, error: "name must be 100 chars or fewer" };
  if (!VALID_DB_TYPES.includes(input.db_type))
    return { ok: false, error: `db_type must be one of: ${VALID_DB_TYPES.join(", ")}` };
  if (!input.host || input.host.length === 0) return { ok: false, error: "host is required" };
  if (input.host.length > 255) return { ok: false, error: "host must be 255 chars or fewer" };
  if (input.db_type !== "sqlite") {
    if (input.port === null || input.port === undefined)
      return { ok: false, error: "port is required for this db_type" };
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      return { ok: false, error: "port must be an integer between 1 and 65535" };
  }
  if (input.username && input.username.length > 100)
    return { ok: false, error: "username must be 100 chars or fewer" };

  // SSH tunnel validation
  if (input.ssh_host && input.ssh_host.length > 255)
    return { ok: false, error: "SSH host must be 255 chars or fewer" };
  if (input.ssh_port !== undefined && input.ssh_port !== null) {
    if (!Number.isInteger(input.ssh_port) || input.ssh_port < 1 || input.ssh_port > 65535)
      return { ok: false, error: "SSH port must be between 1 and 65535" };
  }
  if (input.ssh_user && input.ssh_user.length > 100)
    return { ok: false, error: "SSH user must be 100 chars or fewer" };

  // SSL/TLS validation
  if (input.ssl_mode && !["disable", "require", "verify-ca", "verify-full"].includes(input.ssl_mode))
    return { ok: false, error: "SSL mode must be one of: disable, require, verify-ca, verify-full" };

  return { ok: true, error: "" };
}

export function validateFolderInput(input: FolderInput): ValidationResult {
  if (!input.name || input.name.length === 0) return { ok: false, error: "name is required" };
  if (input.name.length > 100) return { ok: false, error: "name must be 100 chars or fewer" };
  return { ok: true, error: "" };
}

export function validateTagInput(input: TagInput): ValidationResult {
  if (!input.name || input.name.length === 0) return { ok: false, error: "name is required" };
  if (input.name.length > 50) return { ok: false, error: "name must be 50 chars or fewer" };
  return { ok: true, error: "" };
}

export function getDescendantFolderIds(folders: Folder[], rootId: string): string[] {
  const result = [rootId];
  const children = folders.filter((f) => f.parent_id === rootId);
  for (const child of children) {
    result.push(...getDescendantFolderIds(folders, child.id));
  }
  return result;
}

export function getFolderPath(folders: Folder[], folderId: string | null): Folder[] {
  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  let current: Folder | undefined = folderId ? folderMap.get(folderId) : undefined;
  while (current) {
    path.unshift(current);
    current = current.parent_id ? folderMap.get(current.parent_id) : undefined;
  }
  return path;
}

export function getFolderPathLabel(folders: Folder[], folderId: string | null): string {
  if (folderId === null) return "Root";
  const path = getFolderPath(folders, folderId);
  if (path.length === 0) return "Root";
  return path.map((f) => f.name).join(" → ");
}

export function getChildFolders(folders: Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parent_id === parentId);
}

export function filterConnections(
  connections: Connection[],
  tags: Tag[],
  filter: {
    query: string;
    activeTagIds?: string[];
    activeDbTypes?: DbType[];
    activeEnvironment?: string | null;
  },
): Connection[] {
  const q = filter.query.trim().toLowerCase();
  const tagIds = filter.activeTagIds ?? [];
  const dbTypes = filter.activeDbTypes ?? [];
  const activeEnvironment = filter.activeEnvironment;
  const tagNameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));

  return connections.filter((c) => {
    if (dbTypes.length > 0 && !dbTypes.includes(c.db_type)) return false;
    if (tagIds.length > 0 && !tagIds.some((id) => c.tag_ids.includes(id))) return false;
    if (activeEnvironment !== undefined && activeEnvironment !== null && activeEnvironment !== "") {
      if (activeEnvironment === "none") {
        if (c.environment) return false;
      } else if (c.environment !== activeEnvironment) {
        return false;
      }
    }
    if (q.length > 0) {
      const tagNames = c.tag_ids.map((id) => tagNameById.get(id) ?? "").join(" ");
      const haystack = `${c.name} ${c.host} ${c.db_type} ${tagNames}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

const DESTRUCTIVE_KEYWORDS = new Set([
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER",
  "TRUNCATE", "CREATE", "REPLACE",
]);

/**
 * Return the first significant keyword of `sql` (uppercased) after stripping
 * comments and collapsing whitespace, or null when there is none.
 */
export function firstSignificantKeyword(sql: string): string | null {
  // Strip block comments  /* ... */
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip line comments  -- ...
  stripped = stripped.replace(/--[^\n]*/g, " ");
  // Collapse whitespace
  const tokens = stripped.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0].length === 0) return null;
  return tokens[0].toUpperCase();
}

/**
 * Detect whether `sql` is a data-modifying statement by checking the
 * first significant keyword after stripping comments and whitespace.
 *
 * This is a UX safety net, not a security boundary.  The user is already
 * authenticated to their own database — the confirmation dialog prevents
 * accidental data loss, not malicious access.
 */
export function isDestructiveQuery(sql: string): boolean {
  const first = firstSignificantKeyword(sql);
  return first !== null && DESTRUCTIVE_KEYWORDS.has(first);
}

const SCHEMA_MODIFYING_KEYWORDS = new Set([
  "CREATE", "DROP", "ALTER", "TRUNCATE",
]);

/**
 * Detect whether `sql` changes the database schema (DDL) by checking the
 * first significant keyword.  Used to auto-refresh the schema tree after a
 * successful query run.
 */
export function isSchemaModifyingQuery(sql: string): boolean {
  const k = firstSignificantKeyword(sql);
  return k !== null && SCHEMA_MODIFYING_KEYWORDS.has(k);
}

/**
 * Pick the smart default schema for a freshly loaded database.
 *
 * Prefers conventional schemas (`public` for PostgreSQL, `main` for SQLite)
 * and otherwise falls back to the first schema returned by the backend
 * (which already excludes system schemas and is ordered alphabetically).
 */
export function pickDefaultSchema(schemas: string[]): string | null {
  if (schemas.length === 0) return null;
  for (const preferred of ["public", "main"]) {
    if (schemas.includes(preferred)) return preferred;
  }
  return schemas[0];
}