import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDbViewerStore } from "./dbViewerStore";
import type { QueryResult, TableInfo } from "../lib/types";
import * as commands from "../lib/commands";

vi.mock("../lib/commands", () => ({
  getDatabases: vi.fn(),
  getSchemas: vi.fn(),
  getTables: vi.fn(),
}));

beforeEach(() => {
  useDbViewerStore.getState().reset();
});

describe("dbViewerStore", () => {
  it("starts empty", () => {
    const state = useDbViewerStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.changesQueue).toEqual([]);
    expect(state.databases).toEqual([]);
    expect(state.schemas).toEqual([]);
    expect(state.tables).toEqual([]);
    expect(state.currentDatabase).toBeNull();
    expect(state.currentSchema).toBeNull();
    expect(state.objectSearchOpen).toBe(false);
    expect(state.selectedObjectType).toBeNull();
    expect(state.schemaTreeLoading).toBe(false);
  });

  it("object search open + selected object type setters", () => {
    const { setObjectSearchOpen, setSelectedObjectType } =
      useDbViewerStore.getState();
    setObjectSearchOpen(true);
    expect(useDbViewerStore.getState().objectSearchOpen).toBe(true);
    setSelectedObjectType("functions");
    expect(useDbViewerStore.getState().selectedObjectType).toBe("functions");
    setSelectedObjectType(null);
    expect(useDbViewerStore.getState().selectedObjectType).toBeNull();
  });

  it("openTab adds a new tab", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
    const tab = state.tabs[0];
    expect(tab.schema).toBe("public");
    expect(tab.table).toBe("users");
    expect(tab.page).toBe(1);
    expect(state.activeTabId).toBe(tab.id);
  });

  it("openTab does not duplicate", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.openTab("public", "users");
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
  });

  it("openTab forceNew creates duplicate", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.openTab("public", "users");
    const tabsAfterTwo = useDbViewerStore.getState().tabs;
    expect(tabsAfterTwo).toHaveLength(1);

    store.openTab("public", "users", true);
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(2);
  });

  it("closeTab removes tab and switches activeTabId", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tab1Id = useDbViewerStore.getState().tabs[0].id;
    store.openTab("public", "posts", true);

    store.closeTab(tab1Id);
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  it("closeTabsForTable closes matching table tabs and keeps others", () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    useDbViewerStore.getState().closeTabsForTable("public", "users");
    const tabs = useDbViewerStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].table).toBe("posts");
  });

  it("closeTabsForTable fixes the active tab when it is closed", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const usersId = useDbViewerStore.getState().tabs[0].id;
    useDbViewerStore.getState().openTab("public", "posts", true);
    useDbViewerStore.getState().setActiveTab(usersId);
    useDbViewerStore.getState().closeTabsForTable("public", "users");
    const st = useDbViewerStore.getState();
    expect(st.tabs).toHaveLength(1);
    expect(st.activeTabId).toBe(st.tabs[0].id);
  });

  it("reorderTab moves a tab and keeps the active tab by id", () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    useDbViewerStore.getState().openTab("public", "comments", true);
    const before = useDbViewerStore.getState().tabs;
    const activeId = useDbViewerStore.getState().activeTabId;
    const activeTable = before.find((t) => t.id === activeId)!.table;

    useDbViewerStore.getState().reorderTab(0, 2);
    const after = useDbViewerStore.getState().tabs;
    expect(after.map((t) => t.table)).toEqual(["posts", "comments", "users"]);
    // Active tab must follow the moved item (tracked by id, not index).
    expect(useDbViewerStore.getState().activeTabId).toBe(activeId);
    expect(after.find((t) => t.id === activeId)!.table).toBe(activeTable);
  });

  it("reorderTab ignores out-of-range and no-op moves", () => {
    useDbViewerStore.getState().openTab("public", "users");
    useDbViewerStore.getState().openTab("public", "posts", true);
    const reorderTab = useDbViewerStore.getState().reorderTab;
    reorderTab(0, 0);
    expect(useDbViewerStore.getState().tabs.map((t) => t.table)).toEqual([
      "users",
      "posts",
    ]);
    reorderTab(-1, 1);
    reorderTab(0, 5);
    expect(useDbViewerStore.getState().tabs.map((t) => t.table)).toEqual([
      "users",
      "posts",
    ]);
  });

  it("setPage updates pagination", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;

    store.setPage(tabId, 3);
    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.page).toBe(3);
  });

  it("setTabData updates tab data", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;

    // First set loading to true to verify it gets cleared
    store.setTabLoading(tabId, true);

    const mockData: QueryResult = {
      columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null,editable:true,is_generated:false},{name:"name",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null,editable:true,is_generated:false}],
      rows: [[1, "Alice"]],
      total_rows: 1, page: 1, page_size: 50,
    };
    store.setTabData(tabId, mockData);

    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.data).toEqual(mockData);
    expect(tab.loading).toBe(false);
    expect(tab.error).toBeNull();
  });

  it("setTabError sets error", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().tabs[0].id;

    store.setTabError(tabId, "Something went wrong");
    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.error).toBe("Something went wrong");
    expect(tab.loading).toBe(false);
  });

  it("addChange appends to queue", () => {
    const store = useDbViewerStore.getState();
    store.addChange({ type: "insert", sql: "INSERT INTO users (id) VALUES (1)" });

    const queue = useDbViewerStore.getState().changesQueue;
    expect(queue).toHaveLength(1);
    expect(queue[0].status).toBe("pending");
    expect(queue[0].id).toBeTruthy();
    expect(queue[0].createdAt).toBeGreaterThan(0);
  });

  it("addChange stages a bulk_insert with columns+rows", () => {
    useDbViewerStore.getState().addChange({
      type: "bulk_insert", schema: "public", table: "t",
      columns: ["a", "b"], rows: [[1, 2]], description: "Import",
    } as any);
    const q = useDbViewerStore.getState().changesQueue;
    expect(q[q.length - 1].type).toBe("bulk_insert");
    expect((q[q.length - 1] as any).columns).toEqual(["a", "b"]);
    expect((q[q.length - 1] as any).rows).toEqual([[1, 2]]);
  });

  it("cancelChange marks change as cancelled", () => {
    const store = useDbViewerStore.getState();
    store.addChange({ type: "insert", sql: "INSERT INTO users (id) VALUES (1)" });
    const changeId = useDbViewerStore.getState().changesQueue[0].id;

    store.cancelChange(changeId);
    const change = useDbViewerStore.getState().changesQueue[0];
    expect(change.status).toBe("cancelled");
  });

  it("markChangeCommitted updates status", () => {
    const store = useDbViewerStore.getState();
    store.addChange({ type: "insert", sql: "INSERT INTO users (id) VALUES (1)" });
    const changeId = useDbViewerStore.getState().changesQueue[0].id;

    store.markChangeCommitted(changeId);
    const change = useDbViewerStore.getState().changesQueue[0];
    expect(change.status).toBe("committed");
  });

  it("markChangeFailed updates status and records error", () => {
    const store = useDbViewerStore.getState();
    store.addChange({ type: "insert", sql: "INSERT INTO users (id) VALUES (1)" });
    const changeId = useDbViewerStore.getState().changesQueue[0].id;

    store.markChangeFailed(changeId, "Constraint violation");
    const change = useDbViewerStore.getState().changesQueue[0];
    expect(change.status).toBe("failed");
    expect(change.error).toBe("Constraint violation");
  });

  it("removeChange drops the change from the queue", () => {
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 1 }, description: "x" } as any);
    const id = useDbViewerStore.getState().changesQueue[0].id;
    useDbViewerStore.getState().removeChange(id);
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("clearChanges empties the queue", () => {
    useDbViewerStore.getState().addChange({ type: "insert", schema: "public", table: "t", newData: { a: 1 }, description: "x" } as any);
    useDbViewerStore.getState().addChange({ type: "delete", schema: "public", table: "t", primaryKey: { id: 1 }, description: "y" } as any);
    useDbViewerStore.getState().clearChanges();
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(0);
  });

  it("setSchemaTreeLoading toggles the loading flag", () => {
    const store = useDbViewerStore.getState();
    expect(useDbViewerStore.getState().schemaTreeLoading).toBe(false);
    store.setSchemaTreeLoading(true);
    expect(useDbViewerStore.getState().schemaTreeLoading).toBe(true);
    store.setSchemaTreeLoading(false);
    expect(useDbViewerStore.getState().schemaTreeLoading).toBe(false);
  });

  it("reset clears all state", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    store.addChange({ type: "insert", sql: "INSERT INTO users (id) VALUES (1)" });
    store.populate(["mydb"], ["public"], [{ name: "users", schema: "public", table_type: "TABLE" }]);

    store.reset();

    const state = useDbViewerStore.getState();
    expect(state.tabs).toEqual([]);
    expect(state.activeTabId).toBeNull();
    expect(state.changesQueue).toEqual([]);
    expect(state.databases).toEqual([]);
    expect(state.schemas).toEqual([]);
    expect(state.tables).toEqual([]);
    expect(state.currentDatabase).toBeNull();
    expect(state.currentSchema).toBeNull();
    expect(state.schemaTreeLoading).toBe(false);
  });

  it("populate sets databases, schemas, tables", () => {
    const tables: TableInfo[] = [
      { name: "users", schema: "public", table_type: "TABLE" },
      { name: "posts", schema: "public", table_type: "TABLE" },
    ];
    const store = useDbViewerStore.getState();
    store.populate(["mydb", "testdb"], ["public", "private"], tables);

    const state = useDbViewerStore.getState();
    expect(state.databases).toEqual(["mydb", "testdb"]);
    expect(state.schemas).toEqual(["public", "private"]);
    expect(state.tables).toEqual(tables);
  });

  it("stageCellEdit appends an update QueueItem with primaryKey + old/new data", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().activeTabId!;
    store.stageCellEdit({
      tabId,
      schema: "public",
      table: "users",
      primaryKey: { id: 1 },
      oldData: { name: "Alice" },
      newData: { name: "Alicia" },
      description: "Edit users.name",
    });
    const q = useDbViewerStore.getState().changesQueue;
    expect(q).toHaveLength(1);
    expect(q[0].type).toBe("update");
    expect(q[0].primaryKey).toEqual({ id: 1 });
    expect(q[0].oldData).toEqual({ name: "Alice" });
    expect(q[0].newData).toEqual({ name: "Alicia" });
  });

  it("re-staging the same cell replaces the pending entry (keeps original oldData)", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().activeTabId!;
    store.stageCellEdit({
      tabId, schema: "public", table: "users", primaryKey: { id: 1 },
      oldData: { name: "Alice" }, newData: { name: "Alicia" },
      description: "Edit users.name",
    });
    store.stageCellEdit({
      tabId, schema: "public", table: "users", primaryKey: { id: 1 },
      oldData: { name: "Alice" }, newData: { name: "Alicia 2" },
      description: "Edit users.name",
    });
    const q = useDbViewerStore.getState().changesQueue;
    expect(q).toHaveLength(1);
    expect(q[0].newData).toEqual({ name: "Alicia 2" });
    expect(q[0].oldData).toEqual({ name: "Alice" }); // original DB value preserved
  });

  it("staging a different cell appends a second entry", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "users");
    const tabId = useDbViewerStore.getState().activeTabId!;
    store.stageCellEdit({
      tabId, schema: "public", table: "users", primaryKey: { id: 1 },
      oldData: { name: "Alice" }, newData: { name: "Alicia" },
    });
    store.stageCellEdit({
      tabId, schema: "public", table: "users", primaryKey: { id: 1 },
      oldData: { age: 30 }, newData: { age: 31 },
    });
    expect(useDbViewerStore.getState().changesQueue).toHaveLength(2);
  });

  it("setIndexes / setConstraints update store slices", () => {
    const store = useDbViewerStore.getState();
    store.setIndexes([{ name: "idx", schema: "public", table: "t", definition: "", is_unique: true, method: "btree", columns: ["id"], size_bytes: 1, tablespace: null }]);
    store.setConstraints([{ name: "ck", schema: "public", table: "t", contype: "CHECK", definition: "", deferrable: false, validated: true, columns: ["x"] }]);
    expect(useDbViewerStore.getState().indexes).toHaveLength(1);
    expect(useDbViewerStore.getState().constraints).toHaveLength(1);
  });

  it("reset clears indexes and constraints", () => {
    useDbViewerStore.getState().setIndexes([{ name: "x", schema: "s", table: "t", definition: "", is_unique: false, method: "btree", columns: [], size_bytes: null, tablespace: null }]);
    useDbViewerStore.getState().reset();
    expect(useDbViewerStore.getState().indexes).toBeNull();
  });
});

