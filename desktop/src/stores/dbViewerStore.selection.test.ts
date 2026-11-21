import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDbViewerStore } from "./dbViewerStore";
import { changeOriginFor } from "../lib/changeOrigin";
import { useUiStore } from "./uiStore";
import { useConnectionStore } from "./connectionStore";
import type { Connection } from "../lib/types";

vi.mock("../lib/commands", () => ({
  getDatabases: vi.fn(),
  getSchemas: vi.fn(),
  getTables: vi.fn(),
}));

/**
 * Selection lifecycle (ticket 06).
 *
 * A selection belongs to one tab, one result set, and one Change Origin. The
 * store owns that lifecycle so no path — paging, filtering, sorting, switching
 * tabs, moving the database selector, or replacing the rows — can keep a
 * selection alive under the wrong rows.
 */

function savedConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c1",
    name: "Local dev",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    username: "dev",
    database: "appdb",
    folder_id: null,
    keychain_ref: null,
    tag_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    favorite: false,
    ...overrides,
  };
}

const connection = savedConnection();

function tab(id: string) {
  return useDbViewerStore.getState().tabs.find((t) => t.id === id)!;
}

function selectOn(tabId: string, keys: string[]) {
  useDbViewerStore.getState().setRowSelection(tabId, keys);
  expect(tab(tabId).selection).toEqual(keys);
}

beforeEach(() => {
  useDbViewerStore.getState().reset();
  useConnectionStore.setState({ connections: [connection] });
  useUiStore.setState({ activeConnectionId: "c1" });
  useDbViewerStore.setState({ currentDatabase: "appdb" });
});

describe("selection lifecycle", () => {
  it("toggles one row's selection key without touching the others", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;

    useDbViewerStore.getState().toggleRowSelection(tabId, "key-a");
    useDbViewerStore.getState().toggleRowSelection(tabId, "key-b");
    expect(tab(tabId).selection).toEqual(["key-a", "key-b"]);

    // Toggling the same key again deselects only that row.
    useDbViewerStore.getState().toggleRowSelection(tabId, "key-a");
    expect(tab(tabId).selection).toEqual(["key-b"]);

    useDbViewerStore.getState().clearRowSelection(tabId);
    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection on a page change", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1", "order:2"]);

    useDbViewerStore.getState().setPage(tabId, 2);

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection on a page-size change", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    useDbViewerStore.getState().setPageSize(tabId, 200);

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection on a filter change", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    useDbViewerStore
      .getState()
      .setFilterRules(tabId, [
        { id: "f1", column: "status", operator: "eq", value: "paid" },
      ]);

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection on a sort change", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    useDbViewerStore
      .getState()
      .setSortRules(tabId, [{ id: "s1", column: "created_at", order: "desc" }]);

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection when the tab is switched", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "orders");
    const orders = useDbViewerStore.getState().activeTabId!;
    store.openTab("public", "users");
    const users = useDbViewerStore.getState().activeTabId!;

    useDbViewerStore.getState().setActiveTab(orders);
    selectOn(orders, ["order:1"]);

    useDbViewerStore.getState().setActiveTab(users);

    // Coming back must not restore a selection made in another context.
    expect(tab(orders).selection).toEqual([]);
  });

  it("clears the selection when the viewer's database moves (origin change)", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    // The database selector moves to another database: the tab is now out of
    // origin and its rows are not the current target's rows.
    useDbViewerStore.getState().syncTabOrigins(changeOriginFor(connection, "otherdb"));

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection when the database selector moves", () => {
    useDbViewerStore.getState().openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    useDbViewerStore.getState().setCurrentDatabase("appdb_2");

    expect(tab(tabId).selection).toEqual([]);
  });

  it("clears the selection when the dataset is replaced", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "orders");
    const tabId = useDbViewerStore.getState().activeTabId!;
    selectOn(tabId, ["order:1"]);

    // A refresh lands new rows for the same controls.
    const token = useDbViewerStore.getState().beginTabRequest(tabId);
    useDbViewerStore.getState().applyTabResult(tabId, token, {
      columns: [],
      rows: [],
      total_rows: 0,
      page: 1,
      page_size: 50,
    });

    expect(tab(tabId).selection).toEqual([]);
  });

  it("keeps each tab's selection to itself", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "orders");
    const orders = useDbViewerStore.getState().activeTabId!;
    useDbViewerStore.getState().setRowSelection(orders, ["order:1"]);

    store.openTab("public", "users");
    const users = useDbViewerStore.getState().activeTabId!;

    // The new tab starts with nothing selected; the other tab's selection is
    // never applied to it.
    expect(tab(users).selection).toEqual([]);
    selectOn(users, ["user:7"]);
    expect(tab(orders).selection).toEqual([]);
  });

  it("drops a selection when its tab is closed and reopened", () => {
    const store = useDbViewerStore.getState();
    store.openTab("public", "orders");
    const orders = useDbViewerStore.getState().activeTabId!;
    selectOn(orders, ["order:1"]);

    useDbViewerStore.getState().closeTab(orders);
    useDbViewerStore.getState().openTab("public", "orders");
    const reopened = useDbViewerStore.getState().activeTabId!;

    expect(reopened).not.toBe(orders);
    expect(tab(reopened).selection).toEqual([]);
  });
});
