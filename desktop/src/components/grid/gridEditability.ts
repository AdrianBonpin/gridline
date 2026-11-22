import type { ColumnInfo, ChangeItemType } from "../../lib/types";

export type TabKind = "table" | "query" | "object" | "objectForm";
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

/**
 * The column names a backend appends to a no-PK table's data SELECT as the row's
 * physical locator (`ctid` for PostgreSQL, `rowid` for SQLite).
 */
const PHYSICAL_LOCATOR_COLUMNS = ["ctid", "rowid"];

/** Whether this Row Identity is a backend physical locator rather than a PK. */
export function isPhysicalLocatorIdentity(
  identity: Record<string, unknown> | null | undefined,
): boolean {
  if (!identity) return false;
  const names = Object.keys(identity);
  return names.length === 1 && PHYSICAL_LOCATOR_COLUMNS.includes(names[0]);
}

/**
 * The original values a staged update must carry as its optimistic predicate.
 *
 * * **Primary key** — the edited column's original value, which is what the
 *   spec requires for a normal edit.
 * * **Physical locator** (`ctid`/`rowid`) — the **whole displayed row**, because a
 *   locator alone can address a different row once the row moves or its locator
 *   is reused. Guarding only the edited column would let a reused locator
 *   overwrite a row the user never saw.
 *
 * Returns `null` when the values needed for the guard are not available. The
 * caller must then refuse to stage the edit: an update it cannot guard must
 * never become durable.
 */
export function updateGuardValues(input: {
  columns: readonly ColumnInfo[];
  row: readonly unknown[] | null | undefined;
  identity: Record<string, unknown> | null | undefined;
  editedColumn: string;
}): Record<string, unknown> | null {
  const { columns, row, identity, editedColumn } = input;
  if (!row) return null;
  const valueOf = (name: string): unknown => {
    const index = columns.findIndex((c) => c.name === name);
    return index < 0 ? undefined : row[index];
  };

  const editedValue = valueOf(editedColumn);
  if (editedValue === undefined) return null;
  if (!isPhysicalLocatorIdentity(identity)) return { [editedColumn]: editedValue };

  const guard: Record<string, unknown> = {};
  for (const column of columns) {
    const value = valueOf(column.name);
    // A row value the grid cannot see cannot guard anything; fail closed rather
    // than staging a partial (and therefore forgeable) predicate.
    if (value === undefined) return null;
    guard[column.name] = value;
  }
  return guard;
}