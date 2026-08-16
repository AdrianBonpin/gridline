import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { buildXlsx } from "./xlsx";
import type { ColumnInfo } from "./types";

const cols: ColumnInfo[] = [
  { name: "id", data_type: "integer", is_nullable: false, is_pk: true, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
  { name: "name", data_type: "text", is_nullable: true, is_pk: false, is_fk: false, fk_ref: null, default_value: null, editable: true, is_generated: false },
];

function sheetXML(out: Uint8Array): string {
  const files = unzipSync(out);
  return new TextDecoder().decode(files["xl/worksheets/sheet1.xml"]);
}

describe("buildXlsx", () => {
  it("emits headers + rows as inline strings", () => {
    const out = buildXlsx([[1, "Alice"], [2, "Bob"]], cols);
    const xml = sheetXML(out);
    expect(xml).toContain('t="inlineStr"');
    expect(xml).toContain("id");
    expect(xml).toContain("Alice");
    expect(xml).toContain("Bob");
  });

  it("escapes XML-special characters in cell text", () => {
    const out = buildXlsx([[1, "a<b>&c"]], cols);
    const xml = sheetXML(out);
    expect(xml).toContain("a&lt;b&gt;&amp;c");
    expect(xml).not.toContain("a<b>&c");
  });

  it("emits formula-triggering values as inline strings (no formula evaluation)", () => {
    const out = buildXlsx([[1, "=1+1"], [2, "+5"], [3, "@SUM"]], cols);
    const xml = sheetXML(out);
    expect(xml).toContain("=1+1");
    expect(xml).not.toMatch(/<c[^>]*?><f>/);
  });

  it("declares a column width per header", () => {
    const out = buildXlsx([[1, "x"]], cols);
    const xml = sheetXML(out);
    expect(xml).toContain("<cols>");
    expect(xml).toContain("width=");
  });

  it("renders null cells as empty inline strings", () => {
    const out = buildXlsx([[1, null]], cols);
    const xml = sheetXML(out);
    expect(xml).toContain("inlineStr");
  });
});