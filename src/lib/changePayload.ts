import type { QueueItem } from "../stores/dbViewerStore";

/**
 * Payload emitted for a single queued change, keyed to match the Rust
 * `Change` enum variants (snake_case). Sent to `executeChange`.
 */
export type ChangePayload = Record<string, unknown>;

function j(v: unknown): string {
  return JSON.stringify(v ?? {});
}

function q(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
}

function tableRef(schema: string | undefined, table: string | undefined): string {
  if (!table) return "-";
  return schema ? `${q(schema)}.${q(table)}` : q(table);
}

export function buildChangeSql(item: QueueItem): string {
  const t = tableRef(item.schema, item.table);
  switch (item.type) {
    case "insert": {
      const data = item.newData ?? {};
      const cols = Object.keys(data);
      return `INSERT INTO ${t} (${cols.map(q).join(", ")}) VALUES (${cols.map((c) => lit(data[c])).join(", ")})`;
    }
    case "update": {
      const data = item.newData ?? {};
      const pk = item.primaryKey ?? {};
      const setClause = Object.keys(data).map((c) => `${q(c)} = ${lit(data[c])}`).join(", ");
      const whereClause = Object.keys(pk).map((c) => `${q(c)} = ${lit(pk[c])}`).join(" AND ");
      return `UPDATE ${t} SET ${setClause} WHERE ${whereClause}`;
    }
    case "delete": {
      const pk = item.primaryKey ?? {};
      const whereClause = Object.keys(pk).map((c) => `${q(c)} = ${lit(pk[c])}`).join(" AND ");
      return `DELETE FROM ${t} WHERE ${whereClause}`;
    }
    case "bulk_insert": {
      const cols = item.columns ?? [];
      const rows = item.rows ?? [];
      const valueRows = rows
        .map((row) => `(${row.map(lit).join(", ")})`)
        .join(", ");
      return `INSERT INTO ${t} (${cols.map(q).join(", ")}) VALUES ${valueRows}`;
    }
    case "empty_table":
      return `DELETE FROM ${t}`;
    case "ddl":
      return item.sql ?? "";
    case "drop_table":
      return `DROP TABLE ${t}`;
    default:
      return item.sql ?? "";
  }
}

export function buildChangePayload(item: QueueItem): ChangePayload {
  const schema = item.schema ?? "";
  const table = item.table ?? "";
  switch (item.type) {
    case "insert":
      return { id: item.id, type: "insert", schema, table, data: j(item.newData) };
    case "update":
      return { id: item.id, type: "update", schema, table,
        primary_key: j(item.primaryKey), old_data: j(item.oldData), new_data: j(item.newData) };
    case "delete":
      return { id: item.id, type: "delete", schema, table, primary_key: j(item.primaryKey) };
    case "alter_table":
      return { id: item.id, type: "alter_table", schema, table, sql: item.sql, rollback_sql: "" };
    case "bulk_insert":
      return { id: item.id, type: "bulk_insert", schema, table,
        columns: item.columns ?? [], rows: item.rows ?? [] };
    case "drop_table":
      return { id: item.id, type: "drop_table", schema, table };
    case "empty_table":
      return { id: item.id, type: "empty_table", schema, table };
    case "ddl":
      return { id: item.id, type: "ddl", sql: item.sql };
    default:
      return { id: item.id, type: item.type, sql: item.sql };
  }
}