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

const VALID_DB_TYPES: DbType[] = ["postgresql", "mysql", "sqlite", "redis"];

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

export function filterConnections(
  connections: Connection[],
  tags: Tag[],
  filter: { query: string; activeTagIds?: string[]; activeDbTypes?: DbType[] },
): Connection[] {
  const q = filter.query.trim().toLowerCase();
  const tagIds = filter.activeTagIds ?? [];
  const dbTypes = filter.activeDbTypes ?? [];
  const tagNameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));

  return connections.filter((c) => {
    if (dbTypes.length > 0 && !dbTypes.includes(c.db_type)) return false;
    if (tagIds.length > 0 && !tagIds.every((id) => c.tag_ids.includes(id))) return false;
    if (q.length > 0) {
      const tagNames = c.tag_ids.map((id) => tagNameById.get(id) ?? "").join(" ");
      const haystack = `${c.name} ${c.host} ${c.db_type} ${tagNames}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}