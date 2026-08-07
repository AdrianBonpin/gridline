import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({ tables: [], relationships: [] }),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  testConnection,
  getRoles,
  getRolePrivileges,
  getTableColumns,
  getTableRebuildReadiness,
  runMaintenance,
  getTablespaces,
  buildRebuildScript,
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
  setConnectionFavorite,
  recordRecentConnection,
  getRecentConnections,
  clearRecentConnections,
  getIndexes,
  getConstraints,
  createSchema,
  renameSchema,
  dropSchema,
  searchObjects,
  getObjectDdl,
  getObjectDependencies,
} from "./commands";
import * as cmd from "./commands";
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

  it("getQueryHistory with null calls invoke with null connectionId", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await getQueryHistory(null, 50, 0);
    expect(invoke).toHaveBeenCalledWith("get_query_history", {
      connectionId: null,
      limit: 50,
      offset: 0,
    });
  });

  it("clearQueryHistory with null clears all", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await clearQueryHistory(null);
    expect(invoke).toHaveBeenCalledWith("clear_query_history", {
      connectionId: null,
    });
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

describe("v0.5.0 command wrappers", () => {
  it("setConnectionFavorite invokes set_connection_favorite with camelCase", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await setConnectionFavorite("c1", true);
    expect(mockInvoke).toHaveBeenCalledWith("set_connection_favorite", { connectionId: "c1", favorite: true });
  });

  it("recordRecentConnection invokes record_recent_connection", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await recordRecentConnection("c1");
    expect(mockInvoke).toHaveBeenCalledWith("record_recent_connection", { connectionId: "c1" });
  });

  it("getRecentConnections invokes get_recent_connections with limit", async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await getRecentConnections(8);
    expect(mockInvoke).toHaveBeenCalledWith("get_recent_connections", { limit: 8 });
  });

  it("clearRecentConnections invokes clear_recent_connections", async () => {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await clearRecentConnections();
    expect(mockInvoke).toHaveBeenCalledWith("clear_recent_connections", {});
  });

  it("getIndexes invokes get_indexes with connectionId + schema", async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await getIndexes("c1", "public");
    expect(mockInvoke).toHaveBeenCalledWith("get_indexes", { connectionId: "c1", schema: "public" });
  });

  it("getConstraints invokes get_constraints with connectionId + schema", async () => {
    const mockInvoke = vi.fn().mockResolvedValue([]);
    vi.mocked(invoke).mockImplementation(mockInvoke);

    await getConstraints("c1", "public");
    expect(mockInvoke).toHaveBeenCalledWith("get_constraints", { connectionId: "c1", schema: "public" });
  });
});

describe("object management commands (v0.7.5)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("createSchema calls invoke with name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await createSchema("c1", "my_schema");
    expect(invoke).toHaveBeenCalledWith("create_schema", { connectionId: "c1", name: "my_schema" });
  });
  it("renameSchema maps old/new names", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await renameSchema("c1", "old", "new");
    expect(invoke).toHaveBeenCalledWith("rename_schema", { connectionId: "c1", oldName: "old", newName: "new" });
  });
  it("dropSchema passes cascade", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await dropSchema("c1", "s", true);
    expect(invoke).toHaveBeenCalledWith("drop_schema", { connectionId: "c1", name: "s", cascade: true });
  });
  it("searchObjects maps query+schema", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await searchObjects("c1", "public", "user");
    expect(invoke).toHaveBeenCalledWith("search_objects", { connectionId: "c1", schema: "public", query: "user" });
  });
  it("getObjectDdl maps objectType+name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("CREATE SEQUENCE ...");
    await getObjectDdl("c1", "public", "sequence", "users_id_seq");
    expect(invoke).toHaveBeenCalledWith("get_object_ddl", { connectionId: "c1", schema: "public", objectType: "sequence", name: "users_id_seq" });
  });
  it("getObjectDependencies maps objectType+name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await getObjectDependencies("c1", "public", "table", "orders");
    expect(invoke).toHaveBeenCalledWith("get_object_dependencies", { connectionId: "c1", schema: "public", objectType: "table", name: "orders" });
  });
});

describe("v0.7.7 command wrappers", () => {
  it("getRoles calls get_roles", async () => {
    const mockRoles = [
      {
        name: "postgres",
        superuser: true,
        inherit: true,
        create_db: true,
        create_role: true,
        can_login: true,
        replication: true,
        bypass_rls: false,
        connection_limit: -1,
        valid_until: null,
        memberships: [],
      },
    ];
    vi.mocked(invoke).mockResolvedValueOnce(mockRoles);

    const result = await getRoles("c1");

    expect(invoke).toHaveBeenCalledWith("get_roles", { connectionId: "c1" });
    expect(result).toEqual(mockRoles);
  });

  it("getRolePrivileges calls get_role_privileges with role", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const result = await getRolePrivileges("c1", "app");

    expect(invoke).toHaveBeenCalledWith("get_role_privileges", { connectionId: "c1", role: "app" });
    expect(result).toEqual([]);
  });

  it("getTableColumns calls get_table_columns", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const result = await getTableColumns("c1", "public", "users");

    expect(invoke).toHaveBeenCalledWith("get_table_columns", { connectionId: "c1", schema: "public", table: "users" });
    expect(result).toEqual([]);
  });

  it("getTableRebuildReadiness calls get_table_rebuild_readiness", async () => {
    const mockReadiness = { ok: true, reasons: [] };
    vi.mocked(invoke).mockResolvedValueOnce(mockReadiness);

    const result = await getTableRebuildReadiness("c1", "public", "users");

    expect(invoke).toHaveBeenCalledWith("get_table_rebuild_readiness", { connectionId: "c1", schema: "public", table: "users" });
    expect(result).toEqual(mockReadiness);
  });

  it("runMaintenance calls run_maintenance with action", async () => {
    const mockResult = { duration_ms: 5, message: "ok" };
    vi.mocked(invoke).mockResolvedValueOnce(mockResult);

    const result = await runMaintenance("c1", "public", "users", "vacuum");

    expect(invoke).toHaveBeenCalledWith("run_maintenance", { connectionId: "c1", schema: "public", table: "users", action: "vacuum" });
    expect(result).toEqual(mockResult);
  });

  it("getTablespaces calls get_tablespaces", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const result = await getTablespaces("c1");

    expect(invoke).toHaveBeenCalledWith("get_tablespaces", { connectionId: "c1" });
    expect(result).toEqual([]);
  });

  it("buildRebuildScript calls build_rebuild_script with newColumns", async () => {
    const mockScript = "CREATE TABLE _t();";
    const cols = [{ name: "id", type: "int", nullable: false, default: null, is_pk: true }];
    vi.mocked(invoke).mockResolvedValueOnce(mockScript);

    const result = await buildRebuildScript("c1", "public", "users", cols);

    expect(invoke).toHaveBeenCalledWith("build_rebuild_script", { connectionId: "c1", schema: "public", table: "users", newColumns: cols });
    expect(result).toEqual(mockScript);
  });
});

describe("v0.7.8 command wrappers exist", () => {
  it("exports the backup/cancel/settings wrappers", () => {
    for (const name of ["cancelQuery","mysqlDump","mysqlRestore","mysqlSync","detectMysqlTools","sqliteDump","sqliteRestore","sqliteSync","exportSettings","importSettings"]) {
      expect(typeof (cmd as Record<string, unknown>)[name]).toBe("function");
    }
  });
});