import { create } from "zustand";
import type { QueryResult, TableInfo, ChangeItemType, FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, IndexInfo, ConstraintInfo, ObjectType, RoleInfo } from "../lib/types";
import { getDatabases, getSchemas, getTables } from "../lib/commands";
import type { ObjectKind, DdlParams } from "../lib/objectCrud";

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

/** Payload carried by an "objectForm" tab — the kind + params for the
 * object create/edit form and the SQL toggle it renders. */
export interface ViewerFormTabPayload {
  kind: ObjectKind;
  params: DdlParams;
  title: string;
  description: string;
  mode: "create" | "edit";
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
  tabType: "table" | "query" | "object" | "objectForm";
  query?: string;
  objectType?: ObjectType | null;
  objectItem?: unknown;
  form?: ViewerFormTabPayload;
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
  schemaTreeLoading: boolean;
  currentDatabase: string | null;
  currentSchema: string | null;
  objectSearchOpen: boolean;
  selectedObjectType: ObjectType | null;
  /** View the DB viewer should switch to ("db-viewer" | "objects" | ...).
   * Set by the search palette before closing; consumed (and cleared) by
   * DbViewerScreen's navigation effect. */
  requestedView: string | null;
  functions: FunctionInfo[] | null;
  triggers: TriggerInfo[] | null;
  sequences: SequenceInfo[] | null;
  enums: EnumInfo[] | null;
  extensions: ExtensionInfo[] | null;
  indexes: IndexInfo[] | null;
  setSchemaTreeLoading: (loading: boolean) => void;
  constraints: ConstraintInfo[] | null;
  roles: RoleInfo[];

  // Actions
  openTab: (schema: string, table: string, forceNew?: boolean) => void;
  openQueryTab: () => void;
  openObjectTab: (objectType: ObjectType, schema: string, name: string, item?: unknown) => void;
  openFormTab: (opts: {
    kind: ObjectKind;
    schema: string;
    name: string;
    title: string;
    description: string;
    mode: "create" | "edit";
    params: DdlParams;
  }) => void;
  updateFormTabParams: (tabId: string, params: DdlParams) => void;
  setDefaultPageSize: (size: number) => void;
  closeTab: (tabId: string) => void;
  reorderTab: (fromIndex: number, toIndex: number) => void;
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
  updateChange: (changeId: string, patch: Partial<QueueItem>) => void;
  clearChanges: () => void;
  markChangeCommitted: (changeId: string) => void;
  markChangeFailed: (changeId: string, error: string) => void;
  toggleChangesPanel: () => void;
  setCurrentDatabase: (db: string | null) => void;
  setCurrentSchema: (schema: string | null) => void;
  setObjectSearchOpen: (open: boolean) => void;
  setSelectedObjectType: (t: ObjectType | null) => void;
  setRequestedView: (view: string | null) => void;
  setFunctions: (functions: FunctionInfo[]) => void;
  setTriggers: (triggers: TriggerInfo[]) => void;
  setSequences: (sequences: SequenceInfo[]) => void;
  setEnums: (enums: EnumInfo[]) => void;
  setExtensions: (extensions: ExtensionInfo[]) => void;
  setIndexes: (indexes: IndexInfo[]) => void;
  setConstraints: (constraints: ConstraintInfo[]) => void;
  setRoles: (roles: RoleInfo[]) => void;
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
  objectSearchOpen: false,
  selectedObjectType: null as ObjectType | null,
  requestedView: null as string | null,
  functions: null as FunctionInfo[] | null,
  triggers: null as TriggerInfo[] | null,
  sequences: null as SequenceInfo[] | null,
  enums: null as EnumInfo[] | null,
  extensions: null as ExtensionInfo[] | null,
  indexes: null as IndexInfo[] | null,
  constraints: null as ConstraintInfo[] | null,
  roles: [] as RoleInfo[],
  schemaTreeLoading: false,
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

