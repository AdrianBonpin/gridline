import { describe, it, expect } from "vitest";
import {
  importColumnKind,
  planImport,
  convertImportRows,
  type ImportTargetColumn,
} from "./importConvert";
import type { ImportCell } from "./importNormalize";

const targets = (...pairs: Array<[string, string | null]>): ImportTargetColumn[] =>
  pairs.map(([name, dataType]) => ({ name, dataType }));

const text = (value: string): ImportCell => ({ kind: "text", value });
const jsonCell = (value: unknown): ImportCell => ({ kind: "json", value });
const nullCell: ImportCell = { kind: "null" };

/** Plan source column 0 into the only target column. */
function single(target: ImportTargetColumn) {
  const result = planImport([target], [0]);
  if (!result.ok) throw new Error(result.error);
  return result.plan;
}

function convertOne(dataType: string, cell: ImportCell) {
  const plan = single({ name: "value", dataType });
  return convertImportRows(["value"], [[cell]], plan);
}

describe("importColumnKind", () => {
  it("classifies declared types, not appearances", () => {
    expect(importColumnKind("integer")).toBe("integer");
    expect(importColumnKind("bigint")).toBe("integer");
    expect(importColumnKind("int8")).toBe("integer");
    expect(importColumnKind("smallint")).toBe("integer");
    expect(importColumnKind("serial")).toBe("integer");
    expect(importColumnKind("INTEGER")).toBe("integer");
    expect(importColumnKind("numeric")).toBe("decimal");
    expect(importColumnKind("NUMERIC(12, 4)")).toBe("decimal");
    expect(importColumnKind("decimal(10,2)")).toBe("decimal");
    expect(importColumnKind("double precision")).toBe("decimal");
    expect(importColumnKind("real")).toBe("decimal");
    expect(importColumnKind("boolean")).toBe("boolean");
    expect(importColumnKind("bool")).toBe("boolean");
    expect(importColumnKind("json")).toBe("json");
    expect(importColumnKind("jsonb")).toBe("json");
    expect(importColumnKind("date")).toBe("temporal");
    expect(importColumnKind("timestamp without time zone")).toBe("temporal");
    expect(importColumnKind("timestamptz")).toBe("temporal");
    expect(importColumnKind("character varying")).toBe("text");
    expect(importColumnKind("VARCHAR(20)")).toBe("text");
    expect(importColumnKind("uuid")).toBe("text");
    expect(importColumnKind("ARRAY")).toBe("text");
    expect(importColumnKind("integer[]")).toBe("text");
    expect(importColumnKind(null)).toBe("text");
    expect(importColumnKind(undefined)).toBe("text");
  });
});

describe("planImport", () => {
  it("maps source columns by position", () => {
    const result = planImport(
      targets(["a", "integer"], ["b", "text"], ["c", "text"]),
      [2, null, 0],
    );
    expect(result).toEqual({
      ok: true,
      plan: {
        columns: ["c", "a"],
        sourceIndexes: [0, 2],
        kinds: ["text", "integer"],
      },
    });
  });

  it("rejects the same target column mapped twice", () => {
    const result = planImport(targets(["a", "text"], ["b", "text"]), [1, 1]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/column "b"/i);
    expect(result.error).toMatch(/more than once|twice/i);
  });

  it("accepts two source columns that share a header when their targets differ", () => {
    expect(planImport(targets(["a", "text"], ["b", "text"]), [0, 1]).ok).toBe(true);
  });

  it("requires at least one mapped column", () => {
    const result = planImport(targets(["a", "text"]), [null]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/at least one column/i);
  });

  it("rejects a mapping that names a target that does not exist", () => {
    const result = planImport(targets(["a", "text"]), [4]);
    expect(result.ok).toBe(false);
  });
});

describe("convertImportRows — text columns keep text", () => {
  it("preserves leading zeros for a text identifier", () => {
    expect(convertOne("character varying", text("007"))).toEqual({ ok: true, rows: [["007"]] });
    expect(convertOne("varchar(20)", text("0123456789"))).toEqual({
      ok: true,
      rows: [["0123456789"]],
    });
  });

  it("keeps a numeric-looking value as the declared text", () => {
    expect(convertOne("text", text("42"))).toEqual({ ok: true, rows: [["42"]] });
    expect(convertOne("text", text("4.50"))).toEqual({ ok: true, rows: [["4.50"]] });
  });

  it("keeps boolean-looking text as text", () => {
    expect(convertOne("text", text("true"))).toEqual({ ok: true, rows: [["true"]] });
  });

  it("keeps the empty string and NULL distinct", () => {
    expect(convertOne("text", text(""))).toEqual({ ok: true, rows: [[""]] });
    expect(convertOne("text", nullCell)).toEqual({ ok: true, rows: [[null]] });
  });
});

