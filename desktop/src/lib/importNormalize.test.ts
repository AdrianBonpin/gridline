import { describe, it, expect } from "vitest";
import {
  normalizeImport,
  assertImportByteLimit,
  MAX_IMPORT_BYTES,
} from "./importNormalize";

describe("normalizeImport", () => {
  it("parses CSV input into positional cells", () => {
    expect(normalizeImport("a,b\n1,2\n3,4")).toEqual({
      headers: ["a", "b"],
      rows: [
        [{ kind: "text", value: "1" }, { kind: "text", value: "2" }],
        [{ kind: "text", value: "3" }, { kind: "text", value: "4" }],
      ],
    });
  });

  it("parses a JSON array of objects", () => {
    expect(normalizeImport('[{"a":"1","b":"2"},{"a":"3","b":"4"}]')).toEqual({
      headers: ["a", "b"],
      rows: [
        [{ kind: "text", value: "1" }, { kind: "text", value: "2" }],
        [{ kind: "text", value: "3" }, { kind: "text", value: "4" }],
      ],
    });
  });

  it("parses a JSON object whose sole value is an array", () => {
    expect(normalizeImport('{"data":[{"x":"10","y":"20"},{"x":"30","y":"40"}]}')).toEqual({
      headers: ["x", "y"],
      rows: [
        [{ kind: "text", value: "10" }, { kind: "text", value: "20" }],
        [{ kind: "text", value: "30" }, { kind: "text", value: "40" }],
      ],
    });
  });

  it("throws on empty input", () => {
    expect(() => normalizeImport("")).toThrow(/empty/i);
    expect(() => normalizeImport("   ")).toThrow(/empty/i);
  });

  it("throws on invalid JSON", () => {
    expect(() => normalizeImport('{"a":')).toThrow(/invalid json/i);
  });

  // ── CSV: empty string versus NULL ───────────────────────────────────────
  it("keeps an unquoted empty CSV field as NULL and a quoted one as empty text", () => {
    const { rows } = normalizeImport('a,b\n"",');
    expect(rows[0][0]).toEqual({ kind: "text", value: "" });
    expect(rows[0][1]).toEqual({ kind: "null" });
  });

  // ── JSON: null, missing keys, and nested structure ──────────────────────
  it("keeps JSON null as NULL and an empty string as empty text", () => {
    const { rows } = normalizeImport('[{"a":null,"b":""}]');
    expect(rows[0][0]).toEqual({ kind: "null" });
    expect(rows[0][1]).toEqual({ kind: "text", value: "" });
  });

  it("keeps nested JSON structure instead of stringifying it", () => {
    const { headers, rows } = normalizeImport('[{"meta":{"a":[1,2]},"n":7,"ok":true}]');
    expect(headers).toEqual(["meta", "n", "ok"]);
    expect(rows[0][0]).toEqual({ kind: "json", value: { a: [1, 2] } });
    expect(rows[0][1]).toEqual({ kind: "json", value: 7 });
    expect(rows[0][2]).toEqual({ kind: "json", value: true });
  });

  it("takes headers from every row, so a late key is not dropped", () => {
    const { headers, rows } = normalizeImport('[{"a":1},{"b":2}]');
    expect(headers).toEqual(["a", "b"]);
    expect(rows[0][1]).toEqual({ kind: "null" });
    expect(rows[1][0]).toEqual({ kind: "null" });
  });

  // ── Positional columns ──────────────────────────────────────────────────
  it("keeps duplicate JSON keys out of the picture but duplicate CSV headers positional", () => {
    const { headers, rows } = normalizeImport("id,id\n001,002");
    expect(headers).toEqual(["id", "id"]);
    expect(rows[0]).toEqual([
      { kind: "text", value: "001" },
      { kind: "text", value: "002" },
    ]);
  });

  // ── Size cap ────────────────────────────────────────────────────────────
  it("reports an oversized source instead of parsing it", () => {
    expect(() => assertImportByteLimit(MAX_IMPORT_BYTES)).not.toThrow();
    expect(() => assertImportByteLimit(MAX_IMPORT_BYTES + 1)).toThrow(/limit/i);
  });
});
