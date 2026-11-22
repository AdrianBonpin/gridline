import { selectedRowIndices } from "./rowSelection";
import type { ColumnInfo } from "./types";

/**
 * One result set a tab is displaying: the single-set grid, or one panel of a
 * multi-result run.
 */
export interface RowDetailSet {
  columns: ColumnInfo[];
  rows: unknown[][];
}

/**
 * Which row a tab's row detail drawer is showing.
 *
 * `setIndex` names the result set *of the run being displayed* (a multi-
 * statement run can show several, and the same primary-key value can exist in
 * more than one of them); a new run replaces the sets and closes the drawer, so
 * it never outlives the results it was opened in. `key` is the row's Row
 * Identity key within that set (see `lib/rowSelection.ts`). A row position is
 * never part of this — a position means nothing once the page, filter, sort, or
 * dataset changes.
 */
export interface RowDetailRef {
  setIndex: number;
  key: string;
}

/**
 * Resolve an open row detail against the result sets currently displayed.
 *
 * Resolution has to happen against the rows on screen, and it is allowed to
 * fail: a set that is no longer displayed, or an identity that set no longer
 * contains, renders nothing at all rather than another row's content. The store
 * already closes the drawer on every tab, origin, page, filter, sort, and
 * dataset change; this is the second line of defence at render time.
 */
export function resolveRowDetail(
  sets: readonly RowDetailSet[],
  dbType: string,
  ref: RowDetailRef | null,
): { columns: ColumnInfo[]; row: unknown[] } | null {
  if (!ref) return null;
  const set = sets[ref.setIndex];
  if (!set) return null;
  const index = selectedRowIndices(set.columns, set.rows, dbType, [ref.key])[0];
  if (index === undefined) return null;
  const row = set.rows[index];
  if (!row) return null;
  return { columns: set.columns, row };
}
