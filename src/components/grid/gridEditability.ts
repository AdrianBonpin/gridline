import type { ColumnInfo, ChangeItemType } from "../../lib/types";

export type TabKind = "table" | "query";
export type EditableDbType = "postgresql" | "sqlite";

/** A cell is editable iff: table tab, PG/SQLite, column flagged editable, not PK, not generated, and not read-only. */
export function isCellEditable(col: ColumnInfo, tabType: TabKind, dbType: string, readOnly?: boolean): boolean {
  if (readOnly) return false;
  if (tabType !== "table") return false;
  if (dbType !== "postgresql" && dbType !== "sqlite") return false;
  if (!col.editable) return false;
  if (col.is_pk) return false;
  if (col.is_generated) return false;
  return true;
}

/** Default filter operator inferred from column data type. */
export function defaultFilterOperator(dataType: string): "contains" | "eq" {
  const t = dataType.toLowerCase();
  const textish = ["text", "varchar", "char", "bpchar", "name", "uuid"];
  if (textish.some((x) => t.includes(x))) return "contains";
  return "eq";
}

/** Build the update change payload for a single edited cell. */
export function cellToUpdateChange(input: {
  schema: string; table: string;
  primaryKey: Record<string, unknown>;
  oldData: Record<string, unknown>;
  newData: Record<string, unknown>;
}): { type: ChangeItemType; schema: string; table: string;
      primaryKey: Record<string, unknown>;
      oldData: Record<string, unknown>;
      newData: Record<string, unknown> } {
  return { type: "update", ...input };
}