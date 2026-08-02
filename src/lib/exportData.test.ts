import { describe, it, expect, vi } from "vitest";
import { exportData } from "./exportData";
import type { ColumnInfo } from "./types";

const columns: ColumnInfo[] = [
  { name: "id", data_type: "int", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
  { name: "v", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

describe("exportData", () => {
  it("csv quotes cells and escapes quotes", () => {
    const create = vi.spyOn(document, "createElement");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    create.mockReturnValue({ click } as unknown as HTMLAnchorElement);
    exportData([[1, "a"], [2, 'b"c']], columns, "csv", "t");
    expect(click).toHaveBeenCalled();
  });

  it("json serializes rows as objects", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({ click } as unknown as HTMLAnchorElement);
    exportData([[1, "a"]], columns, "json", "t");
    expect(click).toHaveBeenCalled();
  });
});