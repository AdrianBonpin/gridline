import { create } from "zustand";
import type { QueryResult, TableInfo, ChangeItemType, FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, IndexInfo, ConstraintInfo } from "../lib/types";
import { getDatabases, getSchemas, getTables } from "../lib/commands";

// ─── Local types ────────────────────────────────────────────────

export type QueueStatus = "pending" | "cancelled" | "committed" | "failed";

export type FilterOperator = "eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt" | "null" | "notnull";

export interface FilterRule {
  id: string;
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface SortRule {
  id: string;
  column: string;
  order: "asc" | "desc";
}

export interface QueueItem {
  id: string;
  type: ChangeItemType;
  sql: string;
  schema?: string;
  table?: string;
  primaryKey?: Record<string, unknown>;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  columns?: string[];
  rows?: unknown[][];
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
  columnFilter?: { column: string; value: string };
  filterRules: FilterRule[];
  sortRules: SortRule[];
  hiddenColumns: string[];
  smartSortApplied: boolean;
  tabType: "table" | "query";
  query?: string;
}

// ─── Auto-increment counters ───────────────────────────────────

let tabCounter = 0;
let changeCounter = 0;

const initialTab = (schema: string, table: string, defaultPageSize?: number): ViewerTab => ({
  id: `tab-${++tabCounter}`,
  schema,
  table,
  page: 1,
  pageSize: defaultPageSize ?? 50,
  loading: true,
  error: null,
  data: null,
  filterRules: [],
  sortRules: [],
  hiddenColumns: [],
  smartSortApplied: false,
  tabType: "table",
  query: undefined,
});

// ─── State interface ────────────────────────────────────────────

interface DbViewerState {
  tabs: ViewerTab[];
  activeTabId: string | null;
  defaultPageSize: number;
  changesQueue: QueueItem[];
  changesPanelExpanded: boolean;
  databases: string[];
  schemas: string[];
  tables: TableInfo[];
  currentDatabase: string | null;
  currentSchema: string | null;
  functions: FunctionInfo[] | null;
  triggers: TriggerInfo[] | null;
  sequences: SequenceInfo[] | null;
  enums: EnumInfo[] | null;
  extensions: ExtensionInfo[] | null;
  indexes: IndexInfo[] | null;
  constraints: ConstraintInfo[] | null;

