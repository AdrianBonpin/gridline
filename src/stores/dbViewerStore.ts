import { create } from "zustand";
import type { QueryResult, TableInfo, ChangeItemType } from "../lib/types";

// ─── Local types ────────────────────────────────────────────────

export type QueueStatus = "pending" | "cancelled" | "committed" | "failed";

export interface QueueItem {
  id: string;
  type: ChangeItemType;
  sql: string;
  schema?: string;
  table?: string;
  primaryKey?: Record<string, unknown>;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  status: QueueStatus;
  error?: string | null;
  description?: string | null;
  createdAt: number;
}

export interface ViewerTab {
  id: string;
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  data: QueryResult | null;
}

// ─── Auto-increment counters ───────────────────────────────────

let tabCounter = 0;
let changeCounter = 0;

const initialTab = (schema: string, table: string): ViewerTab => ({
  id: `tab-${++tabCounter}`,
  schema,
  table,
  page: 1,
  pageSize: 50,
  loading: false,
  error: null,
  data: null,
});

// ─── State interface ────────────────────────────────────────────

interface DbViewerState {
  tabs: ViewerTab[];
  activeTabId: string | null;
  changesQueue: QueueItem[];
  databases: string[];
  schemas: string[];
  tables: TableInfo[];
  currentDatabase: string | null;
  currentSchema: string | null;

  // Actions
  openTab: (schema: string, table: string, forceNew?: boolean) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  setPage: (tabId: string, page: number) => void;
  setTabData: (tabId: string, data: QueryResult) => void;
  setTabLoading: (tabId: string, loading: boolean) => void;
  setTabError: (tabId: string, error: string) => void;
  addChange: (input: {
    type: ChangeItemType;
    sql?: string;
    schema?: string;
    table?: string;
    primaryKey?: Record<string, unknown>;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
    description?: string | null;
  }) => void;
  cancelChange: (changeId: string) => void;
  markChangeCommitted: (changeId: string) => void;
  markChangeFailed: (changeId: string, error: string) => void;
  setCurrentDatabase: (db: string | null) => void;
  setCurrentSchema: (schema: string | null) => void;
  populate: (
    databases: string[],
    schemas: string[],
    tables: TableInfo[],
  ) => void;
  reset: () => void;
}

// ─── Initial state ──────────────────────────────────────────────

const initialState = {
  tabs: [] as ViewerTab[],
  activeTabId: null as string | null,
  changesQueue: [] as QueueItem[],
  databases: [] as string[],
  schemas: [] as string[],
  tables: [] as TableInfo[],
  currentDatabase: null as string | null,
  currentSchema: null as string | null,
};

// ─── Store ──────────────────────────────────────────────────────

export const useDbViewerStore = create<DbViewerState>((set, get) => ({
  ...initialState,

  openTab: (schema, table, forceNew = false) => {
    const { tabs } = get();

    // Dedup: if not forceNew and an identical tab exists, just activate it
    if (!forceNew) {
      const existing = tabs.find(
        (t) => t.schema === schema && t.table === table,
      );
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
    }

    const tab = initialTab(schema, table);
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  closeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    const remaining = tabs.filter((t) => t.id !== tabId);
    const newActiveId =
      activeTabId === tabId
        ? remaining.length > 0
          ? remaining[remaining.length - 1].id
          : null
        : activeTabId;
    set({ tabs: remaining, activeTabId: newActiveId });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setPage: (tabId, page) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, page } : t)),
    })),

  setTabData: (tabId, data) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, data, loading: false, error: null } : t,
      ),
    })),

  setTabLoading: (tabId, loading) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loading } : t,
      ),
    })),

  setTabError: (tabId, error) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, error, loading: false } : t,
      ),
    })),

  addChange: (input) => {
    const item: QueueItem = {
      id: `ch-${++changeCounter}`,
      type: input.type,
      sql: input.sql ?? "",
      schema: input.schema,
      table: input.table,
      primaryKey: input.primaryKey,
      oldData: input.oldData ?? null,
      newData: input.newData ?? null,
      status: "pending",
      description: input.description ?? null,
      createdAt: Date.now(),
    };
    set((state) => ({ changesQueue: [...state.changesQueue, item] }));
  },

  cancelChange: (changeId) =>
    set((state) => ({
      changesQueue: state.changesQueue.map((c) =>
        c.id === changeId ? { ...c, status: "cancelled" as const } : c,
      ),
    })),

  markChangeCommitted: (changeId) =>
    set((state) => ({
      changesQueue: state.changesQueue.map((c) =>
        c.id === changeId ? { ...c, status: "committed" as const } : c,
      ),
    })),

  markChangeFailed: (changeId, error) =>
    set((state) => ({
      changesQueue: state.changesQueue.map((c) =>
        c.id === changeId
          ? { ...c, status: "failed" as const, error }
          : c,
      ),
    })),

  setCurrentDatabase: (db) => set({ currentDatabase: db }),
  setCurrentSchema: (schema) => set({ currentSchema: schema }),

  populate: (databases, schemas, tables) =>
    set({ databases, schemas, tables }),

  reset: () => {
    tabCounter = 0;
    changeCounter = 0;
    set({ ...initialState, tabs: [], changesQueue: [] });
  },
}));