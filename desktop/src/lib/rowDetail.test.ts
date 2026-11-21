import { describe, it, expect } from "vitest";
import { resolveRowDetail, type RowDetailRef } from "./rowDetail";
import { rowSelectionKey } from "./rowSelection";
import type { ColumnInfo } from "./types";

/**
 * Row detail resolution (ticket 39).
 *
 * A row detail remembers the result set it belongs to and the row's Row
 * Identity key — never a position. It is resolved against the result sets the
 * tab is displaying right now, so the drawer either shows exactly the row that
 * was opened or nothing at all. It never falls back to whatever happens to sit
 * at the old position, and never to another result set's row.
 */

function columns(names: string[], pk?: string): ColumnInfo[] {
  return names.map((name) => ({
    name,
    data_type: "text",
    is_nullable: true,
    is_pk: name === pk,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
  }));
}

const users = columns(["id", "name"], "id");
const orders = columns(["id", "total"], "id");

const userRows = [
  [1, "Alice"],
  [2, "Bob"],
];
const orderRows = [[1, 999]];

const sets = [
  { columns: users, rows: userRows },
  { columns: orders, rows: orderRows },
];

function detailIn(setIndex: number, setColumns: ColumnInfo[], row: unknown[]): RowDetailRef {
  return { setIndex, key: rowSelectionKey(setColumns, row, "postgresql")! };
}

describe("resolveRowDetail", () => {
  it("resolves the row in the result set that contains its identity", () => {
    const resolved = resolveRowDetail(sets, "postgresql", detailIn(0, users, [2, "Bob"]));
    expect(resolved?.row).toEqual([2, "Bob"]);
    expect(resolved?.columns).toBe(users);
  });

  it("resolves inside the named result set even when another set collides", () => {
    // Both sets hold a row whose primary key is 1. The drawer opened for the
    // orders row must show that row, not the users row with the same identity.
    const resolved = resolveRowDetail(sets, "postgresql", detailIn(1, orders, [1, 999]));
    expect(resolved?.row).toEqual([1, 999]);
    expect(resolved?.columns).toBe(orders);
  });

  it("returns null for an identity the result set does not contain", () => {
    const ref = detailIn(1, orders, [9, 0]);
    expect(resolveRowDetail(sets, "postgresql", ref)).toBeNull();
  });

  it("returns null when the result set is no longer displayed", () => {
    const ref = detailIn(2, orders, [1, 999]);
    expect(resolveRowDetail(sets, "postgresql", ref)).toBeNull();
  });

  it("returns null when no row detail is open", () => {
    expect(resolveRowDetail(sets, "postgresql", null)).toBeNull();
  });

  it("returns null rather than a positional fallback for an empty result set", () => {
    expect(
      resolveRowDetail(
        [{ columns: users, rows: [] }],
        "postgresql",
        { setIndex: 0, key: "primary-key:{\"id\":1}" },
      ),
    ).toBeNull();
  });
});
