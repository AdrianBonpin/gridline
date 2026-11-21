import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "./types";
import {
  locatorColumnFor,
  primaryKeyColumns,
  projectDeclaredCells,
  rowIdentityFor,
} from "./rowIdentity";

function col(name: string, isPk = false, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "text",
    is_nullable: false,
    is_pk: isPk,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: !isPk,
    is_generated: false,
    ...overrides,
  };
}

/** The demo `order_items` shape: composite primary key (order_id, product_id). */
const compositeKeyColumns: ColumnInfo[] = [
  col("order_id", true),
  col("product_id", true),
  col("quantity"),
  col("unit_price"),
];

describe("primaryKeyColumns", () => {
  it("returns every primary-key column in metadata order", () => {
    expect(primaryKeyColumns(compositeKeyColumns).map((c) => c.name)).toEqual([
      "order_id",
      "product_id",
    ]);
  });

  it("returns an empty list for a table without a primary key", () => {
    const noPk = [col("url"), col("session_id"), col("user_agent")];
    expect(primaryKeyColumns(noPk)).toEqual([]);
  });
});

describe("locatorColumnFor", () => {
  it("uses the engine's physical locator", () => {
    expect(locatorColumnFor("postgresql")).toBe("ctid");
    expect(locatorColumnFor("sqlite")).toBe("rowid");
  });

  it("reports no locator for engines that are primary-key only", () => {
    expect(locatorColumnFor("mysql")).toBeNull();
    expect(locatorColumnFor("mariadb")).toBeNull();
  });
});

describe("rowIdentityFor", () => {
  it("carries every composite primary-key column, not just the first", () => {
    const identity = rowIdentityFor(compositeKeyColumns, [7, 12, 3, 19.5], "sqlite");
    expect(identity).not.toBeNull();
    expect(identity!.kind).toBe("primary-key");
    expect(identity!.values).toEqual({ order_id: 7, product_id: 12 });
  });

  it("uses a single primary-key column when that is all the table has", () => {
    const columns = [col("id", true), col("name")];
    expect(rowIdentityFor(columns, [42, "Ada"], "postgresql")!.values).toEqual({ id: 42 });
  });

  it("falls back to the trailing physical locator cell for a no-PK SQLite table", () => {
    const columns = [col("url"), col("session_id")];
    const identity = rowIdentityFor(columns, ["/products", "sess-001", 17], "sqlite");
    expect(identity).not.toBeNull();
    expect(identity!.kind).toBe("physical-locator");
    expect(identity!.values).toEqual({ rowid: 17 });
  });

  it("falls back to ctid for a no-PK PostgreSQL table", () => {
    const columns = [col("url"), col("session_id")];
    const identity = rowIdentityFor(columns, ["/products", "sess-001", "(0,3)"], "postgresql");
    expect(identity!.kind).toBe("physical-locator");
    expect(identity!.values).toEqual({ ctid: "(0,3)" });
  });

  it("never uses a displayed cell as a locator when the backend appended none", () => {
    // A no-PK MySQL table: MySQL has no physical locator, so the backend sends
    // no extra cell and the row can only be addressed by a primary key.
    const columns = [col("url"), col("session_id")];
    expect(rowIdentityFor(columns, ["/products", "sess-001"], "mysql")).toBeNull();
  });

  it("refuses a physical locator whose extra cell is missing or NULL", () => {
    const columns = [col("url")];
    expect(rowIdentityFor(columns, ["/products"], "sqlite")).toBeNull();
    expect(rowIdentityFor(columns, ["/products", null], "sqlite")).toBeNull();
  });

  it("refuses an incomplete primary key (row shorter than its key columns)", () => {
    expect(rowIdentityFor(compositeKeyColumns, [7], "sqlite")).toBeNull();
  });
});

describe("projectDeclaredCells", () => {
  it("drops a trailing backend locator cell", () => {
    const columns = [col("url"), col("session_id")];
    expect(projectDeclaredCells(["/products", "sess-001", 17], columns)).toEqual([
      "/products",
      "sess-001",
    ]);
  });

  it("keeps every declared value and pads a short row with NULL", () => {
    const columns = [col("a"), col("b")];
    expect(projectDeclaredCells(["x"], columns)).toEqual(["x", null]);
  });
});
