import type { TableInfo } from "./types";

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

export type SqlSuggestionKind = "keyword" | "table";

export interface SqlSuggestion {
  label: string;
  insertText: string;
  kind: SqlSuggestionKind;
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