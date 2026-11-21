import { describe, it, expect } from "vitest";
import { rowSelectionKey, rowSelectionKeys, selectedRowIndices } from "./rowSelection";
import type { ColumnInfo } from "./types";

function col(name: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "integer",
    is_nullable: false,
    is_pk: false,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
    ...extra,
  };
}

// order_items — the demo composite-PK table: two rows share order_id and
// differ by product_id, so a position or a single-column key would collide.
const composite = [
  col("order_id", { is_pk: true }),
  col("product_id", { is_pk: true }),
  col("quantity"),
];

// page_views — a no-PK SQLite table: the backend appends `rowid`, which is
// never a declared column.
const noPk = [col("url", { data_type: "TEXT" }), col("session_id", { data_type: "TEXT" })];

describe("rowSelectionKey", () => {
  it("keys a row by its complete Row Identity, not by its grid position", () => {
    const sibling = [1, 1, 2];
    const target = [1, 3, 1];

    const siblingKey = rowSelectionKey(composite, sibling, "postgresql")!;
    const targetKey = rowSelectionKey(composite, target, "postgresql")!;

    // Different rows of one result set never share a key, even though both
    // begin with the same first key column.
    expect(targetKey).not.toBe(siblingKey);
    // The same row keeps its key wherever it happens to be displayed.
    expect(rowSelectionKey(composite, [1, 3, 1], "postgresql")).toBe(targetKey);
  });
});

describe("selectedRowIndices", () => {
  it("resolves selected keys against the rows on screen, never against stale positions", () => {
    const page1 = [
      [1, 1, 2],
      [1, 3, 1],
    ];
    const page2 = [
      [2, 1, 5],
      [2, 3, 4],
    ];

    const keys = rowSelectionKeys(composite, page1, "postgresql");
    expect(keys).toHaveLength(2);

    // Nothing that was selected on page 1 is on page 2, so nothing is
    // selected — the positions 0 and 1 exist on both pages, the rows do not.
    expect(selectedRowIndices(composite, page2, "postgresql", keys)).toEqual([]);
    expect(selectedRowIndices(composite, page1, "postgresql", keys)).toEqual([0, 1]);
  });

  it("finds a selected row at its new position after a sort", () => {
    const sorted = [
      [1, 3, 1],
      [1, 1, 2],
    ];
    const key = rowSelectionKey(composite, [1, 3, 1], "postgresql")!;

    expect(selectedRowIndices(composite, sorted, "postgresql", [key])).toEqual([0]);
  });
});

describe("no-PK rows", () => {
  it("keys a row by the backend locator, never by a displayed cell", () => {
    const first = ["/products", "sess-001", 17];
    const second = ["/products", "sess-001", 18];

    // Identical visible cells, different rows: the locator decides.
    expect(rowSelectionKey(noPk, first, "sqlite")).not.toBe(
      rowSelectionKey(noPk, second, "sqlite"),
    );
    // The same locator is the same row, whatever cells it currently shows.
    expect(rowSelectionKey(noPk, ["/other", "sess-002", 17], "sqlite")).toBe(
      rowSelectionKey(noPk, first, "sqlite"),
    );
  });
});

describe("rows without a Row Identity", () => {
  // A view exposes no locator and no primary key. Nothing may be *written* to
  // it, but its rows can still be selected for read-only copy, keyed by their
  // declared content rather than by position.
  const view = [col("id"), col("name", { data_type: "text" })];

  it("keys a view row by its declared content, not by its position", () => {
    const rows = [
      [1, "alpha"],
      [2, "beta"],
    ];
    const keys = rowSelectionKeys(view, rows, "postgresql");
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    // Reordered rows keep their selection with the row, not the position.
    expect(
      selectedRowIndices(view, [rows[1], rows[0]], "postgresql", [keys[0]]),
    ).toEqual([1]);
  });
});
