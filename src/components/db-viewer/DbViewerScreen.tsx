import { useCallback, useEffect, useRef, useState, Suspense, lazy } from "react";
import { ChevronDown, ChevronUp, Table2, Terminal } from "lucide-react";
import { format as formatSql } from "sql-formatter";
import { TooltipProvider } from "../ui/Tooltip";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { isDestructiveQuery } from "../../lib/utils";
import { executeQuery } from "../../lib/commands";

const QueryEditor = lazy(() => import("../editor/QueryEditor").then((m) => ({ default: m.QueryEditor })));
import { QueryToolbar } from "../editor/QueryToolbar";
const DestructiveQueryDialog = lazy(() =>
  import("../editor/DestructiveQueryDialog").then((m) => ({ default: m.DestructiveQueryDialog })),
);
import { TableTree } from "./TableTree";
import { ObjectExplorerPage } from "./ObjectExplorerPage";
import { TabBar } from "./TabBar";
import { VirtualDataGrid } from "../grid/VirtualDataGrid";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { TableControls } from "./TableControls";
import { EditConnectionModal } from "./EditConnectionModal";
import { useDbConnection } from "../../hooks/useDbConnection";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useShortcut } from "../../hooks/useShortcut";
import { ConnectionDropBanner } from "./ConnectionDropBanner";
import { ToolsPage } from "./ToolsPage";
import { SchemaVisualizerPage } from "./SchemaVisualizerPage";
import { QueriesPanel } from "../queries/QueriesPanel";
import { useQueryStore } from "../../stores/queryStore";
import * as cmd from "../../lib/commands";

export interface DbViewerScreenProps {
    connectionId: string;
    onHome: () => void;
    onSettings: () => void;
}

