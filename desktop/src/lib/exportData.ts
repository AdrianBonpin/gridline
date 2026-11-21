import { buildXlsx } from "./xlsx";
import { projectDeclaredCells } from "./rowIdentity";
import type { ColumnInfo } from "./types";

/**
 * The value a plain-text copy uses for NULL. Copying a NULL yields an explicit
 * uppercase marker, never an empty string that is indistinguishable from `''`.
 */
export const NULL_MARKER = "NULL";

/** Markdown's NULL marker: explicit, but visually distinct from a cell whose
 *  text really is `NULL`. */
const MD_NULL = "*NULL*";

/** Quote one CSV cell with formula-injection protection — mirrors the Rust
 *  `csv_cell` from the streaming export byte-for-byte. A CSV file has no null
 *  literal, so NULL is an empty cell (as RFC 4180/Excel expect). Copy surfaces
 *  use `csvCopyCell` instead, which marks NULL explicitly. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[,"\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** One cell of a clipboard-copied CSV row: identical quoting to an export,
 *  but a NULL is the explicit marker rather than an empty cell. */
export function csvCopyCell(value: unknown): string {
  return csvCell(copyCellText(value));
}

/**
 * Plain-text form of one cell for the clipboard. NULL is an explicit uppercase
 * marker; a decoded json/jsonb value keeps its structure instead of becoming
 * `[object Object]`.
 */
export function copyCellText(value: unknown): string {
  if (value === null || value === undefined) return NULL_MARKER;
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value) ?? NULL_MARKER;
  return String(value);
}

/** SQL selecting every row of a table, dialect-quoted. */
export function qualifiedTableSql(dbType: string, schema: string, table: string): string {
  if (dbType === "mysql" || dbType === "mariadb") {
    const q = (s: string) => s.replace(/`/g, "``");
    return `SELECT * FROM \`${q(schema)}\`.\`${q(table)}\``;
  }
  const q = (s: string) => s.replace(/"/g, '""');
  return `SELECT * FROM "${q(schema)}"."${q(table)}"`;
}

function isMySql(dbType: string | undefined): boolean {
  return dbType === "mysql" || dbType === "mariadb";
}

/**
 * One SQL identifier, quoted for the engine that will replay the statement.
 * Quoting is unconditional: a legal name can be a reserved word, contain a
 * space, a dot, or a quote, and exported SQL must replay as written.
 */
export function quoteIdentifier(name: string, dbType?: string): string {
  if (isMySql(dbType)) return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** A (optionally schema-qualified) SQL identifier. */
export function qualifiedNameSql(
  dbType: string | undefined,
  schema: string | undefined,
  table: string,
): string {
  return schema
    ? `${quoteIdentifier(schema, dbType)}.${quoteIdentifier(table, dbType)}`
    : quoteIdentifier(table, dbType);
}

/**
 * One SQL string literal.
 *
 * PostgreSQL's standard_conforming_strings makes a backslash literal; MySQL and
 * MariaDB interpret backslash escapes by default, so a backslash is doubled —
 * otherwise a value containing `\` would swallow the closing quote (or the next
 * character) and the statement would not replay. Single quotes are doubled for
 * both.
 */
export function sqlStringLiteral(value: string, dbType?: string): string {
  let body = value;
  if (isMySql(dbType)) {
    body = body
      .replace(/\\/g, "\\\\")
      .replace(/\u0000/g, "\\0")
      .replace(/\u001a/g, "\\Z");
  }
  return `'${body.replace(/'/g, "''")}'`;
}

/** One SQL value literal, preserving the value's type. */
export function sqlLiteral(value: unknown, dbType?: string): string {
  if (value === null || value === undefined) return "NULL";
  switch (typeof value) {
    case "number":
      // NaN/Infinity have no bare literal; the quoted form is what PostgreSQL
      // accepts for a non-finite numeric, and it keeps the statement parseable.
      return Number.isFinite(value) ? String(value) : sqlStringLiteral(String(value), dbType);
    case "bigint":
      return String(value);
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "string":
      return sqlStringLiteral(value, dbType);
    default:
      // A decoded json/jsonb value: its JSON text is the literal.
      return sqlStringLiteral(JSON.stringify(value) ?? "", dbType);
  }
}

/** Escape one Markdown table cell: a raw `|` would end the cell and a newline
 *  would end the row, so both are represented explicitly. */
export function mdCellText(value: unknown): string {
  if (value === null || value === undefined) return MD_NULL;
  return mdEscape(copyCellText(value));
}

function mdEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n?|\n/g, "<br>");
}

/** Options that make exported SQL replayable against the right object. */
export interface ExportOptions {
  /** Schema qualifying the exported INSERT; omitted = unqualified name. */
  schema?: string;
  /** Engine that will replay the SQL — decides identifier and literal quoting. */
  dbType?: string;
}

export interface SerializedExport {
  data: Uint8Array;
  mime: string;
  /** Download extension, without the dot. */
  extension: string;
}

const TEXT_MIME: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  sql: "application/sql",
  md: "text/markdown",
};