  // Actions
  openTab: (schema: string, table: string, forceNew?: boolean) => void;
  openQueryTab: () => void;
  setDefaultPageSize: (size: number) => void;
  closeTab: (tabId: string) => void;
  closeTabsForTable: (schema: string, table: string) => void;
  setActiveTab: (tabId: string) => void;
  setPage: (tabId: string, page: number) => void;
  setPageSize: (tabId: string, pageSize: number) => void;
  setTabData: (tabId: string, data: QueryResult) => void;
  setTabLoading: (tabId: string, loading: boolean) => void;
  setTabError: (tabId: string, error: string) => void;
  setColumnFilter: (tabId: string, column: string, value: string) => void;
  clearColumnFilter: (tabId: string) => void;
  setFilterRules: (tabId: string, rules: FilterRule[]) => void;
  setSortRules: (tabId: string, rules: SortRule[]) => void;
  setHiddenColumns: (tabId: string, columns: string[]) => void;
  toggleHiddenColumn: (tabId: string, column: string) => void;
  setSmartSortApplied: (tabId: string) => void;
  addChange: (input: {
    type: ChangeItemType;
    sql?: string;
    schema?: string;
    table?: string;
    primaryKey?: Record<string, unknown>;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
    columns?: string[];
    rows?: unknown[][];
    description?: string | null;
  }) => void;
  cancelChange: (changeId: string) => void;
  removeChange: (changeId: string) => void;
  clearChanges: () => void;
  markChangeCommitted: (changeId: string) => void;
  markChangeFailed: (changeId: string, error: string) => void;
  toggleChangesPanel: () => void;
  setCurrentDatabase: (db: string | null) => void;
  setCurrentSchema: (schema: string | null) => void;
  setFunctions: (functions: FunctionInfo[]) => void;
  setTriggers: (triggers: TriggerInfo[]) => void;
  setSequences: (sequences: SequenceInfo[]) => void;
  setEnums: (enums: EnumInfo[]) => void;
  setExtensions: (extensions: ExtensionInfo[]) => void;
  setIndexes: (indexes: IndexInfo[]) => void;
  setConstraints: (constraints: ConstraintInfo[]) => void;
  stageCellEdit: (input: {
    tabId: string;
    schema: string;
    table: string;
    primaryKey: Record<string, unknown>;
    oldData: Record<string, unknown>;
    newData: Record<string, unknown>;
    description?: string;
  }) => void;
  populate: (
    databases: string[],
    schemas: string[],
    tables: TableInfo[],
  ) => void;
  refreshTree: (connectionId: string, schema?: string) => Promise<void>;
  reset: () => void;
}

// ─── Initial state ──────────────────────────────────────────────

const initialState = {
  tabs: [] as ViewerTab[],
  activeTabId: null as string | null,
  defaultPageSize: 50,
  changesQueue: [] as QueueItem[],
  changesPanelExpanded: true,
  databases: [] as string[],
  schemas: [] as string[],
  tables: [] as TableInfo[],
  currentDatabase: null as string | null,
  currentSchema: null as string | null,
  functions: null as FunctionInfo[] | null,
  triggers: null as TriggerInfo[] | null,
  sequences: null as SequenceInfo[] | null,
  enums: null as EnumInfo[] | null,
  extensions: null as ExtensionInfo[] | null,
  indexes: null as IndexInfo[] | null,
  constraints: null as ConstraintInfo[] | null,
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

    const tab = initialTab(schema, table, get().defaultPageSize);
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  openQueryTab: () => {
    const { tabs, currentSchema } = get();
    const queryCount = tabs.filter((t) => t.tabType === "query").length;
    const tab: ViewerTab = {
      id: `tab-${++tabCounter}`,
      schema: currentSchema ?? "public",
      table: queryCount === 0 ? "Query" : `Query ${queryCount + 1}`,
      page: 1,
      pageSize: get().defaultPageSize,
      loading: false,
      error: null,
      data: null,
      filterRules: [],
      sortRules: [],
      hiddenColumns: [],
      smartSortApplied: false,
      tabType: "query",
      query: "",
    };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  setDefaultPageSize: (size) => set({ defaultPageSize: size }),

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

  closeTabsForTable: (schema, table) => {
    const { tabs, activeTabId } = get();
    const remaining = tabs.filter(
      (t) => !(t.tabType === "table" && t.schema === schema && t.table === table),
    );
    if (remaining.length === tabs.length) return;
    const newActiveId =
      activeTabId !== null && !remaining.some((t) => t.id === activeTabId)
        ? remaining.length > 0
          ? remaining[remaining.length - 1].id
          : null
        : activeTabId;
    set({ tabs: remaining, activeTabId: newActiveId });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setPage: (tabId, page) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, page, loading: true, error: null }
          : t,
      ),
    })),

  setPageSize: (tabId, pageSize) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, pageSize, page: 1, loading: true, error: null }
          : t,
      ),
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

  setColumnFilter: (tabId, column, value) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, columnFilter: { column, value } } : t,
      ),
    })),

  clearColumnFilter: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, columnFilter: undefined } : t,
      ),
    })),

  setFilterRules: (tabId, rules) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, filterRules: rules, page: 1, loading: true, error: null } : t,
      ),
    })),

  setSortRules: (tabId, rules) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, sortRules: rules, page: 1, loading: true, error: null } : t,
      ),
    })),

  setHiddenColumns: (tabId, columns) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, hiddenColumns: columns } : t,
      ),
    })),

  toggleHiddenColumn: (tabId, column) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const exists = t.hiddenColumns.includes(column);
        return {
          ...t,
          hiddenColumns: exists
            ? t.hiddenColumns.filter((c) => c !== column)
            : [...t.hiddenColumns, column],
        };
      }),
    })),

  setSmartSortApplied: (tabId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, smartSortApplied: true } : t,
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
      columns: input.columns,
      rows: input.rows,
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

  removeChange: (changeId) =>
    set((state) => ({
      changesQueue: state.changesQueue.filter((c) => c.id !== changeId),
    })),

  clearChanges: () => set({ changesQueue: [] }),

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

  toggleChangesPanel: () =>
    set((state) => ({ changesPanelExpanded: !state.changesPanelExpanded })),

  setCurrentDatabase: (db) => set({ currentDatabase: db }),
  setCurrentSchema: (schema) => set({ currentSchema: schema }),
  setFunctions: (functions) => set({ functions }),
  setTriggers: (triggers) => set({ triggers }),
  setSequences: (sequences) => set({ sequences }),
  setEnums: (enums) => set({ enums }),
  setExtensions: (extensions) => set({ extensions }),
  setIndexes: (indexes) => set({ indexes }),
  setConstraints: (constraints) => set({ constraints }),

  stageCellEdit: (input) => {
    get().addChange({
      type: "update",
      schema: input.schema,
      table: input.table,
      primaryKey: input.primaryKey,
      oldData: input.oldData,
      newData: input.newData,
      description: input.description ?? `Edit ${input.table}`,
    });
  },

  populate: (databases, schemas, tables) =>
    set({ databases, schemas, tables }),

  // Best-effort re-fetch of the schema tree (databases/schemas/tables) so
  // newly created/dropped objects show up without a manual refresh.  A
  // failure must never surface to the user.
  refreshTree: async (connectionId, schema) => {
    try {
      const [dbs, scs, tbls] = await Promise.all([
        getDatabases(connectionId),
        getSchemas(connectionId),
        getTables(connectionId, schema ?? get().currentSchema ?? undefined),
      ]);
      get().populate(dbs, scs, tbls);
    } catch {
      // Best-effort refresh; a failure must not surface to the user.
    }
  },

  reset: () => {
    tabCounter = 0;
    changeCounter = 0;
    set({ ...initialState, tabs: [], changesQueue: [] });
  },
}));