export function DbViewerScreen({
    connectionId,
    onHome,
    onSettings,
}: DbViewerScreenProps) {
    const { connectionError, connect } = useDbConnection(connectionId);
    const [dismissedError, setDismissedError] = useState<string | null>(null);
    const [currentView, setCurrentView] = useState<string>("db-viewer");
    const [tablePanelWidth, setTablePanelWidth] = useState(280);
    const [queriesPanelWidth, setQueriesPanelWidth] = useState(280);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [destructiveQuery, setDestructiveQuery] = useState<string | null>(null);
    const connections = useConnectionStore((s) => s.connections);
    const currentConnection =
        connections.find((c) => c.id === connectionId) ?? null;
    const settings = useSettingsStore((s) => s.settings);
    const setDefaultPageSize = useDbViewerStore((s) => s.setDefaultPageSize);
    const clearColumnFilter = useDbViewerStore((s) => s.clearColumnFilter);
    const setFilterRules = useDbViewerStore((s) => s.setFilterRules);
    const setSortRules = useDbViewerStore((s) => s.setSortRules);
    const toggleHiddenColumn = useDbViewerStore((s) => s.toggleHiddenColumn);
    const setSmartSortApplied = useDbViewerStore((s) => s.setSmartSortApplied);

    // Sync settings defaults to store
    useEffect(() => {
        if (settings?.table_page_size) {
            setDefaultPageSize(settings.table_page_size);
        }
    }, [settings?.table_page_size, setDefaultPageSize]);
    const panelResizeRef = useRef<{ startX: number; startW: number } | null>(
        null,
    );
    const queriesPanelResizeRef = useRef<{
        startX: number;
        startW: number;
    } | null>(null);

    const activeTab = useDbViewerStore((s) => {
        if (!s.activeTabId) return null;
        return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
    });

    // Derive per-tab toolbar state from active tab
    const filterRules = activeTab?.filterRules ?? [];
    const sortRules = activeTab?.sortRules ?? [];
    const hiddenColumns = new Set(activeTab?.hiddenColumns ?? []);

    const setTabData = useDbViewerStore((s) => s.setTabData);
    const setTabError = useDbViewerStore((s) => s.setTabError);
    const setTabLoading = useDbViewerStore((s) => s.setTabLoading);
    const databases = useDbViewerStore((s) => s.databases);
    const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
    const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
    const schemas = useDbViewerStore((s) => s.schemas);
    const currentSchema = useDbViewerStore((s) => s.currentSchema);
    const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);
    const fetchingRef = useRef<Set<string>>(new Set());

    const fetchData = useCallback(
        async (tab: NonNullable<typeof activeTab>) => {
            if (fetchingRef.current.has(tab.id)) return;
            fetchingRef.current.add(tab.id);
            try {
                const result = await cmd.getTableData(
                    connectionId,
                    tab.schema,
                    tab.table,
                    tab.page,
                    tab.pageSize,
                    tab.filterRules,
                    tab.sortRules,
                );
                setTabData(tab.id, result);
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setTabError(tab.id, msg);
            } finally {
                fetchingRef.current.delete(tab.id);
            }
        },
        [connectionId, setTabData, setTabError],
    );

    async function executeQueryForTab(tabId: string, sql: string) {
        const tab = useDbViewerStore.getState().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        setTabLoading(tabId, true);
        try {
            const result = await executeQuery(connectionId, sql, tab.page, tab.pageSize);
            setTabData(tabId, result);
            useQueryStore.getState().invalidateHistory(connectionId);
        } catch (e) {
            setTabError(tabId, e instanceof Error ? e.message : String(e));
            useQueryStore.getState().invalidateHistory(connectionId);
        }
    }

    // Read the active tab from the store directly so the Monaco keybinding action
    // (which keeps the first onRun closure) always sees the latest query text.
    const handleRunQuery = useCallback(() => {
        const state = useDbViewerStore.getState();
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab || tab.tabType !== "query") return;
        const sql = tab.query?.trim() ?? "";
        if (!sql) return;
        if (isDestructiveQuery(sql)) {
            setDestructiveQuery(sql);
        } else {
            executeQueryForTab(tab.id, sql);
        }
    }, []);

    // Auto-format the active query tab's SQL
    const handleFormatQuery = useCallback(() => {
        const state = useDbViewerStore.getState();
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (!tab || tab.tabType !== "query") return;
        const dbType = currentConnection?.db_type ?? "postgresql";
        const language =
            dbType === "mysql"
                ? "mysql"
                : dbType === "sqlite"
                  ? "sqlite"
                  : "postgresql";
        try {
            const formatted = formatSql(tab.query ?? "", { language });
            useDbViewerStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                    t.id === tab.id ? { ...t, query: formatted } : t,
                ),
            }));
        } catch {
            // leave the query untouched if formatting fails
        }
    }, [currentConnection?.db_type]);

    // Restore SQL from history/saved panel: fill active query tab or open a new one
    const handleRestoreSql = useCallback((sql: string) => {
        const state = useDbViewerStore.getState();
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        if (tab && tab.tabType === "query") {
            useDbViewerStore.setState((s) => ({
                tabs: s.tabs.map((t) =>
                    t.id === tab.id ? { ...t, query: sql } : t,
                ),
            }));
        } else {
            state.openQueryTab();
            requestAnimationFrame(() => {
                const ns = useDbViewerStore.getState();
                const nt = ns.tabs.find((t) => t.id === ns.activeTabId);
                if (nt) {
                    useDbViewerStore.setState((s) => ({
                        tabs: s.tabs.map((t) =>
                            t.id === nt.id ? { ...t, query: sql } : t,
                        ),
                    }));
                }
            });
        }
    }, []);

    // Run SQL from history/saved panel: always open a new tab and execute
    const handleRunFromHistory = useCallback((sql: string) => {
        const state = useDbViewerStore.getState();
        state.openQueryTab();
        requestAnimationFrame(() => {
            const ns = useDbViewerStore.getState();
            const nt = ns.tabs.find((t) => t.id === ns.activeTabId);
            if (nt) {
                useDbViewerStore.setState((s) => ({
                    tabs: s.tabs.map((t) =>
                        t.id === nt.id ? { ...t, query: sql } : t,
                    ),
                }));
                if (isDestructiveQuery(sql)) {
                    setDestructiveQuery(sql);
                } else {
                    executeQueryForTab(nt.id, sql);
                }
            }
        });
    }, [connectionId]);

    // Cmd+W / Ctrl+W: close current tab, or navigate home if no tabs (configurable in Settings → Shortcuts)
    useShortcut("close_tab", () => {
        const state = useDbViewerStore.getState();
        if (state.activeTabId) {
            state.closeTab(state.activeTabId);
        } else {
            onHome();
        }
    });
    useEffect(() => {
        if (!activeTab) return;
        if (activeTab.tabType !== "table") return;
        if (!activeTab.loading) return;
        if (activeTab.error) return;
        fetchData(activeTab);
    }, [activeTab, fetchData]);

    // Smart default sort: apply once when data first loads for a tab
    useEffect(() => {
        if (!activeTab) return;
        if (activeTab.tabType !== "table") return;
        if (activeTab.loading) return;
        if (!activeTab.data) return;
        if (activeTab.smartSortApplied) return;

        const cols = activeTab.data.columns;

        const getColType = (name: string) => {
            const col = cols.find(
                (c) => c.name.toLowerCase() === name.toLowerCase(),
            );
            return col?.data_type.toLowerCase() ?? "";
        };
        const isNumeric = (name: string) => {
            const t = getColType(name);
            return [
                "integer",
                "int",
                "int2",
                "int4",
                "int8",
                "smallint",
                "bigint",
                "serial",
                "bigserial",
                "smallserial",
                "tinyint",
                "mediumint",
                "numeric",
                "decimal",
                "real",
                "float",
                "float4",
                "float8",
                "double precision",
                "double",
                "number",
            ].includes(t);
        };
        const isTimestamp = (name: string) => {
            const t = getColType(name);
            return [
                "timestamp",
                "timestamptz",
                "timestamp without time zone",
                "timestamp with time zone",
                "date",
                "datetime",
                "datetime2",
                "smalldatetime",
            ].some((pt) => t.includes(pt));
        };

        // Find the first column name that exists and passes type checks
        const findCol = (
            candidates: string[],
            numericOnly = false,
        ): string | undefined => {
            for (const cand of candidates) {
                const match = cols.find(
                    (c) => c.name.toLowerCase() === cand.toLowerCase(),
                );
                if (!match) continue;
                if (numericOnly && !isNumeric(match.name)) continue;
                return match.name;
            }
            return undefined;
        };
        const findBySuffix = (
            suffixes: string[],
            numericOnly = false,
        ): string | undefined => {
            for (const c of cols) {
                const name = c.name.toLowerCase();
                if (suffixes.some((s) => name.endsWith(s))) {
                    if (numericOnly && !isNumeric(c.name)) continue;
                    return c.name;
                }
            }
            return undefined;
        };
        const findByPrefix = (
            prefixes: string[],
            numericOnly = false,
        ): string | undefined => {
            for (const c of cols) {
                const name = c.name.toLowerCase();
                if (prefixes.some((p) => name.startsWith(p))) {
                    if (numericOnly && !isNumeric(c.name)) continue;
                    return c.name;
                }
            }
            return undefined;
        };

        // Priority-ordered rules: each returns [columnName | undefined, order]
        const rules: Array<() => [string | undefined, "asc" | "desc"]> = [
            // Tier 1: Explicit recency columns
            () => [
                findCol([
                    "updated_at",
                    "modified_at",
                    "changed_at",
                    "altered_at",
                    "revised_at",
                ]),
                "desc",
            ],
            () => [
                findCol([
                    "created_at",
                    "inserted_at",
                    "added_at",
                    "published_at",
                    "posted_at",
                    "registered_at",
                ]),
                "desc",
            ],
            () => [
                findCol([
                    "deleted_at",
                    "removed_at",
                    "expired_at",
                    "archived_at",
                ]),
                "desc",
            ],
            // Tier 2: Generic date/timestamp columns (DESC = newest)
            () => {
                const col = cols.find((c) => isTimestamp(c.name));
                return col ? [col.name, "desc"] : [undefined, "desc"];
            },
            // Tier 3: Any *_at suffix (covers updated_at, created_at, etc. in any casing)
            () => [findBySuffix(["_at"]), "desc"],
            // Tier 4: Any *_on suffix (e.g. action_on, performed_on)
            () => [findBySuffix(["_on"]), "desc"],
            // Tier 5: last_* prefix (e.g. last_login, last_seen, last_modified)
            () => [findByPrefix(["last_"]), "desc"],
            // Tier 6: Numeric ID (DESC = highest/newest)
            () => [findCol(["id", "uid", "pk"], true), "desc"],
            // Tier 7: Any *_id suffix (numeric FKs usually increment)
            () => [findBySuffix(["_id"], true), "desc"],
            // Tier 8: Sequence/order columns (ASC = natural order)
            () => [
                findCol(
                    [
                        "seq",
                        "sequence",
                        "ordinal",
                        "sort",
                        "sort_order",
                        "sortorder",
                        "position",
                        "pos",
                        "display_order",
                    ],
                    true,
                ),
                "asc",
            ],
            // Tier 9: Rank/priority (ASC if lower = higher priority, DESC if higher = more)
            () => [
                findCol(
                    [
                        "rank",
                        "ranking",
                        "priority",
                        "weight",
                        "score",
                        "rating",
                    ],
                    true,
                ),
                "desc",
            ],
            // Tier 10: Version/revision tracking (DESC = latest)
            () => [
                findCol(
                    ["version", "revision", "rev", "build", "release"],
                    true,
                ),
                "desc",
            ],
            // Tier 11: Count/quantity (DESC = most)
            () => [
                findCol(
                    [
                        "count",
                        "total",
                        "amount",
                        "quantity",
                        "qty",
                        "num",
                        "number",
                        "no",
                    ],
                    true,
                ),
                "desc",
            ],
        ];

        for (const rule of rules) {
            const [colName, order] = rule();
            if (colName) {
                setSmartSortApplied(activeTab.id);
                setSortRules(activeTab.id, [
                    { id: crypto.randomUUID(), column: colName, order },
                ]);
                return;
            }
        }
    }, [activeTab]);

    // Sync tab columnFilter (set by FK popover) into the toolbar filterRules
    useEffect(() => {
        if (!activeTab?.columnFilter) return;
        const { column, value } = activeTab.columnFilter;
        const currentRules = activeTab.filterRules ?? [];
        const exists = currentRules.some(
            (r) => r.column === column && r.value === value,
        );
        if (exists) return;
        setFilterRules(activeTab.id, [
            ...currentRules,
            {
                id: crypto.randomUUID(),
                column,
                operator: "contains" as const,
                value,
            },
        ]);
    }, [activeTab?.columnFilter, activeTab?.id, activeTab?.filterRules, setFilterRules]);

    // When the FK filter rule is removed from the toolbar, clear the tab's columnFilter
    useEffect(() => {
        if (!activeTab?.columnFilter) return;
        const { column, value } = activeTab.columnFilter;
        const stillExists = filterRules.some(
            (r) => r.column === column && r.value === value,
        );
        if (!stillExists) {
            clearColumnFilter(activeTab.id);
        }
    }, [filterRules, activeTab, clearColumnFilter]);

    // Refresh: clear data so auto-fetch effect re-fetches; for query tabs, re-run the stored query
    const handleRefresh = useCallback(() => {
        const tabId = useDbViewerStore.getState().activeTabId;
        if (!tabId) return;
        const tab = useDbViewerStore.getState().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        if (tab.tabType === "query") {
            const sql = tab.query?.trim() ?? "";
            if (sql) executeQueryForTab(tabId, sql);
            return;
        }
        useDbViewerStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
                t.id === tabId ? { ...t, loading: true, error: null } : t,
            ),
        }));
    }, []);

    const rawRows = activeTab?.data?.rows ?? [];
    const columns = activeTab?.data?.columns ?? [];
    // Data is already filtered and sorted server-side; no client-side transform needed.
    const processedRows = rawRows;

    const onPanelResizeStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            panelResizeRef.current = {
                startX: e.clientX,
                startW: tablePanelWidth,
            };
            const onMove = (ev: MouseEvent) => {
                if (!panelResizeRef.current) return;
                const w = Math.max(
                    180,
                    Math.min(
                        600,
                        panelResizeRef.current.startW +
                            (ev.clientX - panelResizeRef.current.startX),
                    ),
                );
                setTablePanelWidth(w);
            };
            const onUp = () => {
                panelResizeRef.current = null;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [tablePanelWidth],
    );

const onQueriesPanelResizeStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            queriesPanelResizeRef.current = {
                startX: e.clientX,
                startW: queriesPanelWidth,
            };
            const onMove = (ev: MouseEvent) => {
                if (!queriesPanelResizeRef.current) return;
                const w = Math.max(
                    180,
                    Math.min(
                        600,
                        queriesPanelResizeRef.current.startW +
                            (ev.clientX - queriesPanelResizeRef.current.startX),
                    ),
                );
                setQueriesPanelWidth(w);
            };
            const onUp = () => {
                queriesPanelResizeRef.current = null;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [queriesPanelWidth],
    );

    // Query results panel: collapsible + resizable (min 120px, max 80% of column)
    const queryColumnRef = useRef<HTMLDivElement>(null);
    const resultsResizeRef = useRef<{ startY: number; startH: number } | null>(
        null,
    );
    const [resultsHeight, setResultsHeight] = useState(() =>
        Math.round(
            (typeof window !== "undefined" ? window.innerHeight : 800) * 0.4,
        ),
    );
    const [resultsCollapsed, setResultsCollapsed] = useState(false);

    const onResultsResizeStart = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            resultsResizeRef.current = {
                startY: e.clientY,
                startH: resultsHeight,
            };
            const columnH =
                queryColumnRef.current?.clientHeight ||
                (typeof window !== "undefined" ? window.innerHeight : 800);
            const maxH = Math.max(120, Math.round(columnH * 0.8));
            const onMove = (ev: MouseEvent) => {
                if (!resultsResizeRef.current) return;
                const h =
                    resultsResizeRef.current.startH +
                    (resultsResizeRef.current.startY - ev.clientY);
                setResultsHeight(Math.max(120, Math.min(maxH, h)));
            };
            const onUp = () => {
                resultsResizeRef.current = null;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [resultsHeight],
    );

    const handleNavigate = useCallback(
        (view: string) => {
            if (view === "home") onHome();
            else if (view === "settings") onSettings();
            else setCurrentView(view);
        },
        [onHome, onSettings],
    );

    const activeSchema = activeTab?.schema ?? "";
    const activeTable = activeTab?.table ?? "";

    function renderQueryWorkspace() {
        return (
                            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
                                <TabBar />
                                {!activeTab ? (
                                    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted">
                                        {currentView === "queries" ? (
                                            <Terminal size={32} />
                                        ) : (
                                            <Table2 size={32} />
                                        )}
                                        <span>
                                            {currentView === "queries"
                                                ? "Open a new query tab or run a query from the history"
                                                : "Select a table from the tree to browse its data, or open a new query tab"}
                                        </span>
                                    </div>
                                ) : activeTab?.tabType === "query" ? (
                                    <Suspense
                                        fallback={
                                            <div className="p-4 text-text-muted">
                                                Loading editor...
                                            </div>
                                        }
                                    >
                                        <div ref={queryColumnRef} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                                            <QueryToolbar
                                                onRun={handleRunQuery}
                                                onFormat={handleFormatQuery}
                                                connectionId={connectionId}
                                                onRestore={handleRestoreSql}
                                                onRunFromHistory={handleRunFromHistory}
                                                dbType={currentConnection?.db_type}
                                            />
                                            <div className="flex-1 min-h-0 overflow-hidden">
                                                <QueryEditor
                                                    value={activeTab.query ?? ""}
                                                    onChange={(value) =>
                                                        useDbViewerStore.setState(
                                                            (s) => ({
                                                                tabs: s.tabs.map(
                                                                    (t) =>
                                                                        t.id ===
                                                                        activeTab.id
                                                                            ? {
                                                                                  ...t,
                                                                                  query: value,
                                                                              }
                                                                            : t,
                                                                ),
                                                            }),
                                                        )
                                                    }
                                                    onRun={handleRunQuery}
                                                />
                                            </div>
                                            {!resultsCollapsed ? (
                                                <>
                                                    <div className="relative shrink-0">
                                                        <div
                                                            data-testid="query-results-resize"
                                                            aria-label="Resize results"
                                                            onMouseDown={
                                                                onResultsResizeStart
                                                            }
                                                            onDoubleClick={() =>
                                                                setResultsHeight(
                                                                    Math.round(
                                                                        (typeof window !==
                                                                            "undefined"
                                                                            ? window
                                                                                  .innerHeight
                                                                            : 800) *
                                                                            0.4,
                                                                    ),
                                                                )
                                                            }
                                                            className="h-1 cursor-row-resize bg-border/20 hover:bg-accent/30 active:bg-accent/50"
                                                        />
                                                        {/* caret pill, centered on the drag strip */}
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setResultsCollapsed(
                                                                    true,
                                                                )
                                                            }
                                                            aria-label="Hide results"
                                                            onMouseDown={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full border border-border bg-surface px-2 py-0.5 text-text-muted hover:text-text hover:bg-surface-raised shadow-sm transition-colors cursor-pointer"
                                                        >
                                                            <ChevronDown size={12} />
                                                        </button>
                                                    </div>
                                                    <div
                                                        data-testid="query-results"
                                                        style={{
                                                            height: resultsHeight,
                                                        }}
                                                        className="flex flex-col min-h-0 shrink-0"
                                                    >
                                                        {activeTab?.data && (
                                                            <TableControls
                                                                connectionId={connectionId}
                                                                schema={activeSchema}
                                                                table={activeTable}
                                                                columns={columns}
                                                                rows={rawRows}
                                                                hiddenColumns={
                                                                    hiddenColumns
                                                                }
                                                                onToggleColumn={(
                                                                    col,
                                                                ) =>
                                                                    toggleHiddenColumn(
                                                                        activeTab!.id,
                                                                        col,
                                                                    )
                                                                }
                                                                onRefresh={
                                                                    handleRefresh
                                                                }
                                                                filterRules={
                                                                    filterRules
                                                                }
                                                                onFilterChange={(
                                                                    rules,
                                                                ) =>
                                                                    setFilterRules(
                                                                        activeTab!.id,
                                                                        rules,
                                                                    )
                                                                }
                                                                sortRules={
                                                                    sortRules
                                                                }
                                                                onSortChange={(
                                                                    rules,
                                                                ) =>
                                                                    setSortRules(
                                                                        activeTab!.id,
                                                                        rules,
                                                                    )
                                                                }
                                                                defaultRefreshRate={
                                                                    settings?.table_refresh_rate ??
                                                                    0
                                                                }
                                                                selectedCount={
                                                                    selectedRows.size
                                                                }
                                                                selectedRows={processedRows.filter(
                                                                    (_, i) =>
                                                                        selectedRows.has(
                                                                            i,
                                                                        ),
                                                                )}
                                                                onClearSelection={() =>
                                                                    setSelectedRows(
                                                                        new Set(),
                                                                    )
                                                                }
                                                                variant="query"
                                                            />
                                                        )}
                                                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                                <VirtualDataGrid
                                                    connectionId={connectionId}
                                                    schema={activeSchema}
                                                    rows={processedRows}
                                                    columns={columns}
                                                    hiddenColumns={hiddenColumns}
                                                    selectedRows={selectedRows}
                                                    onToggleRow={(rowIndex) => {
                                                        setSelectedRows(
                                                            (prev) => {
                                                                const next =
                                                                    new Set(
                                                                        prev,
                                                                    );
                                                                if (
                                                                    next.has(
                                                                        rowIndex,
                                                                    )
                                                                )
                                                                    next.delete(
                                                                        rowIndex,
                                                                    );
                                                                else
                                                                    next.add(
                                                                        rowIndex,
                                                                    );
                                                                return next;
                                                            },
                                                        );
                                                    }}
                                                    onToggleAll={() => {
                                                        setSelectedRows(
                                                            (prev) => {
                                                                if (
                                                                    prev.size ===
                                                                        processedRows.length &&
                                                                    processedRows.length >
                                                                        0
                                                                ) {
                                                                    return new Set();
                                                                }
                                                                return new Set(
                                                                    processedRows.map(
                                                                        (_, i) =>
                                                                            i,
                                                                    ),
                                                                );
                                                            },
                                                        );
                                                    }}
                                                />
                                                    </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    {/* collapsed caret pill, pinned to the bottom of the editor */}
                                                    <div className="flex shrink-0 justify-center py-1">
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setResultsCollapsed(
                                                                    false,
                                                                )
                                                            }
                                                            aria-label="Show results"
                                                            className="flex items-center justify-center rounded-full border border-border bg-surface px-2 py-0.5 text-text-muted hover:text-text hover:bg-surface-raised shadow-sm transition-colors cursor-pointer"
                                                        >
                                                            <ChevronUp size={12} />
                                                        </button>
                                                    </div>
                                                </>
                                            )}
                                            <DestructiveQueryDialog
                                                open={destructiveQuery !== null}
                                                query={destructiveQuery ?? ""}
                                                onConfirm={() => {
                                                    if (
                                                        destructiveQuery &&
                                                        activeTab
                                                    ) {
                                                        executeQueryForTab(
                                                            activeTab.id,
                                                            destructiveQuery,
                                                        );
                                                    }
                                                    setDestructiveQuery(null);
                                                }}
                                                onCancel={() =>
                                                    setDestructiveQuery(null)
                                                }
                                            />
                                        </div>
                                    </Suspense>
                                ) : (
                                    <>
                                        {activeTab?.data && (
                                            <TableControls
                                                connectionId={connectionId}
                                                schema={activeSchema}
                                                table={activeTable}
                                                columns={columns}
                                                rows={rawRows}
                                                hiddenColumns={hiddenColumns}
                                                onToggleColumn={(col) =>
                                                    toggleHiddenColumn(
                                                        activeTab!.id,
                                                        col,
                                                    )
                                                }
                                                onRefresh={handleRefresh}
                                                filterRules={filterRules}
                                                onFilterChange={(rules) =>
                                                    setFilterRules(
                                                        activeTab!.id,
                                                        rules,
                                                    )
                                                }
                                                sortRules={sortRules}
                                                onSortChange={(rules) =>
                                                    setSortRules(
                                                        activeTab!.id,
                                                        rules,
                                                    )
                                                }
                                                defaultRefreshRate={
                                                    settings?.table_refresh_rate ??
                                                    0
                                                }
                                                selectedCount={selectedRows.size}
                                                selectedRows={processedRows.filter(
                                                    (_, i) =>
                                                        selectedRows.has(i),
                                                )}
                                                onClearSelection={() =>
                                                    setSelectedRows(new Set())
                                                }
                                            />
                                        )}
                                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                            <VirtualDataGrid
                                                connectionId={connectionId}
                                                schema={activeSchema}
                                                rows={processedRows}
                                                columns={columns}
                                                hiddenColumns={hiddenColumns}
                                                selectedRows={selectedRows}
                                                onToggleRow={(rowIndex) => {
                                                    setSelectedRows((prev) => {
                                                        const next = new Set(
                                                            prev,
                                                        );
                                                        if (next.has(rowIndex))
                                                            next.delete(
                                                                rowIndex,
                                                            );
                                                        else next.add(rowIndex);
                                                        return next;
                                                    });
                                                }}
                                                onToggleAll={() => {
                                                    setSelectedRows((prev) => {
                                                        if (
                                                            prev.size ===
                                                                processedRows.length &&
                                                            processedRows.length >
                                                                0
                                                        ) {
                                                            return new Set();
                                                        }
                                                        return new Set(
                                                            processedRows.map(
                                                                (_, i) => i,
                                                            ),
                                                        );
                                                    });
                                                }}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
        );
    }

    return (
        <TooltipProvider>
            <div className="h-screen bg-canvas flex border-t border-border">
                <DbViewerSidebar
                    currentView={currentView}
                    onNavigate={handleNavigate}
                />
                <div className="flex-1 flex flex-col min-h-0">
                    {connectionError && connectionError !== dismissedError && (
                        <ConnectionDropBanner
                            error={connectionError}
                            onRetry={() => {
                                setDismissedError(null);
                                connect();
                            }}
                            onDismiss={() => setDismissedError(connectionError)}
                        />
                    )}
                    {currentView === "db-viewer" ? (
                        <div className="flex flex-1 min-h-0 overflow-hidden">
                            <div
                                className="border-r border-border flex flex-col shrink-0"
                                style={{ width: tablePanelWidth }}
                            >
                                <DbViewerToolbar
                                    databases={databases}
                                    currentDatabase={currentDatabase}
                                    setCurrentDatabase={setCurrentDatabase}
                                    schemas={schemas}
                                    currentSchema={currentSchema}
                                    setCurrentSchema={setCurrentSchema}
                                    onEdit={() => setEditModalOpen(true)}
                                    connectionId={connectionId}
                                    searchQuery={searchQuery}
                                    onSearchChange={setSearchQuery}
                                />
                                <div
                                    className="flex-1 overflow-y-auto"
                                    style={{ overscrollBehavior: "none" }}
                                >
                                    <TableTree searchQuery={searchQuery} />
                                </div>
                            </div>
                            {/* panel resize handle */}
                            <div
                                className="w-1 cursor-col-resize bg-border/20 hover:bg-accent/30 active:bg-accent/50 shrink-0 border-r border-border"
                                onMouseDown={onPanelResizeStart}
                                onDoubleClick={() => setTablePanelWidth(280)}
                            />
                            {renderQueryWorkspace()}
                        </div>
                    ) : currentView === "objects" ? (
                        <ObjectExplorerPage connectionId={connectionId} />
                    ) : currentView === "tools" ? (
                        <ToolsPage connectionId={connectionId} />
                    ) : currentView === "queries" ? (
                        <div className="flex flex-1 min-h-0 overflow-hidden">
                            <QueriesPanel
                                connectionId={connectionId}
                                onRestore={handleRestoreSql}
                                style={{ width: queriesPanelWidth }}
                            />
                            <div
                                className="w-1 cursor-col-resize bg-border/20 hover:bg-accent/30 active:bg-accent/50 shrink-0 border-r border-border"
                                onMouseDown={onQueriesPanelResizeStart}
                                onDoubleClick={() => setQueriesPanelWidth(280)}
                            />
                            {renderQueryWorkspace()}
                        </div>
                    ) : currentView === "schema-visualizer" ? (
                        <SchemaVisualizerPage
                            connectionId={connectionId}
                            onSchemaChange={(newSchema) => {
                                useDbViewerStore.getState().setCurrentSchema(newSchema);
                            }}
                        />
                    ) : null}
                    {(currentView === "db-viewer" || currentView === "queries") && <ChangesQueuePanel />}
                </div>
                {currentConnection && (
                    <EditConnectionModal
                        connection={currentConnection}
                        open={editModalOpen}
                        onClose={() => setEditModalOpen(false)}
                        onSaved={() => {}}
                    />
                )}
            </div>
        </TooltipProvider>
    );
}
