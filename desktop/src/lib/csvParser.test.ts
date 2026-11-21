import { describe, it, expect } from "vitest";
import { parseCsv } from "./csvParser";

/** A plain (unquoted) cell. */
const t = (text: string) => ({ text, quoted: false });
/** A quoted cell — an empty quoted cell is an empty STRING, not NULL. */
const q = (text: string) => ({ text, quoted: true });

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual({
      headers: ["a", "b", "c"],
      rows: [[t("1"), t("2"), t("3")], [t("4"), t("5"), t("6")]],
    });
  });

  it("handles quoted fields containing commas and quotes", () => {
    expect(parseCsv('x,y\n"a,b","c""d"""')).toEqual({
      headers: ["x", "y"],
      rows: [[q("a,b"), q('c"d"')]],
    });
  });

  it("supports CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual({
      headers: ["a", "b"],
      rows: [[t("1"), t("2")]],
    });
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFa,b\n1,2")).toEqual({
      headers: ["a", "b"],
      rows: [[t("1"), t("2")]],
    });
  });

  it("returns empty rows for header-only input", () => {
    expect(parseCsv("a,b,c")).toEqual({ headers: ["a", "b", "c"], rows: [] });
  });

  it("errors on empty input", () => {
    expect(() => parseCsv("")).toThrow(/empty/i);
  });

  it("ignores trailing blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n")).toEqual({
      headers: ["a", "b"],
      rows: [[t("1"), t("2")]],
    });
  });

  // ── Empty string versus NULL ────────────────────────────────────────────
  // An unquoted empty field is absent data (NULL); a quoted empty field is a
  // deliberate empty string. The parser has to keep them distinguishable,
  // because only the declared column type can decide what they mean.
  it("distinguishes a quoted empty field from an unquoted one", () => {
    expect(parseCsv('a,b\n"",')).toEqual({
      headers: ["a", "b"],
      rows: [[q(""), t("")]],
    });
  });

  // ── Source columns are positional ───────────────────────────────────────
  it("keeps duplicate headers as distinct positional columns", () => {
    const parsed = parseCsv("id,id\n1,2");
    expect(parsed.headers).toEqual(["id", "id"]);
    expect(parsed.rows).toEqual([[t("1"), t("2")]]);
  });

  // ── Malformed input is refused, never repaired ──────────────────────────
  it("refuses a field whose quote is never closed", () => {
    expect(() => parseCsv('a,b\n"1,2')).toThrow(/unterminated quoted field/i);
  });

  it("refuses a stray quote inside an unquoted field", () => {
    expect(() => parseCsv('a,b\n1"2,3')).toThrow(/stray quote/i);
  });

  it("refuses text glued onto a closing quote", () => {
    expect(() => parseCsv('a,b\n"x"y,2')).toThrow(/after a closing quote/i);
  });

  it("refuses a row narrower than the header instead of padding it", () => {
    expect(() => parseCsv("a,b\n1,2\n3")).toThrow(/row 2/i);
    expect(() => parseCsv("a,b\n1,2\n3")).toThrow(/1 field/i);
    expect(() => parseCsv("a,b\n1,2\n3")).toThrow(/2/);
  });

  it("refuses a row wider than the header instead of truncating it", () => {
    expect(() => parseCsv("a,b\n1,2,3")).toThrow(/row 1/i);
    expect(() => parseCsv("a,b\n1,2,3")).toThrow(/3 fields/i);
  });
});
