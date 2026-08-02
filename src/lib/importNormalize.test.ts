import { describe, it, expect } from "vitest";
import { normalizeImport, coerceRow } from "./importNormalize";

describe("normalizeImport", () => {
  it("parses CSV input", () => {
    expect(normalizeImport("a,b\n1,2\n3,4")).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("parses a JSON array of objects", () => {
    expect(normalizeImport('[{"a":"1","b":"2"},{"a":"3","b":"4"}]')).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("parses a JSON object whose sole value is an array", () => {
    expect(normalizeImport('{"data":[{"x":"10","y":"20"},{"x":"30","y":"40"}]}')).toEqual({
      headers: ["x", "y"],
      rows: [
        ["10", "20"],
        ["30", "40"],
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
});

describe("coerceRow", () => {
  it("converts empty strings to null", () => {
    expect(coerceRow("")).toBeNull();
  });

  it("converts boolean literals", () => {
    expect(coerceRow("true")).toBe(true);
    expect(coerceRow("false")).toBe(false);
  });

  it("converts numeric strings to numbers", () => {
    expect(coerceRow("42")).toBe(42);
    expect(coerceRow("4.5")).toBe(4.5);
    expect(coerceRow("-7")).toBe(-7);
  });

  it("keeps other values as strings", () => {
    expect(coerceRow("abc")).toBe("abc");
    expect(coerceRow("12abc")).toBe("12abc");
  });
});