import type { ColumnInfo } from "./types";
import { projectDeclaredCells, rowIdentityFor } from "./rowIdentity";

/**
 * Selection is bound to Row Identity (see GLOSSARY.md), never to a grid
 * position.
 *
 * A grid position means nothing outside the result set it was recorded in: page
 * 2 has a row 0 too, and after a sort row 0 is a different row. A selection
 * keyed by position therefore survives page, filter, sort, and dataset changes
 * and silently re-points at rows the user never selected — which is exactly how
 * a bulk copy or bulk delete addresses the wrong rows.
 *
 * A selection key is derived from the row itself:
 *
 * - **primary key** — every primary-key column's value, so a composite key can
 *   never collapse into one column;
 * - **physical locator** — `ctid`/`rowid` for a no-PK table the backend can
 *   locate;
 * - **declared content** — only for a row that has no Row Identity at all (a
 *   view or matview, which exposes no locator and is read-only). Such a row can
 *   be selected for copy but can never be the target of a bulk write: bulk
 *   delete re-derives the Row Identity and refuses the row.
 *
 * Keys are compared against the rows currently on screen, so a key whose row is
 * no longer displayed resolves to nothing instead of to that position.
 */
export function rowSelectionKey(
  columns: ColumnInfo[],
  row: unknown[],
  dbType: string,
): string | null {
  const identity = rowIdentityFor(columns, row, dbType);
  if (identity) {
    return `${identity.kind}:${JSON.stringify(identity.values)}`;
  }
  // No Row Identity: fall back to the row's declared content. This is not a
  // Row Identity (it is only ever used for read-only copy), and the trailing
  // backend locator cell is never part of it.
  if (columns.length === 0) return null;
  return `content:${JSON.stringify(projectDeclaredCells(row, columns))}`;
}

/** The selection keys of every row in a result set, in row order. */
export function rowSelectionKeys(
  columns: ColumnInfo[],
  rows: unknown[][],
  dbType: string,
): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    const key = rowSelectionKey(columns, row, dbType);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/**
 * The positions of the rows on screen that the user has selected.
 *
 * This is the only place a selection turns into positions, and it is recomputed
 * from the rows currently displayed — a selected key whose row is not in this
 * result set contributes nothing.
 */
export function selectedRowIndices(
  columns: ColumnInfo[],
  rows: unknown[][],
  dbType: string,
  selectedKeys: ReadonlySet<string> | readonly string[],
): number[] {
  const keys = Array.isArray(selectedKeys)
    ? new Set(selectedKeys as readonly string[])
    : (selectedKeys as ReadonlySet<string>);
  if (keys.size === 0) return [];
  const indices: number[] = [];
  rows.forEach((row, index) => {
    const key = rowSelectionKey(columns, row, dbType);
    if (key !== null && keys.has(key)) indices.push(index);
  });
  return indices;
}
