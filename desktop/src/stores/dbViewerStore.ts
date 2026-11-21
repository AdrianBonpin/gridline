import { create } from "zustand";
import type { QueryResult, TableInfo, ChangeItemType, FunctionInfo, TriggerInfo, SequenceInfo, EnumInfo, ExtensionInfo, HypertableInfo, IndexInfo, ConstraintInfo, ObjectType, RoleInfo, MultiQueryResult, DiffItem } from "../lib/types";
import { getDatabases, getSchemas, getTables } from "../lib/commands";
import type { ObjectKind, DdlParams } from "../lib/objectCrud";
import { changeOriginFor, isSameChangeOrigin, isSameChangeTarget, type ChangeOrigin } from "../lib/changeOrigin";
import { useUiStore } from "./uiStore";
import { useConnectionStore } from "./connectionStore";

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
  /**
   * The Change Origin this change was staged against (GLOSSARY.md). Immutable
   * once staged: only the origin it belongs to may commit it. `null` means the
   * change has no origin at all, so it is never committed anywhere.
   */
  origin: ChangeOrigin | null;
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
  /**
   * Monotonic token for this tab's outstanding data request. Every new intent
   * (a run, a page/filter/sort change, a refresh) takes the next token, and
   * only the holder of the current token may write `data`/`error`. A slower
   * response for an older intent is dropped instead of being rendered under
   * newer controls.
   *
   * Optional so hand-built tabs (fixtures/tests) stay valid; every tab the
   * store creates starts at 0.
   */
  requestSeq?: number;
  /**
   * True when `data` predates the last failed/cancelled request: the rows stay
   * on screen (so the user keeps context) but are never presented as current.
   */
  stale?: boolean;
  data: QueryResult | null;
  multi?: MultiQueryResult | null;
  columnFilter?: { column: string; value: string };
  filterRules: FilterRule[];
  sortRules: SortRule[];
  hiddenColumns: string[];
  smartSortApplied: boolean;
  tabType: "table" | "query" | "object" | "objectForm";
  query?: string;
  /** Set when the tab's text came from an OS-opened `.sql` file. */
  filePath?: string;
  objectType?: ObjectType | null;
  objectItem?: unknown;
  form?: ViewerFormTabPayload;
}

// ─── Auto-increment counters ───────────────────────────────────

let tabCounter = 0;
let changeCounter = 0;

/**
 * The Change Origin of whatever the viewer is currently showing: the active
 * saved connection, the selected database, and that connection's target
 * configuration right now. Derived from live state (never cached) so staging
 * always belongs to the connection the user is actually looking at, and a
 * saved connection retargeted mid-session is observed immediately.
 *
 * `null` when no saved connection is active or the record is unknown — staged
 * work with no origin is never committed.
 */
export function currentChangeOrigin(): ChangeOrigin | null {
  const connectionId = useUiStore.getState().activeConnectionId;
  if (!connectionId) return null;
  const connection = useConnectionStore
    .getState()
    .connections.find((c) => c.id === connectionId);
  if (!connection) return null;
  return changeOriginFor(connection, useDbViewerStore.getState().currentDatabase);
}

