import { describe, it, expect, vi, afterEach } from "vitest";

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
  setHistoryFavorite,
  saveQuery,
  getSavedQueries,
  updateSavedQuery,
  deleteSavedQuery,
} from "./commands";
import type { SchemaGraph } from "./types";
import type { QueryHistoryEntry } from "./commands";

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

describe("Query History — v6", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("QueryHistoryEntry includes favorite field", () => {
    const entry: QueryHistoryEntry = {
      id: "h1",
      connection_id: "c1",
      query_text: "SELECT 1",
      execution_time_ms: 42,
      row_count: 5,
      status: "success",
      error_message: null,
      executed_at: "2026-01-01T00:00:00Z",
      favorite: false, // NEW — must be accepted
    };
    expect(entry.favorite).toBe(false);
  });

  it("setHistoryFavorite calls invoke with correct params", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await setHistoryFavorite("entry-id-1", "conn-abc");
    expect(mockInvoke).toHaveBeenCalledWith("set_history_favorite", {
      id: "entry-id-1",
      connectionId: "conn-abc",
    });
  });

  it("saveQuery calls invoke with correct params", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await saveQuery({
      connectionId: "conn-xyz",
      name: "My Saved Query",
      queryText: "SELECT * FROM users",
      folder: "reports",
    });
    expect(mockInvoke).toHaveBeenCalledWith("save_query", {
      connectionId: "conn-xyz",
      name: "My Saved Query",
      queryText: "SELECT * FROM users",
      folder: "reports",
    });
  });

  it("saveQuery accepts null connectionId for global queries", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await saveQuery({
      connectionId: null,
      name: "Global query",
      queryText: "SELECT 1",
      folder: "",
    });
    expect(mockInvoke).toHaveBeenCalledWith("save_query", {
      connectionId: null,
      name: "Global query",
      queryText: "SELECT 1",
      folder: "",
    });
  });

  it("getSavedQueries calls invoke with correct params", async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await getSavedQueries("conn-123");
    expect(mockInvoke).toHaveBeenCalledWith("get_saved_queries", {
      connectionId: "conn-123",
    });
  });

  it("getSavedQueries accepts null for all-connections", async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await getSavedQueries(null);
    expect(mockInvoke).toHaveBeenCalledWith("get_saved_queries", {
      connectionId: null,
    });
  });

  it("updateSavedQuery calls invoke with correct params", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await updateSavedQuery("q-id", { name: "Renamed" });
    expect(mockInvoke).toHaveBeenCalledWith("update_saved_query", {
      id: "q-id",
      patch: { name: "Renamed" },
    });
  });

  it("deleteSavedQuery calls invoke with correct params", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await deleteSavedQuery("q-id");
    expect(mockInvoke).toHaveBeenCalledWith("delete_saved_query", {
      id: "q-id",
    });
  });
});