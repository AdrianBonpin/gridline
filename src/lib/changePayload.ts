import type { QueueItem } from "../stores/dbViewerStore";

/**
 * Payload emitted for a single queued change, keyed to match the Rust
 * `Change` enum variants (snake_case). Sent to `executeChange`.
 */
export type ChangePayload = Record<string, unknown>;

function j(v: unknown): string {
  return JSON.stringify(v ?? {});
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
    default:
      return { id: item.id, type: item.type, sql: item.sql };
  }
}