import type { ColumnInfo } from "./types";

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
      const csvRows = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];
      for (const row of rows) {
        csvRows.push(
          row.map((cell) => {
            const s = cell === null || cell === undefined ? "" : String(cell);
            return `"${s.replace(/"/g, '""')}"`;
          }).join(","),
        );
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