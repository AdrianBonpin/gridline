import { describe, it, expect } from "vitest";
import { isCellEditable, defaultFilterOperator, cellToUpdateChange, updateGuardValues } from "./gridEditability";
import type { ColumnInfo } from "../../lib/types";

const col = (over: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name: "c", data_type: "text", is_nullable: true, is_pk: false, is_fk: false,
  fk_ref: null, default_value: null, editable: true, is_generated: false, ...over,
});

describe("gridEditability", () => {
  it("isCellEditable is false for PK, generated, non-editable flag, or view/tabType!=table", () => {
    expect(isCellEditable(col({ is_pk: true }), "table", "postgresql")).toBe(false);
    expect(isCellEditable(col({ is_generated: true }), "table", "postgresql")).toBe(false);
    expect(isCellEditable(col({ editable: false }), "table", "postgresql")).toBe(false);
    expect(isCellEditable(col(), "query", "postgresql")).toBe(false);
    expect(isCellEditable(col(), "table", "mysql")).toBe(false);
    expect(isCellEditable(col(), "table", "postgresql")).toBe(true);
    expect(isCellEditable(col(), "table", "sqlite")).toBe(true);
  });

  it("defaultFilterOperator picks by data type", () => {
    expect(defaultFilterOperator("text")).toBe("contains");
    expect(defaultFilterOperator("uuid")).toBe("contains");
    expect(defaultFilterOperator("integer")).toBe("eq");
    expect(defaultFilterOperator("timestamptz")).toBe("eq");
    expect(defaultFilterOperator("boolean")).toBe("eq");
    expect(defaultFilterOperator("USER-DEFINED")).toBe("eq");
  });

  it("cellToUpdateChange builds the update payload using a locator when no PK", () => {
    const out = cellToUpdateChange({
      schema: "public", table: "users",
      primaryKey: { id: 1 }, oldData: { name: "A" }, newData: { name: "B" },
    });
    expect(out).toEqual({ type: "update", schema: "public", table: "users",
      primaryKey: { id: 1 }, oldData: { name: "A" }, newData: { name: "B" } });
  });
  it("cellToUpdateChange uses row locator as primaryKey when PK absent", () => {
    const out = cellToUpdateChange({
      schema: "public", table: "no_pk",
      primaryKey: { ctid: "(0,1)" }, oldData: { name: "A" }, newData: { name: "B" },
    });
    expect(out.primaryKey).toEqual({ ctid: "(0,1)" });
  });

  describe("updateGuardValues", () => {
    const columns: ColumnInfo[] = [col({ name: "url" }), col({ name: "session_id" })];

    it("guards a primary-key update with the edited column's original value", () => {
      expect(
        updateGuardValues({
          columns,
          row: ["/cart", "sess-002"],
          identity: { id: 2 },
          editedColumn: "url",
        }),
      ).toEqual({ url: "/cart" });
    });

    it("guards a physical-locator update with the whole displayed row", () => {
      // A reused ctid/rowid must not be able to modify a different row, so the
      // guard covers every displayed column, not only the edited one.
      expect(
        updateGuardValues({
          columns,
          row: ["/cart", "sess-002"],
          identity: { rowid: 2 },
          editedColumn: "url",
        }),
      ).toEqual({ url: "/cart", session_id: "sess-002" });
    });

    it("refuses to build a guard it cannot prove (missing full row)", () => {
      expect(
        updateGuardValues({
          columns,
          row: ["/cart"],
          identity: { ctid: "(0,1)" },
          editedColumn: "url",
        }),
      ).toBeNull();
      expect(
        updateGuardValues({
          columns,
          row: undefined,
          identity: { id: 1 },
          editedColumn: "url",
        }),
      ).toBeNull();
    });

    it("keeps a NULL original value as an explicit guard", () => {
      expect(
        updateGuardValues({
          columns,
          row: [null, "sess-002"],
          identity: { rowid: 2 },
          editedColumn: "url",
        }),
      ).toEqual({ url: null, session_id: "sess-002" });
    });
  });
});