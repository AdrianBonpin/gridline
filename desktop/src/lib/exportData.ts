import { buildXlsx } from "./xlsx";
import type { ColumnInfo } from "./types";

/** Quote one CSV cell with formula-injection protection — mirrors the Rust
 *  `csv_cell` from the streaming export (Task 10) byte-for-byte. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[,"\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
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

export function exportData(
  rows: unknown[][],
  columns: ColumnInfo[],
  format: string,
  tableName: string,
) {
  const headers = columns.map((c) => c.name);
  let content: string;
  let mime: string;

  switch (format) {
    case "xlsx": {
      const bytes = buildXlsx(rows, columns);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${tableName}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    case "json": {
      const jsonRows = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((c, i) => { obj[c.name] = row[i] ?? null; });
        return obj;
      });
      content = JSON.stringify(jsonRows, null, 2);
      mime = "application/json";
      break;
    }
    case "csv": {
      const csvRows = [headers.map((h) => csvCell(h)).join(",")];
      for (const row of rows) {
        csvRows.push(row.map((cell) => csvCell(cell)).join(","));
      }
      content = csvRows.join("\n");
      mime = "text/csv";
      break;
    }
    case "sql": {
      const lines = [`-- ${tableName}`];
      for (const row of rows) {
        const vals = row.map((cell) =>
          cell === null ? "NULL"
          : typeof cell === "number" ? String(cell)
          : `'${String(cell).replace(/'/g, "''")}'`,
        );
        lines.push(`INSERT INTO ${tableName} (${headers.join(", ")}) VALUES (${vals.join(", ")});`);
      }
      content = lines.join("\n");
      mime = "application/sql";
      break;
    }
    case "md": {
      const mdRows = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
      for (const row of rows) {
        mdRows.push(`| ${row.map((cell) => cell === null ? "*NULL*" : String(cell)).join(" | ")} |`);
      }
      content = mdRows.join("\n");
      mime = "text/markdown";
      break;
    }
    default:
      return;
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tableName}.${format === "md" ? "md" : format}`;
  a.click();
  URL.revokeObjectURL(url);
}