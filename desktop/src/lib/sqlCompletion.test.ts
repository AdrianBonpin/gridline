import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSqlSuggestions,
  SQL_KEYWORDS,
  parseTableRef,
  buildColumnSuggestions,
  getColumnsForTable,
  getCachedColumns,
  invalidateColumnCache,
} from "./sqlCompletion";
import type { TableInfo } from "./types";
import { getSchemaGraph } from "./commands";

vi.mock("./commands", () => ({
  getSchemaGraph: vi.fn(),
}));

const mockGetSchemaGraph = vi.mocked(getSchemaGraph);

const tables: TableInfo[] = [
  { name: "users", schema: "public", table_type: "TABLE" },
  { name: "orders", schema: "public", table_type: "TABLE" },
  { name: "audit_log", schema: "audit", table_type: "TABLE" },
];

describe("parseTableRef", () => {
  it("parses a bare table before the cursor dot", () => {
    expect(parseTableRef("SELECT * FROM users.")).toEqual({
      schema: null,
      table: "users",
    });
  });

  it("parses a schema-qualified table", () => {
    expect(parseTableRef("SELECT * FROM public.users.")).toEqual({
      schema: "public",
      table: "users",
    });
  });

  it("returns null when there is no trailing dot", () => {
    expect(parseTableRef("SELECT * FROM users WHERE id")).toBeNull();
    expect(parseTableRef("SELECT")).toBeNull();
    expect(parseTableRef("")).toBeNull();
  });
});

describe("buildColumnSuggestions", () => {
  it("maps columns to column-kind suggestions", () => {
    const suggestions = buildColumnSuggestions([
      { name: "id" },
      { name: "email" },
    ]);
    expect(suggestions).toEqual([
      { label: "id", insertText: "id", kind: "column" },
      { label: "email", insertText: "email", kind: "column" },
    ]);
  });
});

const appdb = { connectionId: "c1", database: "appdb" };
const analytics = { connectionId: "c1", database: "analytics" };
const otherConnection = { connectionId: "c2", database: "appdb" };

describe("getColumnsForTable", () => {
  beforeEach(() => {
    mockGetSchemaGraph.mockReset();
    invalidateColumnCache();
  });

  it("fetches columns from the schema graph and caches them", async () => {
    mockGetSchemaGraph.mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [{ name: "id" } as never],
        },
      ],
      relationships: [],
    } as never);

    const cols = await getColumnsForTable(appdb, "public", "users");
    expect(cols.map((c) => c.name)).toEqual(["id"]);
    expect(mockGetSchemaGraph).toHaveBeenCalledTimes(1);

    // cached: a second lookup does not refetch
    await getColumnsForTable(appdb, "public", "users");
    expect(mockGetSchemaGraph).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the fetch fails", async () => {
    mockGetSchemaGraph.mockRejectedValue(new Error("boom"));
    const cols = await getColumnsForTable(appdb, "public", "orders");
    expect(cols).toEqual([]);
  });

  it("exposes cached columns synchronously", async () => {
    mockGetSchemaGraph.mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [{ name: "id" } as never],
        },
      ],
      relationships: [],
    } as never);
    await getColumnsForTable(appdb, "public", "users");
    expect(getCachedColumns(appdb, "public", "users")?.map((c) => c.name)).toEqual([
      "id",
    ]);
    expect(getCachedColumns(appdb, "public", "missing")).toBeUndefined();
  });

  it("never hands one origin's columns to another", async () => {
    mockGetSchemaGraph.mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [{ name: "appdb_column" } as never],
        },
      ],
      relationships: [],
    } as never);
    await getColumnsForTable(appdb, "public", "users");

    // The same table name in another database is a different table: the cache
    // must not answer for it before its own introspection has run.
    expect(getCachedColumns(analytics, "public", "users")).toBeUndefined();
    expect(getCachedColumns(otherConnection, "public", "users")).toBeUndefined();

    mockGetSchemaGraph.mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [{ name: "analytics_column" } as never],
        },
      ],
      relationships: [],
    } as never);
    const cols = await getColumnsForTable(analytics, "public", "users");
    expect(cols.map((c) => c.name)).toEqual(["analytics_column"]);
    // appdb's entry is untouched
    expect(getCachedColumns(appdb, "public", "users")?.map((c) => c.name)).toEqual([
      "appdb_column",
    ]);
  });

  it("drops every cached origin's columns when metadata is invalidated", async () => {
    mockGetSchemaGraph.mockResolvedValue({
      tables: [
        {
          name: "users",
          schema: "public",
          table_type: "TABLE",
          columns: [{ name: "id" } as never],
        },
      ],
      relationships: [],
    } as never);
    await getColumnsForTable(appdb, "public", "users");
    expect(getCachedColumns(appdb, "public", "users")).toHaveLength(1);

    // Relevant DDL / a reconnect invalidates the mapping, so the next lookup
    // re-introspects instead of suggesting columns that may no longer exist.
    invalidateColumnCache();
    expect(getCachedColumns(appdb, "public", "users")).toBeUndefined();
    await getColumnsForTable(appdb, "public", "users");
    expect(mockGetSchemaGraph).toHaveBeenCalledTimes(2);
  });
});

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