import { describe, it, expect } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { serializeExport } from "./exportData";
import { parseInserts } from "../test/sqlReplay";
import type { ColumnInfo } from "./types";

/**
 * Cross-writer sweep.
 *
 * One row carries every awkward case the writers must survive at once: a NULL,
 * an empty string, a comma, a double quote, a line break — plus a real number —
 * and the row ends with a trailing backend locator, exactly as `get_table_data`
 * sends a table with no primary key. Every writer must emit the same six
 * declared columns, quote each format's own special characters, and keep the
 * locator out of the output.
 */
const EMPTY = "";
const NULL = null;
const COMMA = "x,y";
const QUOTE = 'q"q';
const NEWLINE = "l1\nl2";

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

const columns = [
  column("id", "integer"),
  column("empty", "text"),
  column("nul", "text"),
  column("comma", "text"),
  column("quote", "text"),
  column("lines", "text"),
];

/** Declared cells, then the locator (`99`) the backend appends for a no-PK table. */
const row = [7, EMPTY, NULL, COMMA, QUOTE, NEWLINE, 99];

function text(format: string, dbType = "postgresql"): string {
  const out = serializeExport([row], columns, format, "page_views", {
    schema: "public",
    dbType,
  });
  if (!out) throw new Error(`no output for ${format}`);
  return new TextDecoder().decode(out.data);
}

describe("cross-writer sweep: one awkward row, every writer", () => {
  it("CSV quotes the comma/quote/newline cell and stops at the declared columns", () => {
    expect(text("csv")).toBe(
      [
        "id,empty,nul,comma,quote,lines",
        // NULL and '' are both empty CSV fields (CSV has no null literal).
        `7,,,${`"${COMMA}"`},${`"q""q"`},${`"${NEWLINE}"`}`,
      ].join("\n"),
    );
    expect(text("csv")).not.toContain("99");
  });

  it("JSON keeps the empty string, the NULL and the escapes as JSON defines them", () => {
    const parsed = JSON.parse(text("json"));
    expect(parsed).toEqual([
      { id: 7, empty: "", nul: null, comma: COMMA, quote: QUOTE, lines: NEWLINE },
    ]);
    // A newline is a JSON escape, not a raw line break in the document.
    expect(text("json")).toContain("l1\\nl2");
    expect(text("json")).not.toContain("99");
  });

  it("SQL is replayable with one value per declared column", () => {
    const [insert] = parseInserts(text("sql"), "pg");
    expect(insert.target).toEqual(["public", "page_views"]);
    expect(insert.columns).toEqual(["id", "empty", "nul", "comma", "quote", "lines"]);
    expect(insert.values).toEqual([7, "", null, COMMA, QUOTE, NEWLINE]);
    expect(text("sql")).not.toContain("99");
  });

  it("SQL is replayable for a MySQL/MariaDB target too", () => {
    const [insert] = parseInserts(text("sql", "mysql"), "mysql");
    expect(insert.values).toEqual([7, "", null, COMMA, QUOTE, NEWLINE]);
  });

  it("Markdown escapes the pipe/backslash and never breaks the table row", () => {
    const md = serializeExport(
      [[7, EMPTY, NULL, "a|b", QUOTE, NEWLINE, 99]],
      columns,
      "md",
      "page_views",
      { schema: "public", dbType: "postgresql" },
    );
    expect(new TextDecoder().decode(md!.data)).toBe(
      [
        "| id | empty | nul | comma | quote | lines |",
        "| --- | --- | --- | --- | --- | --- |",
        '| 7 |  | *NULL* | a\\|b | q"q | l1<br>l2 |',
      ].join("\n"),
    );
    expect(new TextDecoder().decode(md!.data)).not.toContain("99");
  });

  it("Markdown escapes a pipe inside a column name", () => {
    const cols = [column("a|b", "text")];
    const md = serializeExport([["v"]], cols, "md", "t");
    const [header, , body] = new TextDecoder().decode(md!.data).split("\n");
    expect(header).toBe("| a\\|b |");
    expect(body).toBe("| v |");
  });

  it("Excel keeps number, empty-string, NULL and text as distinct cell types", () => {
    const out = serializeExport([row], columns, "xlsx", "page_views");
    const sheet = strFromU8(unzipSync(out!.data)["xl/worksheets/sheet1.xml"]);
    const body = sheet.slice(sheet.indexOf('<row r="2">'));
    expect(body).toBe(
      '<row r="2">' +
        '<c r="A2"><v>7</v></c>' +
        '<c r="B2" t="inlineStr"><is><t xml:space="preserve"></t></is></c>' +
        '<c r="C2"/>' +
        '<c r="D2" t="inlineStr"><is><t xml:space="preserve">x,y</t></is></c>' +
        '<c r="E2" t="inlineStr"><is><t xml:space="preserve">q&quot;q</t></is></c>' +
        '<c r="F2" t="inlineStr"><is><t xml:space="preserve">l1\nl2</t></is></c>' +
        "</row></sheetData></worksheet>",
    );
    // The locator is not a seventh spreadsheet column.
    expect(sheet).not.toContain('r="G2"');
    expect(sheet).not.toContain(">99<");
  });
});
