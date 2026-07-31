import { describe, it, expect } from "vitest";
import { buildSqlSuggestions, SQL_KEYWORDS } from "./sqlCompletion";
import type { TableInfo } from "./types";

const tables: TableInfo[] = [
  { name: "users", schema: "public", table_type: "TABLE" },
  { name: "orders", schema: "public", table_type: "TABLE" },
  { name: "audit_log", schema: "audit", table_type: "TABLE" },
];

describe("buildSqlSuggestions", () => {
  it("includes core SQL keywords", () => {
    const suggestions = buildSqlSuggestions([], null);
    const labels = suggestions.map((s) => s.label);
    for (const kw of ["SELECT", "FROM", "WHERE", "JOIN", "INSERT"]) {
      expect(labels).toContain(kw);
    }
  });

  it("labels keywords as keyword kind", () => {
    const suggestions = buildSqlSuggestions([], null);
    const select = suggestions.find((s) => s.label === "SELECT");
    expect(select?.kind).toBe("keyword");
    expect(select?.insertText).toBe("SELECT");
  });

  it("includes table names from the current schema", () => {
    const suggestions = buildSqlSuggestions(tables, "public");
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain("users");
    expect(labels).toContain("orders");
    expect(labels).not.toContain("audit_log");
  });

  it("includes all tables when no schema is selected", () => {
    const suggestions = buildSqlSuggestions(tables, null);
    const labels = suggestions.map((s) => s.label);
    expect(labels).toContain("audit_log");
  });

  it("labels tables as table kind", () => {
    const suggestions = buildSqlSuggestions(tables, "public");
    const users = suggestions.find((s) => s.label === "users");
    expect(users?.kind).toBe("table");
  });

  it("exports a non-empty keyword list", () => {
    expect(SQL_KEYWORDS.length).toBeGreaterThan(20);
  });
});