describe("refreshTree", () => {
  it("fetches databases/schemas/tables and populates", async () => {
    vi.mocked(commands.getDatabases).mockResolvedValue(["mydb"]);
    vi.mocked(commands.getSchemas).mockResolvedValue(["public"]);
    vi.mocked(commands.getTables).mockResolvedValue([
      { name: "users", schema: "public", table_type: "TABLE" },
    ] as any);
    useDbViewerStore.setState({ currentSchema: "public" });
    await useDbViewerStore.getState().refreshTree("c1");
    expect(useDbViewerStore.getState().databases).toEqual(["mydb"]);
    expect(useDbViewerStore.getState().schemas).toEqual(["public"]);
    expect(useDbViewerStore.getState().tables).toHaveLength(1);
    expect(commands.getTables).toHaveBeenCalledWith("c1", "public");
  });
  it("falls back to no schema when currentSchema is null", async () => {
    vi.mocked(commands.getDatabases).mockResolvedValue([] as any);
    vi.mocked(commands.getSchemas).mockResolvedValue([] as any);
    vi.mocked(commands.getTables).mockResolvedValue([] as any);
    useDbViewerStore.setState({ currentSchema: null });
    await useDbViewerStore.getState().refreshTree("c1");
    expect(commands.getTables).toHaveBeenCalledWith("c1", undefined);
  });
  it("swallows fetch errors", async () => {
    vi.mocked(commands.getDatabases).mockResolvedValue([] as any);
    vi.mocked(commands.getSchemas).mockRejectedValue(new Error("boom"));
    await expect(
      useDbViewerStore.getState().refreshTree("c1"),
    ).resolves.toBeUndefined();
  });
});