describe("convertImportRows — numeric columns keep precision", () => {
  it("keeps a big integer exact instead of routing it through a double", () => {
    const out = convertOne("bigint", text("9007199254740993"));
    expect(out).toEqual({ ok: true, rows: [["9007199254740993"]] });
    if (!out.ok) return;
    expect(typeof out.rows[0][0]).toBe("string");
  });

  it("keeps an exact decimal instead of a float", () => {
    const digits = "0.1000000000000000055511151231257827";
    expect(convertOne("numeric(40, 34)", text(digits))).toEqual({ ok: true, rows: [[digits]] });
  });

  it("accepts a valid integer without lossy re-formatting", () => {
    expect(convertOne("integer", text("42"))).toEqual({ ok: true, rows: [["42"]] });
    expect(convertOne("integer", text("-7"))).toEqual({ ok: true, rows: [["-7"]] });
    expect(convertOne("numeric", text("-1.5e3"))).toEqual({ ok: true, rows: [["-1.5e3"]] });
  });

  it("rejects a value that is not valid for the declared numeric type", () => {
    const out = convertOne("integer", text("12abc"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0].row).toBe(1);
    expect(out.errors[0].column).toBe("value");
    expect(out.errors[0].message).toMatch(/not a valid integer/i);
  });

  it("rejects a fractional value for an integer column", () => {
    expect(convertOne("integer", text("1.5")).ok).toBe(false);
  });

  it("rejects an empty string for a numeric column", () => {
    expect(convertOne("integer", text("")).ok).toBe(false);
  });

  it("accepts NULL for a numeric column", () => {
    expect(convertOne("integer", nullCell)).toEqual({ ok: true, rows: [[null]] });
  });
});

describe("convertImportRows — boolean columns", () => {
  it("recognises the literal spellings", () => {
    for (const [raw, expected] of [
      ["true", true],
      ["FALSE", false],
      ["t", true],
      ["f", false],
      ["1", true],
      ["0", false],
      ["yes", true],
      ["no", false],
    ] as const) {
      expect(convertOne("boolean", text(raw))).toEqual({ ok: true, rows: [[expected]] });
    }
  });

  it("rejects a value that is not a boolean", () => {
    const out = convertOne("boolean", text("maybe"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].message).toMatch(/not a valid boolean/i);
  });
});

describe("convertImportRows — json columns keep structure", () => {
  it("passes a nested JSON value through unchanged", () => {
    const nested = { a: [1, { b: null }], c: "x" };
    expect(convertOne("jsonb", jsonCell(nested))).toEqual({ ok: true, rows: [[nested]] });
  });

  it("parses JSON text into structure rather than storing the string", () => {
    expect(convertOne("json", text('{"a":[1,2]}'))).toEqual({
      ok: true,
      rows: [[{ a: [1, 2] }]],
    });
  });

  it("rejects JSON text that does not parse", () => {
    const out = convertOne("jsonb", text("{oops"));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].message).toMatch(/not valid json/i);
  });

  it("refuses to stringify nested JSON into a text column", () => {
    const out = convertOne("text", jsonCell({ a: 1 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].message).toMatch(/nested/i);
  });

  it("stringifies a JSON scalar for a text column", () => {
    expect(convertOne("text", jsonCell(42))).toEqual({ ok: true, rows: [["42"]] });
    expect(convertOne("text", jsonCell(true))).toEqual({ ok: true, rows: [["true"]] });
  });
});

describe("convertImportRows — temporal columns", () => {
  it("passes the declared text through to the server", () => {
    expect(convertOne("timestamp without time zone", text("2024-01-02 03:04:05"))).toEqual({
      ok: true,
      rows: [["2024-01-02 03:04:05"]],
    });
    expect(convertOne("date", text("2024-01-02"))).toEqual({ ok: true, rows: [["2024-01-02"]] });
  });
});

describe("convertImportRows — reporting", () => {
  it("reports the data row and column of every invalid value", () => {
    const plan = planImport(targets(["age", "integer"], ["name", "text"]), [0, 1]);
    if (!plan.ok) throw new Error(plan.error);
    const out = convertImportRows(
      ["age", "name"],
      [
        [text("1"), text("ok")],
        [text("2"), text("ok")],
        [text("nope"), text("ok")],
      ],
      plan.plan,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ row: 3, column: "age", sourceColumn: "age" });
    expect(out.errors[0].message).toMatch(/row 3/i);
  });

  it("reports every bad value, not just the first", () => {
    const plan = planImport(targets(["age", "integer"]), [0]);
    if (!plan.ok) throw new Error(plan.error);
    const out = convertImportRows(["age"], [[text("x")], [text("y")]], plan.plan);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.map((e) => e.row)).toEqual([1, 2]);
  });

  it("names a duplicate source header by its position", () => {
    const plan = planImport(targets(["a", "integer"], ["b", "integer"]), [0, 1]);
    if (!plan.ok) throw new Error(plan.error);
    const out = convertImportRows(["id", "id"], [[text("x"), text("1")]], plan.plan);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors[0].sourceColumn).toBe("id (column 1)");
    expect(out.errors[0].column).toBe("a");
  });
});
