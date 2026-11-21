import { describe, it, expect } from "vitest";
import { copyCellText, serializeExport, csvCopyCell } from "./exportData";
import { parseInserts } from "../test/sqlReplay";
import type { ColumnInfo } from "./types";

export function col(name: string, data_type: string, extra: Partial<ColumnInfo> = {}): ColumnInfo {
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
    ...extra,
  };
}

function text(format: string, rows: unknown[][], columns: ColumnInfo[], table: string, options?: { schema?: string; dbType?: string }): string {
  const out = serializeExport(rows, columns, format, table, options);
  if (!out) throw new Error(`no output for ${format}`);
  return new TextDecoder().decode(out.data);
}

// ─── the awkward row every format must survive ───

const NASTY = "a,b\"c\n'd\\e";
const nastyColumns = [
  col("id", "integer", { is_pk: true }),
  col("note", "text"),
  col("amount", "numeric"),
  col("active", "boolean"),
  col("payload", "jsonb"),
];
const nastyRow = [1, NASTY, null, true, { k: "v" }];

describe("SQL export is replayable", () => {
  it("quotes identifiers and round-trips every value (PostgreSQL)", () => {
    const sql = text("sql", [nastyRow], nastyColumns, "notes", { schema: "public", dbType: "postgresql" });
    const [insert] = parseInserts(sql, "pg");
    expect(insert.target).toEqual(["public", "notes"]);
    expect(insert.columns).toEqual(["id", "note", "amount", "active", "payload"]);
    // NULL stays NULL, the boolean stays boolean, JSON keeps its structure.
    expect(insert.values).toEqual([1, NASTY, null, true, '{"k":"v"}']);
  });

  it("quotes identifiers and round-trips every value (MySQL)", () => {
    const sql = text("sql", [nastyRow], nastyColumns, "notes", { schema: "app", dbType: "mysql" });
    const [insert] = parseInserts(sql, "mysql");
    expect(insert.target).toEqual(["app", "notes"]);
    expect(insert.values).toEqual([1, NASTY, null, true, '{"k":"v"}']);
  });

  it("quotes reserved words and unusual identifiers", () => {
    const cols = [col("from", "text"), col("order id", "text"), col('we"ird', "text")];
    const pg = text("sql", [["x", "y", "z"]], cols, "select", { schema: "public", dbType: "postgresql" });
    const [insert] = parseInserts(pg, "pg");
    expect(insert.target).toEqual(["public", "select"]);
    expect(insert.columns).toEqual(["from", "order id", 'we"ird']);

    const my = text("sql", [["x", "y", "z"]], [col("from", "text")], "select", { dbType: "mariadb" });
    expect(parseInserts(my, "mysql")[0].target).toEqual(["select"]);
    expect(parseInserts(my, "mysql")[0].values).toEqual(["x"]);
  });

  it("leaves an unqualified target when no schema is given", () => {
    const [insert] = parseInserts(text("sql", [[1]], [col("id", "integer")], "notes"), "pg");
    expect(insert.target).toEqual(["notes"]);
  });

  it("keeps an empty string distinct from NULL", () => {
    const cols = [col("a", "text"), col("b", "text")];
    const [insert] = parseInserts(text("sql", [["", null]], cols, "t"), "pg");
    expect(insert.values).toEqual(["", null]);
  });

  it("stringifies a date value so the statement still parses", () => {
    const cols = [col("d", "date"), col("ts", "timestamp")];
    const [insert] = parseInserts(
      text("sql", [["2024-05-01", "2024-05-01T12:30:00"]], cols, "t", { dbType: "postgresql" }),
      "pg",
    );
    expect(insert.values).toEqual(["2024-05-01", "2024-05-01T12:30:00"]);
  });

  it("keeps a multi-statement script replayable", () => {
    const cols = [col("v", "text")];
    const inserts = parseInserts(text("sql", [["a;b"], ["c"]], cols, "t"), "pg");
    expect(inserts.map((i) => i.values)).toEqual([["a;b"], ["c"]]);
  });
});

describe("copyCellText", () => {
  it("marks a NULL explicitly instead of copying an empty string", () => {
    expect(copyCellText(null)).toBe("NULL");
    expect(copyCellText(undefined)).toBe("NULL");
    expect(copyCellText("")).toBe("");
  });

  it("copies scalars as text and json as its structure", () => {
    expect(copyCellText("Alice")).toBe("Alice");
    expect(copyCellText(42)).toBe("42");
    expect(copyCellText(false)).toBe("false");
    expect(copyCellText({ a: 1 })).toBe('{"a":1}');
  });

  it("marks NULL in a copied CSV row too, still quoted as CSV", () => {
    expect(csvCopyCell(null)).toBe("NULL");
    expect(csvCopyCell("a,b")).toBe('"a,b"');
    expect(csvCopyCell('a"b')).toBe('"a""b"');
    expect(csvCopyCell("=cmd")).toBe("'=cmd");
  });
});