describe("tabType discriminator", () => {
  beforeEach(() => {
    useDbViewerStore.getState().reset();
    useDbViewerStore.setState({
      schemas: ["public"],
      currentSchema: "public",
      currentDatabase: "mydb",
    });
  });

  it("openQueryTab creates a query-type tab with empty query", () => {
    useDbViewerStore.getState().openQueryTab();
    const state = useDbViewerStore.getState();
    expect(state.tabs).toHaveLength(1);
    const tab = state.tabs[0];
    expect(tab.tabType).toBe("query");
    expect(tab.query).toBe("");
    expect(tab.schema).toBe("public");
    expect(tab.table).toBe("Query");
    expect(state.activeTabId).toBe(tab.id);
  });

  it("creates sequential query tabs with unique IDs", () => {
    const store = useDbViewerStore.getState();
    store.openQueryTab();
    store.openQueryTab();
    store.openQueryTab();
    const tabs = useDbViewerStore.getState().tabs;
    expect(tabs).toHaveLength(3);
    const ids = tabs.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
    tabs.forEach((t) => expect(t.tabType).toBe("query"));
  });

  it("openTab creates table-type tabs by default (backward compat)", () => {
    useDbViewerStore.getState().openTab("public", "users");
    const tab = useDbViewerStore.getState().tabs[0];
    expect(tab.tabType).toBe("table");
  });
});