import type { TableInfo, GraphColumn } from "./types";
import { getSchemaGraph } from "./commands";

export const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "DROP",
  "ALTER",
  "ADD",
  "COLUMN",
  "PRIMARY",
  "KEY",
  "FOREIGN",
  "REFERENCES",
  "INDEX",
  "UNIQUE",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "OUTER",
  "FULL",
  "CROSS",
  "ON",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "LIMIT",
  "OFFSET",
  "ORDER",
  "BY",
  "GROUP",
  "HAVING",
  "DISTINCT",
  "UNION",
  "ALL",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "WITH",
  "RETURNING",
  "BEGIN",
  "COMMIT",
  "EXPLAIN",
  "GRANT",
  "REVOKE",
] as const;

export type SqlSuggestionKind = "keyword" | "table" | "column";

export interface SqlSuggestion {
  label: string;
  insertText: string;
  kind: SqlSuggestionKind;
}

/**
 * Parse the text before the cursor into a `table.` reference. Returns the
 * table (and optional schema qualifier) when the text ends in a dot right
 * after an identifier, e.g. `users.` or `public.users.`.
 */
export function parseTableRef(
  text: string,
): { schema: string | null; table: string } | null {
  const match = text.match(/(?:(\w+)\.)?(\w+)\.\s*$/);
  if (!match) return null;
  return { schema: match[1] ?? null, table: match[2] };
}

/**
 * Build column suggestions (used after a `table.` reference).
 */
export function buildColumnSuggestions(
  columns: { name: string }[],
): SqlSuggestion[] {
  return columns.map((c) => ({
    label: c.name,
    insertText: c.name,
    kind: "column" as const,
  }));
}

// Cache of table columns, keyed by "schema.table".
const columnCache = new Map<string, GraphColumn[]>();

/**
 * Synchronously read cached columns for a table, if the schema graph for its
 * schema has already been fetched.
 */
export function getCachedColumns(
  schema: string,
  table: string,
): GraphColumn[] | undefined {
  return columnCache.get(`${schema}.${table}`);
}

/**
 * Fetch (and cache) the columns of a table via the schema-graph introspection
 * command. Caches the whole schema in one round trip. Returns [] on error so
 * autocomplete degrades gracefully.
 */
export async function getColumnsForTable(
  connectionId: string | null,
  schema: string | null,
  table: string,
): Promise<GraphColumn[]> {
  const resolvedSchema = schema ?? "public";
  const key = `${resolvedSchema}.${table}`;
  const cached = columnCache.get(key);
  if (cached) return cached;
  if (!connectionId) return [];

  try {
    const graph = await getSchemaGraph(connectionId, resolvedSchema);
    for (const t of graph.tables) {
      columnCache.set(`${resolvedSchema}.${t.name}`, t.columns);
    }
  } catch {
    return [];
  }

  return columnCache.get(key) ?? [];
}

/**
 * Build editor suggestions for the SQL language: reserved keywords plus the
 * table names in the currently selected schema.
 */
export function buildSqlSuggestions(
  tables: TableInfo[],
  schema: string | null,
): SqlSuggestion[] {
  const keywords: SqlSuggestion[] = SQL_KEYWORDS.map((kw) => ({
    label: kw,
    insertText: kw,
    kind: "keyword",
  }));

  const tableNames = new Set(
    tables
      .filter((t) => !schema || t.schema === schema)
      .map((t) => t.name),
  );
  const tableSuggestions: SqlSuggestion[] = [...tableNames].map((name) => ({
    label: name,
    insertText: name,
    kind: "table",
  }));

  return [...keywords, ...tableSuggestions];
}