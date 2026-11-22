import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDbViewerStore } from "./dbViewerStore";
import { changeOriginFor } from "../lib/changeOrigin";
import type { RowDetailRef } from "../lib/rowDetail";
import { useUiStore } from "./uiStore";
import { useConnectionStore } from "./connectionStore";
import type { Connection } from "../lib/types";

vi.mock("../lib/commands", () => ({
  getDatabases: vi.fn(),
  getSchemas: vi.fn(),
  getTables: vi.fn(),
}));

/**
 * Row detail lifecycle (ticket 39).
 *
 * An open row detail describes one row of one result set in one context. The
 * drawer is keyed by Row Identity (never a grid position) and the store owns
 * its lifecycle, so paging, filtering, sorting, switching tabs, moving the
 * viewer's target, or replacing the rows closes it. Another table's row can
 * never be shown under a stale drawer.
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

/** Open a table tab and return its id. */
function openOrders(): string {
  useDbViewerStore.getState().openTab("public", "orders");
  return useDbViewerStore.getState().activeTabId!;
}

const ROW: RowDetailRef = { setIndex: 0, key: 'primary-key:{"id":1}' };

/** Open a row detail on `tabId` and assert the store recorded it. */
function openDetailOn(tabId: string, ref: RowDetailRef = ROW) {
  useDbViewerStore.getState().openRowDetail(tabId, ref);
  expect(tab(tabId).rowDetail).toEqual(ref);
}

beforeEach(() => {
  useDbViewerStore.getState().reset();
  useConnectionStore.setState({ connections: [connection] });
  useUiStore.setState({ activeConnectionId: "c1" });
  useDbViewerStore.setState({ currentDatabase: "appdb" });
});

describe("row detail lifecycle", () => {
  it("opens a row detail by Row Identity and closes it explicitly", () => {
    const tabId = openOrders();

    openDetailOn(tabId);
    useDbViewerStore.getState().clearRowDetail(tabId);

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail on a page change", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore.getState().setPage(tabId, 2);

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail on a page-size change", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore.getState().setPageSize(tabId, 200);

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail on a filter change", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore
      .getState()
      .setFilterRules(tabId, [
        { id: "f1", column: "status", operator: "eq", value: "paid" },
      ]);

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail on a sort change", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore
      .getState()
      .setSortRules(tabId, [{ id: "s1", column: "created_at", order: "desc" }]);

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail when the tab is switched", () => {
    const store = useDbViewerStore.getState();
    const orders = openOrders();
    // Open the second tab first, so the switch below is the only thing that
    // can clear the drawer.
    store.openTab("public", "users");
    const users = useDbViewerStore.getState().activeTabId!;
    useDbViewerStore.getState().setActiveTab(orders);
    openDetailOn(orders);

    useDbViewerStore.getState().setActiveTab(users);

    expect(tab(orders).rowDetail).toBeNull();
    expect(tab(users).rowDetail).toBeNull();
  });

  it("closes the row detail when the viewer's database moves (origin change)", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore
      .getState()
      .syncTabOrigins(changeOriginFor(connection, "otherdb"));

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail when the database selector moves", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    useDbViewerStore.getState().setCurrentDatabase("appdb_2");

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail when the dataset is replaced", () => {
    const tabId = openOrders();
    openDetailOn(tabId);

    const token = useDbViewerStore.getState().beginTabRequest(tabId);
    useDbViewerStore.getState().applyTabResult(tabId, token, {
      columns: [],
      rows: [],
      total_rows: 0,
      page: 1,
      page_size: 50,
    });

    expect(tab(tabId).rowDetail).toBeNull();
  });

  it("closes the row detail when its tab is closed and reopened", () => {
    const orders = openOrders();
    openDetailOn(orders);

    useDbViewerStore.getState().closeTab(orders);
    useDbViewerStore.getState().openTab("public", "orders");
    const reopened = useDbViewerStore.getState().activeTabId!;

    expect(reopened).not.toBe(orders);
    expect(tab(reopened).rowDetail).toBeNull();
  });

  it("never shows one tab's row detail under another tab", () => {
    const store = useDbViewerStore.getState();
    const orders = openOrders();
    store.openTab("public", "users");
    const users = useDbViewerStore.getState().activeTabId!;
    useDbViewerStore.getState().setActiveTab(orders);
    openDetailOn(orders);

    // Switching away closes it rather than carrying it to the other tab…
    useDbViewerStore.getState().setActiveTab(users);
    expect(tab(users).rowDetail).toBeNull();
    expect(tab(orders).rowDetail).toBeNull();

    // …and reopening one on the new tab never reopens the old one.
    openDetailOn(users, { setIndex: 0, key: 'primary-key:{"id":7}' });
    expect(tab(orders).rowDetail).toBeNull();
  });
});