/**
 * Serialize rows for one export format. Every writer projects the declared
 * columns only (`projectDeclaredCells`), so a backend row locator — appended to
 * a no-PK row and never a declared column — cannot reach the output.
 *
 * Returns `null` for a format that is not supported.
 */
export function serializeExport(
  rows: unknown[][],
  columns: ColumnInfo[],
  format: string,
  tableName: string,
  options: ExportOptions = {},
): SerializedExport | null {
  const headers = columns.map((c) => c.name);
  let content: string;
  let mime: string;

  switch (format) {
    case "xlsx":
      return {
        data: buildXlsx(rows, columns),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      };
    case "json": {
      const jsonRows = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        projectDeclaredCells(row, columns).forEach((cell, i) => {
          obj[headers[i]] = cell ?? null;
        });
        return obj;
      });
      content = JSON.stringify(jsonRows, null, 2);
      mime = TEXT_MIME.json;
      break;
    }
    case "csv": {
      const csvRows = [headers.map((h) => csvCell(h)).join(",")];
      for (const row of rows) {
        csvRows.push(
          projectDeclaredCells(row, columns).map((cell) => csvCell(cell)).join(","),
        );
      }
      content = csvRows.join("\n");
      mime = TEXT_MIME.csv;
      break;
    }
    case "sql": {
      const target = qualifiedNameSql(options.dbType, options.schema, tableName);
      // The comment is decorative: keep it on one line even for a name that
      // itself contains a line break (the quoted identifiers below stay exact).
      const label = options.schema ? `${options.schema}.${tableName}` : tableName;
      const lines = [`-- ${label.replace(/[\r\n]+/g, " ")}`];
      const columnList = headers.map((h) => quoteIdentifier(h, options.dbType)).join(", ");
      for (const row of rows) {
        const vals = projectDeclaredCells(row, columns).map((cell) =>
          sqlLiteral(cell, options.dbType),
        );
        lines.push(`INSERT INTO ${target} (${columnList}) VALUES (${vals.join(", ")});`);
      }
      content = lines.join("\n");
      mime = TEXT_MIME.sql;
      break;
    }
    case "md": {
      const mdRows = [
        `| ${headers.map((h) => mdEscape(h)).join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
      ];
      for (const row of rows) {
        mdRows.push(
          `| ${projectDeclaredCells(row, columns).map((cell) => mdCellText(cell)).join(" | ")} |`,
        );
      }
      content = mdRows.join("\n");
      mime = TEXT_MIME.md;
      break;
    }
    default:
      return null;
  }

  return { data: new TextEncoder().encode(content), mime, extension: format };
}

export function exportData(
  rows: unknown[][],
  columns: ColumnInfo[],
  format: string,
  tableName: string,
  options: ExportOptions = {},
) {
  const out = serializeExport(rows, columns, format, tableName, options);
  if (!out) return;
  const blob = new Blob([out.data], { type: out.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${options.schema ? `${options.schema}.` : ""}${tableName}.${out.extension}`;
  a.click();
  URL.revokeObjectURL(url);
}
