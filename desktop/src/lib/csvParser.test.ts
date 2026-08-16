import { describe, it, expect } from "vitest";
import { parseCsv } from "./csvParser";

describe("parseCsv", () => {
  it("parses a simple header + rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual({
      headers: ["a", "b", "c"], rows: [["1", "2", "3"], ["4", "5", "6"]],
    });
  });

  it("handles quoted fields containing commas and quotes", () => {
    expect(parseCsv('x,y\n"a,b","c""d"""')).toEqual({
      headers: ["x", "y"], rows: [["a,b", 'c"d"']],
    });
  });

  it("supports CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("strips a leading UTF-8 BOM", () => {
    expect(parseCsv("\uFEFFa,b\n1,2")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("returns empty rows for header-only input", () => {
    expect(parseCsv("a,b,c")).toEqual({ headers: ["a", "b", "c"], rows: [] });
  });

  it("errors on empty input", () => {
    expect(() => parseCsv("")).toThrow(/empty/i);
  });

  it("ragged rows pad with empty strings", () => {
    expect(parseCsv("a,b\n1")).toEqual({ headers: ["a", "b"], rows: [["1", ""]] });
  });
});