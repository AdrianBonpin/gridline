import { describe, it, expect } from "vitest";
import { isCellEditable, defaultFilterOperator, cellToUpdateChange } from "./gridEditability";
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
});