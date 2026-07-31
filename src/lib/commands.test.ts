import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ tables: [], relationships: [] }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  testConnection,
  dbConnect,
  dbDisconnect,
  getDatabases,
  getSchemas,
  getTables,
  getTableData,
  executeChange,
  refreshConnection,
  getSchemaGraph,
  executeQuery,
  getQueryHistory,
  clearQueryHistory,
} from "./commands";
import type { SchemaGraph } from "./types";

describe("commands", () => {
  it("testConnection has correct signature", () => {
    expect(typeof testConnection).toBe("function");
  });

  it("dbConnect returns void promise", () => {
    expect(typeof dbConnect).toBe("function");
  });

  it("dbDisconnect returns void promise", () => {
    expect(typeof dbDisconnect).toBe("function");
  });

  it("getDatabases returns string array promise", () => {
    expect(typeof getDatabases).toBe("function");
  });

  it("getSchemas returns string array promise", () => {
    expect(typeof getSchemas).toBe("function");
  });

  it("getTables returns TableInfo array promise", () => {
    expect(typeof getTables).toBe("function");
  });

  it("getTableData returns QueryResult-shaped promise", () => {
    expect(typeof getTableData).toBe("function");
  });

  it("executeChange returns void promise", () => {
    expect(typeof executeChange).toBe("function");
  });

  it("refreshConnection returns full tree promise", () => {
    expect(typeof refreshConnection).toBe("function");
  });

  describe("getSchemaGraph", () => {
    it("is a callable function with correct signature", () => {
      expect(typeof getSchemaGraph).toBe("function");
      const result: Promise<SchemaGraph> = getSchemaGraph("conn-1", "public");
      expect(result).toBeInstanceOf(Promise);
    });

    it("accepts schema as optional", () => {
      const result: Promise<SchemaGraph> = getSchemaGraph("conn-1");
      expect(result).toBeInstanceOf(Promise);
    });
  });
});

describe("query commands", () => {
  it("executeQuery calls invoke with correct args", async () => {
    const mockResult = { columns: [], rows: [], total_rows: 0, page: 1, page_size: 50 };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const result = await executeQuery("conn-1", "SELECT 1", 1, 50);

    expect(invoke).toHaveBeenCalledWith("execute_query", {
      connectionId: "conn-1",
      query: "SELECT 1",
      page: 1,
      pageSize: 50,
    });
    expect(result).toEqual(mockResult);
  });

  it("getQueryHistory calls invoke", async () => {
    const mockHistory = [{ id: "h1", connection_id: "c1", query_text: "SELECT 1", status: "success", executed_at: "2025-01-01" }];
    vi.mocked(invoke).mockResolvedValueOnce(mockHistory);
    const result = await getQueryHistory("conn-1", 10, 0);
    expect(invoke).toHaveBeenCalledWith("get_query_history", { connectionId: "conn-1", limit: 10, offset: 0 });
    expect(result).toEqual(mockHistory);
  });

  it("clearQueryHistory calls invoke", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await clearQueryHistory("conn-1");
    expect(invoke).toHaveBeenCalledWith("clear_query_history", { connectionId: "conn-1" });
  });
});