const initialTab = (schema: string, table: string, defaultPageSize?: number): ViewerTab => ({
  id: `tab-${++tabCounter}`,
  schema,
  table,
  page: 1,
  pageSize: defaultPageSize ?? 50,
  loading: true,
  error: null,
  requestSeq: 0,
  stale: false,
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
  hypertables: HypertableInfo[] | null;
  hypertablesAvailable: boolean | null;
  indexes: IndexInfo[] | null;
  setSchemaTreeLoading: (loading: boolean) => void;
  constraints: ConstraintInfo[] | null;
  roles: RoleInfo[];

  // Actions
  openTab: (schema: string, table: string, forceNew?: boolean) => void;
  openQueryTab: (initial?: { sql?: string; label?: string; filePath?: string }) => void;
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
  setTabMulti: (tabId: string, multi: MultiQueryResult | null) => void;
  setTabLoading: (tabId: string, loading: boolean) => void;
  setTabError: (tabId: string, error: string) => void;
  /**
   * Claim the newest request token for `tabId` and mark it loading. Callers
   * keep the returned token and hand it back to `applyTabResult` /
   * `applyTabError`; a result whose token is no longer current is ignored.
   */
  beginTabRequest: (tabId: string) => number;
  /**
   * Publish a result only if `token` is still the tab's newest request.
   * Returns whether it was applied, so callers can skip follow-up state.
   */
  applyTabResult: (
    tabId: string,
    token: number,
    data: QueryResult,
  ) => boolean;
  /**
   * Publish a failure only if `token` is still the tab's newest request,
   * resolving loading and marking any earlier rows stale.
   */
  applyTabError: (tabId: string, token: number, error: string) => boolean;
  /**
   * Finalise a cancelled request: take a new token so the cancelled response
   * can never land, resolve loading, and report the cancellation.
   */
  cancelTabRequest: (tabId: string, message: string) => void;
  /**
   * Report an error about the tab's current request *without* resolving its
   * loading state (e.g. a cancellation attempt that failed while the query is
   * still running).
   */
  reportTabError: (tabId: string, error: string) => void;
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
    origin?: ChangeOrigin | null;
  }) => void;
  addDiffItems: (items: DiffItem[]) => void;
  cancelChange: (changeId: string) => void;
  removeChange: (changeId: string) => void;
  updateChange: (changeId: string, patch: Partial<QueueItem>) => void;
  clearChanges: () => void;
  clearChangesForTarget: (origin: ChangeOrigin | null) => void;
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
  setHypertables: (hypertables: HypertableInfo[]) => void;
  setHypertablesAvailable: (v: boolean | null) => void;
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
  hypertables: null as HypertableInfo[] | null,
  hypertablesAvailable: null as boolean | null,
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

  openQueryTab: (initial) => {
    const { tabs, currentSchema } = get();

    // Re-opening the same file focuses its tab instead of duplicating it, and
    // deliberately does NOT overwrite the text — the user may have edited it.
    if (initial?.filePath) {
      const existing = tabs.find((t) => t.filePath === initial.filePath);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }
    }

    const queryCount = tabs.filter((t) => t.tabType === "query").length;
    const tab: ViewerTab = {
      id: `tab-${++tabCounter}`,
      schema: currentSchema ?? "public",
      table: initial?.label ?? (queryCount === 0 ? "Query" : `Query ${queryCount + 1}`),
      page: 1,
      pageSize: get().defaultPageSize,
      loading: false,
      error: null,
      requestSeq: 0,
      stale: false,
      data: null,
      filterRules: [],
      sortRules: [],
      hiddenColumns: [],
      smartSortApplied: false,
      tabType: "query",
      query: initial?.sql ?? "",
      filePath: initial?.filePath,
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
      requestSeq: 0,
      stale: false,
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
      requestSeq: 0,
      stale: false,
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
          ? {
                ...t,
                page,
                loading: true,
                error: null,
                // A page change is a new intent: any response still in flight
                // for the previous page is no longer allowed to land.
                requestSeq: (t.requestSeq ?? 0) + 1,
            }
          : t,
      ),
    })),

  setPageSize: (tabId, pageSize) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
                ...t,
                pageSize,
                page: 1,
                loading: true,
                error: null,
                requestSeq: (t.requestSeq ?? 0) + 1,
            }
          : t,
      ),
    })),

  setTabData: (tabId, data) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
                ...t,
                data,
                multi: null,
                loading: false,
                error: null,
                stale: false,
            }
          : t,
      ),
    })),

  setTabMulti: (tabId, multi) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, multi } : t)),
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
        t.id === tabId
          ? {
                ...t,
                error,
                loading: false,
                // Rows that are still displayed did not come from the run that
                // just failed, so they are stale, not current.
                stale: t.data !== null,
            }
          : t,
      ),
    })),

  beginTabRequest: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    const token = (tab?.requestSeq ?? 0) + 1;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, requestSeq: token, loading: true, error: null }
          : t,
      ),
    }));
    return token;
  },

  applyTabResult: (tabId, token, data) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || (tab.requestSeq ?? 0) !== token) return false;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
                ...t,
                data,
                multi: null,
                loading: false,
                error: null,
                stale: false,
            }
          : t,
      ),
    }));
    return true;
  },

  applyTabError: (tabId, token, error) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || (tab.requestSeq ?? 0) !== token) return false;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, error, loading: false, stale: t.data !== null }
          : t,
      ),
    }));
    return true;
  },

  cancelTabRequest: (tabId, message) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
                ...t,
                // A new token seals the cancelled request: whatever it does
                // next, it can no longer write this tab.
                requestSeq: (t.requestSeq ?? 0) + 1,
                loading: false,
                error: message,
                stale: t.data !== null,
            }
          : t,
      ),
    })),

  reportTabError: (tabId, error) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, error } : t,
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
        t.id === tabId
          ? {
                ...t,
                filterRules: rules,
                page: 1,
                loading: true,
                error: null,
                requestSeq: (t.requestSeq ?? 0) + 1,
            }
          : t,
      ),
    })),

  setSortRules: (tabId, rules) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
                ...t,
                sortRules: rules,
                page: 1,
                loading: true,
                error: null,
                requestSeq: (t.requestSeq ?? 0) + 1,
            }
          : t,
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
      origin: input.origin ?? currentChangeOrigin(),
    };
    set((state) => ({ changesQueue: [...state.changesQueue, item] }));
  },

  addDiffItems: (items) => {
    for (const it of items) {
      if (it.destructive || it.sync_sql.length === 0) continue;
      for (const sql of it.sync_sql) {
        get().addChange({
          type: "ddl",
          sql,
          description: `Schema diff: ${it.object_type} ${it.name} (${it.kind})`,
        });
      }
    }
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

  /** Clear All: only the active origin's pending work, never another origin's. */
  clearChangesForTarget: (origin) => {
    if (!origin) return;
    set((state) => ({
      changesQueue: state.changesQueue.filter(
        (c) => !isSameChangeTarget(c.origin, origin),
      ),
    }));
  },

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
  setHypertables: (hypertables) => set({ hypertables }),
  setHypertablesAvailable: (v) => set({ hypertablesAvailable: v }),
  setIndexes: (indexes) => set({ indexes }),
  setConstraints: (constraints) => set({ constraints }),
  setRoles: (roles) => set({ roles }),
  setSchemaTreeLoading: (loading) => set({ schemaTreeLoading: loading }),

  stageCellEdit: (input) => {
    // Re-staging the same cell replaces the existing pending entry (keeps the
    // original oldData so revert restores the DB value) instead of stacking
    // a second queue item. Matching is scoped to the active Change Origin, so
    // an edit can never replace another origin's staged value.
    const origin = currentChangeOrigin();
    const colName = Object.keys(input.newData)[0];
    const existing = get().changesQueue.find(
      (c) =>
        c.status === "pending" &&
        c.type === "update" &&
        c.schema === input.schema &&
        c.table === input.table &&
        c.primaryKey &&
        JSON.stringify(c.primaryKey) === JSON.stringify(input.primaryKey) &&
        Object.keys(c.newData ?? {})[0] === colName &&
        (origin ? isSameChangeOrigin(c.origin, origin) : c.origin === null),
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
      origin,
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