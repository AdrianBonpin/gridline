import type { ColumnInfo } from "./types";

/**
 * Row Identity — the complete set of values used to address exactly one row
 * for an edit or delete (see GLOSSARY.md).
 *
 * Every primary-key column is part of the identity, in stable metadata order.
 * A grid position is never a Row Identity, and a physical locator is used only
 * when the table has no primary key at all.
 */
export type RowIdentityKind = "primary-key" | "physical-locator";

export interface RowIdentity {
  kind: RowIdentityKind;
  /** Column name → value. Complete: never a subset of a composite key. */
  values: Record<string, unknown>;
}

/** The physical row locator each engine exposes when a table has no primary key. */
export type PhysicalLocatorColumn = "rowid" | "ctid";

/** Every primary-key column of a table, in the metadata order it was returned. */
export function primaryKeyColumns(columns: ColumnInfo[]): ColumnInfo[] {
  return columns.filter((c) => c.is_pk);
}

/**
 * The backend row locator for an engine, or `null` when the engine has none.
 *
 * PostgreSQL appends `ctid` and SQLite appends `rowid` to a no-PK table's data
 * SELECT (`get_table_data`). MySQL/MariaDB have no equivalent — MySQL browsing
 * is primary-key only — so a no-PK MySQL row has no Row Identity.
 */
export function locatorColumnFor(dbType: string): PhysicalLocatorColumn | null {
  if (dbType === "sqlite") return "rowid";
  if (dbType === "postgresql") return "ctid";
  return null;
}

/**
 * Build the Row Identity for one displayed row.
 *
 * `row` is the raw row array sent by the backend: one cell per declared column
 * in `columns` order, plus (for a no-PK table) a single trailing locator cell
 * that is never a declared column.
 *
 * Returns `null` when no complete identity can be built — a row of a no-PK
 * table the engine cannot locate, a truncated row, or a NULL locator. Callers
 * must refuse to stage an edit/delete in that case rather than fall back to a
 * positional or partial predicate.
 */
export function rowIdentityFor(
  columns: ColumnInfo[],
  row: unknown[],
  dbType: string,
): RowIdentity | null {
  const pkColumns = primaryKeyColumns(columns);
  if (pkColumns.length > 0) {
    const values: Record<string, unknown> = {};
    for (const pk of pkColumns) {
      const index = columns.findIndex((c) => c.name === pk.name);
      if (index < 0 || index >= row.length) return null;
      const value = row[index];
      if (value === undefined) return null;
      values[pk.name] = value;
    }
    return { kind: "primary-key", values };
  }

  const locator = locatorColumnFor(dbType);
  if (!locator) return null;
  // The locator is the extra cell after the declared columns. A row without it
  // (a view, or an engine that sends none) cannot be addressed.
  if (row.length <= columns.length) return null;
  const value = row[columns.length];
  if (value === null || value === undefined) return null;
  return { kind: "physical-locator", values: { [locator]: value } };
}

/**
 * The declared cells of a row, in declared order — exactly what a writer may
 * emit. Any trailing backend locator cell is dropped, so it can never appear in
 * CSV/JSON/SQL/Markdown/Excel output as if it were data.
 */
export function projectDeclaredCells(row: unknown[], columns: ColumnInfo[]): unknown[] {
  return columns.map((_, index) => (index < row.length ? row[index] : null));
}
