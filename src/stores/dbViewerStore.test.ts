import { describe, it, expect, beforeEach } from "vitest";
import { useDbViewerStore } from "./dbViewerStore";
import type { QueryResult, TableInfo } from "../lib/types";

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
      columns: [{name:"id",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null},{name:"name",data_type:"text",is_pk:false,is_fk:false,is_nullable:false,default_value:null,fk_ref:null}],
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
});