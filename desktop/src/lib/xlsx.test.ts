import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildXlsx } from "./xlsx";
import type { ColumnInfo } from "./types";

function column(name: string, data_type: string): ColumnInfo {
  return {
    name,
    data_type,
    is_nullable: true,
    is_pk: false,
    is_fk: false,
    fk_ref: null,
    default_value: null,
    editable: true,
    is_generated: false,
  };
}

function parts(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

function sheetOf(bytes: Uint8Array): string {
  return parts(bytes)["xl/worksheets/sheet1.xml"];
}

/** The XML of one body cell (row 2, column A). */
function cellA2(bytes: Uint8Array): string {
  const match = sheetOf(bytes).match(/<c r="A2"[^>]*(?:\/>|>[\s\S]*?<\/c>)/);
  if (!match) throw new Error("cell A2 not found");
  return match[0];
}

describe("buildXlsx cell semantics", () => {
  it("writes a numeric column as a real number cell, not text", () => {
    const xml = buildXlsx([[42]], [column("n", "integer")]);
    expect(cellA2(xml)).toBe('<c r="A2"><v>42</v></c>');
  });

  it("writes a float column as a real number cell", () => {
    const xml = buildXlsx([[1.5]], [column("n", "double precision")]);
    expect(cellA2(xml)).toBe('<c r="A2"><v>1.5</v></c>');
  });

  it("writes a boolean column as a boolean cell", () => {
    expect(cellA2(buildXlsx([[true]], [column("b", "boolean")]))).toBe(
      '<c r="A2" t="b"><v>1</v></c>',
    );
    expect(cellA2(buildXlsx([[false]], [column("b", "boolean")]))).toBe(
      '<c r="A2" t="b"><v>0</v></c>',
    );
  });

  it("writes a NULL as an empty cell, distinct from an empty string", () => {
    const cols = [column("a", "text"), column("b", "text")];
    const xml = sheetOf(buildXlsx([[null, ""]], cols));
    // NULL: no type, no value — Excel's own null.
    expect(xml).toContain('<c r="A2"/>');
    // Empty string: an inline string with empty text, not a null cell.
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve"></t></is></c>');
  });

  it("writes a date column as an Excel date serial with a date format", () => {
    const files = parts(buildXlsx([["2024-05-01"]], [column("d", "date")]));
    expect(files["xl/worksheets/sheet1.xml"]).toContain('<c r="A2" s="1"><v>45413</v></c>');
    expect(files["xl/styles.xml"]).toContain('formatCode="yyyy\\-mm\\-dd"');
    expect(files["[Content_Types].xml"]).toContain("/xl/styles.xml");
  });

  it("writes a timestamp column as a date+time serial with a datetime format", () => {
    const files = parts(buildXlsx([["2024-05-01T12:30:00"]], [column("ts", "timestamp")]));
    const match = files["xl/worksheets/sheet1.xml"].match(/<c r="A2" s="2"><v>([^<]+)<\/v><\/c>/);
    expect(match).not.toBeNull();
    expect(Math.abs(Number(match![1]) - (45413 + 45000 / 86400))).toBeLessThan(1e-9);
    expect(files["xl/styles.xml"]).toContain('formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"');
  });

  it("keeps an unrepresentable numeric string as text so precision survives", () => {
    // bigint values cross IPC as strings; Excel numbers lose digits past 15.
    const xml = buildXlsx([["9007199254740993"]], [column("n", "bigint")]);
    expect(cellA2(xml)).toContain('t="inlineStr"');
    expect(cellA2(xml)).toContain("<t xml:space=\"preserve\">9007199254740993</t>");
  });

  it("keeps a numeric-looking value of a text column as text", () => {
    const xml = buildXlsx([["0042"]], [column("code", "text")]);
    expect(cellA2(xml)).toContain('t="inlineStr"');
    expect(cellA2(xml)).toContain(">0042<");
  });

  it("escapes XML and preserves whitespace and newlines", () => {
    const xml = buildXlsx([[' a&b<c>\n"q" ']], [column("t", "text")]);
    expect(cellA2(xml)).toBe(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve"> a&amp;b&lt;c&gt;\n&quot;q&quot; </t></is></c>',
    );
  });

  it("drops characters XML cannot represent", () => {
    const xml = buildXlsx([["a\u0000b\u0007c"]], [column("t", "text")]);
    expect(cellA2(xml)).toBe('<c r="A2" t="inlineStr"><is><t xml:space="preserve">abc</t></is></c>');
  });

  it("never stores a leading = as a formula", () => {
    const xml = buildXlsx([["=1+1"]], [column("t", "text")]);
    expect(cellA2(xml)).toContain('t="inlineStr"');
    expect(sheetOf(xml)).not.toContain("<f>");
  });

  // ── coverage retained from the original writer ──────────

  it("emits headers as inline strings and rows as text for text columns", () => {
    const rows = [[1, "Alice"], [2, "Bob"]];
    const cols = [column("id", "integer"), column("name", "text")];
    const xml = sheetOf(buildXlsx(rows, cols));
    expect(xml).toContain("<t xml:space=\"preserve\">id</t>");
    expect(xml).toContain("<t xml:space=\"preserve\">Alice</t>");
    expect(xml).toContain("<t xml:space=\"preserve\">Bob</t>");
  });

  it("escapes XML-special characters in cell text", () => {
    const xml = sheetOf(buildXlsx([[1, "a<b>&c"]], [column("id", "integer"), column("name", "text")]));
    expect(xml).toContain("a&lt;b&gt;&amp;c");
    expect(xml).not.toContain("a<b>&c");
  });

  it("emits formula-triggering values as inline strings (no formula evaluation)", () => {
    const cols = [column("id", "integer"), column("name", "text")];
    const xml = sheetOf(buildXlsx([[1, "=1+1"], [2, "+5"], [3, "@SUM"]], cols));
    expect(xml).toContain("=1+1");
    expect(xml).not.toMatch(/<c[^>]*?><f>/);
  });

  it("declares a column width per header", () => {
    const xml = sheetOf(buildXlsx([[1, "x"]], [column("id", "integer"), column("name", "text")]));
    expect(xml).toContain("<cols>");
    expect(xml).toContain("width=");
  });

  it("renders a null cell as an empty (untyped) cell", () => {
    const xml = sheetOf(buildXlsx([[1, null]], [column("id", "integer"), column("name", "text")]));
    expect(xml).toContain('<c r="B2"/>');
  });
});

describe("buildXlsx declared columns", () => {
  // A no-PK table row carries a trailing backend locator cell that is not a
  // declared column.
  const columns = [column("url", "text"), column("session_id", "text")];

  it("emits one cell per declared column and never the locator", () => {
    const xml = sheetOf(buildXlsx([["/products", "sess-001", 17]], columns));
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">/products</t></is></c>');
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">sess-001</t></is></c>');
    expect(xml).not.toContain('r="C2"');
    expect(xml).not.toContain(">17<");
  });
});