  openObjectTab: (objectType, schema, name, item) => {
    const { tabs } = get();

    // Dedup on the object's identity (objectType + schema + name); an object
    // tab is distinct from a table tab of the same name.
    const existing = tabs.find(
      (t) =>
        t.tabType === "object" &&
        t.objectType === objectType &&
        t.schema === schema &&
        t.table === name,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const tab: ViewerTab = {
      id: `tab-${++tabCounter}`,
      schema,
      table: name,
      page: 1,
      pageSize: get().defaultPageSize,
      loading: false,
      error: null,
      data: null,
      filterRules: [],
      sortRules: [],
      hiddenColumns: [],
      smartSortApplied: false,
      tabType: "object",
      objectType,
      objectItem: item,
    };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  openFormTab: ({ kind, schema, name, title, description, mode, params }) => {
    const { tabs } = get();

    // Resolve the effective schema before building the tab: an explicit schema
    // wins, otherwise fall back to the viewer's current schema, then "public".
    // The form payload (params) is left untouched — the tab schema is used for
    // dedup/identity only.
    const effSchema = schema || get().currentSchema || "public";

    // Dedup key semantics:
    //   create -> `create:<kind>`              (one create form per kind;
    //   schema/name excluded because the user may rename while typing)
    //   edit   -> `edit:<kind>:<schema>:<name>`
    // The key is derived from the stored form payload (params carries
    // { schema, name } per the objectCrud contract), so no extra field is
    // needed on ViewerTab.
    const existing = tabs.find(
      (t) =>
        t.tabType === "objectForm" &&
        t.form?.kind === kind &&
        t.form?.mode === mode &&
        (mode === "create" ||
          (t.schema === schema && t.form?.params?.name === name)),
    );
    if (existing) {
      // Re-clicking the same form focuses the tab and never clobbers its
      // in-progress params.
      set({ activeTabId: existing.id });
      return;
    }

    const tab: ViewerTab = {
      id: `tab-${++tabCounter}`,
      schema: effSchema,
      table: title,
      page: 1,
      pageSize: get().defaultPageSize,
      loading: false,
      error: null,
      data: null,
      filterRules: [],
      sortRules: [],
      hiddenColumns: [],
      smartSortApplied: false,
      tabType: "objectForm",
      objectType: null,
      form: { kind, params, title, description, mode },
    };
    set({ tabs: [...tabs, tab], activeTabId: tab.id });
  },

  updateFormTabParams: (tabId, params) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId && t.tabType === "objectForm" && t.form
          ? { ...t, form: { ...t.form, params } }
          : t,
      ),
    })),

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

  // Move a tab to a new index (drag-to-reorder). The active tab is tracked by
  // id, so it follows the moved tab automatically.
  reorderTab: (fromIndex, toIndex) => {
    const { tabs } = get();
    if (
      fromIndex < 0 ||
      fromIndex >= tabs.length ||
      toIndex < 0 ||
      toIndex >= tabs.length ||
      fromIndex === toIndex
    ) {
      return;
    }
    const next = [...tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    set({ tabs: next });
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

  updateChange: (changeId, patch) =>
    set((state) => ({
      changesQueue: state.changesQueue.map((c) =>
        c.id === changeId ? { ...c, ...patch } : c,
      ),
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
  setObjectSearchOpen: (open) => set({ objectSearchOpen: open }),
  setSelectedObjectType: (t) => set({ selectedObjectType: t }),
  setRequestedView: (view) => set({ requestedView: view }),
  setFunctions: (functions) => set({ functions }),
  setTriggers: (triggers) => set({ triggers }),
  setSequences: (sequences) => set({ sequences }),
  setEnums: (enums) => set({ enums }),
  setExtensions: (extensions) => set({ extensions }),
  setIndexes: (indexes) => set({ indexes }),
  setConstraints: (constraints) => set({ constraints }),
  setRoles: (roles) => set({ roles }),
  setSchemaTreeLoading: (loading) => set({ schemaTreeLoading: loading }),

  stageCellEdit: (input) => {
    // Re-staging the same cell replaces the existing pending entry (keeps the
    // original oldData so revert restores the DB value) instead of stacking
    // a second queue item.
    const colName = Object.keys(input.newData)[0];
    const existing = get().changesQueue.find(
      (c) =>
        c.status === "pending" &&
        c.type === "update" &&
        c.schema === input.schema &&
        c.table === input.table &&
        c.primaryKey &&
        JSON.stringify(c.primaryKey) === JSON.stringify(input.primaryKey) &&
        Object.keys(c.newData ?? {})[0] === colName,
    );
    if (existing) {
      set((state) => ({
        changesQueue: state.changesQueue.map((c) =>
          c.id === existing.id
            ? {
                ...c,
                newData: input.newData,
                description: input.description ?? c.description,
              }
            : c,
        ),
      }));
      return;
    }
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