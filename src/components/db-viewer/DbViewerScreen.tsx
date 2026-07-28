import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "../ui/Tooltip";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { TableTree } from "./TableTree";
import { ObjectTree } from "./ObjectTree";
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
import * as cmd from "../../lib/commands";
import type { ColumnInfo } from "../../lib/types";

export interface DbViewerScreenProps {
    connectionId: string;
    onHome: () => void;
    onSettings: () => void;
}

// ─── client-side filter/sort helpers ─────────────────────

type FilterRule = {
    id: string;
    column: string;
    operator:
        | "eq"
        | "neq"
        | "contains"
        | "starts"
        | "ends"
        | "gt"
        | "lt"
        | "null"
        | "notnull";
    value: string;
};

type SortRule = { id: string; column: string; order: "asc" | "desc" };

function applyFilters(
    rows: unknown[][],
    columns: ColumnInfo[],
    rules: FilterRule[],
): unknown[][] {
    if (rules.length === 0) return rows;
    return rows.filter((row) =>
        rules.every((rule) => {
            const ci = columns.findIndex((c) => c.name === rule.column);
            if (ci < 0) return true;
            const cell = row[ci];
            const str = cell === null || cell === undefined ? "" : String(cell);
            switch (rule.operator) {
                case "null":
                    return cell === null;
                case "notnull":
                    return cell !== null;
                case "eq":
                    return str === rule.value;
                case "neq":
                    return str !== rule.value;
                case "contains":
                    return str.toLowerCase().includes(rule.value.toLowerCase());
                case "starts":
                    return str
                        .toLowerCase()
                        .startsWith(rule.value.toLowerCase());
                case "ends":
                    return str.toLowerCase().endsWith(rule.value.toLowerCase());
                case "gt":
                    return Number(str) > Number(rule.value);
                case "lt":
                    return Number(str) < Number(rule.value);
                default:
                    return true;
            }
        }),
    );
}

function applySorts(
    rows: unknown[][],
    columns: ColumnInfo[],
    rules: SortRule[],
): unknown[][] {
    if (rules.length === 0) return rows;
    return [...rows].sort((a, b) => {
        for (const rule of rules) {
            const ci = columns.findIndex((c) => c.name === rule.column);
            if (ci < 0) continue;
            const va = a[ci];
            const vb = b[ci];
            const cmp =
                va === null && vb === null
                    ? 0
                    : va === null
                      ? -1
                      : vb === null
                        ? 1
                        : String(va).localeCompare(String(vb), undefined, {
                              numeric: true,
                          });
            if (cmp !== 0) return rule.order === "asc" ? cmp : -cmp;
        }
        return 0;
    });
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
    const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
    const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
    const [sortRules, setSortRules] = useState<SortRule[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const smartSortApplied = useRef<Set<string>>(new Set());
    const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
    const [editModalOpen, setEditModalOpen] = useState(false);
    const connections = useConnectionStore((s) => s.connections);
    const currentConnection =
        connections.find((c) => c.id === connectionId) ?? null;
    const settings = useSettingsStore((s) => s.settings);
    const setDefaultPageSize = useDbViewerStore((s) => s.setDefaultPageSize);
    const clearColumnFilter = useDbViewerStore((s) => s.clearColumnFilter);

    // Sync settings defaults to store
    useEffect(() => {
        if (settings?.table_page_size) {
            setDefaultPageSize(settings.table_page_size);
        }
    }, [settings?.table_page_size, setDefaultPageSize]);
    const panelResizeRef = useRef<{ startX: number; startW: number } | null>(
        null,
    );

    const activeTab = useDbViewerStore((s) => {
        if (!s.activeTabId) return null;
        return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
    });
    const setTabData = useDbViewerStore((s) => s.setTabData);
    const setTabError = useDbViewerStore((s) => s.setTabError);
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
        if (!activeTab.loading) return;
        if (activeTab.error) return;
        fetchData(activeTab);
    }, [activeTab, fetchData]);

    // Smart default sort: apply once when data first loads for a tab
    useEffect(() => {
        if (!activeTab) return;
        if (activeTab.loading) return;
        if (!activeTab.data) return;
        if (smartSortApplied.current.has(activeTab.id)) return;

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
                smartSortApplied.current.add(activeTab.id);
                setSortRules([
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
        setFilterRules((prev) => {
            const exists = prev.some(
                (r) => r.column === column && r.value === value,
            );
            if (exists) return prev;
            return [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    column,
                    operator: "contains" as const,
                    value,
                },
            ];
        });
    }, [activeTab?.columnFilter]);

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

    // Refresh: clear data so auto-fetch effect re-fetches
    const handleRefresh = useCallback(() => {
        const tabId = useDbViewerStore.getState().activeTabId;
        if (!tabId) return;
        useDbViewerStore.setState((s) => ({
            tabs: s.tabs.map((t) =>
                t.id === tabId ? { ...t, loading: true, error: null } : t,
            ),
        }));
    }, []);

    const rawRows = activeTab?.data?.rows ?? [];
    const columns = activeTab?.data?.columns ?? [];
    const processedRows = useMemo(() => {
        let result = rawRows;
        result = applyFilters(result, columns, filterRules);
        result = applySorts(result, columns, sortRules);
        return result;
    }, [rawRows, columns, filterRules, sortRules]);

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
                                className="w-1.25 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 shrink-0"
                                onMouseDown={onPanelResizeStart}
                                onDoubleClick={() => setTablePanelWidth(280)}
                            />
                            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
                                <TabBar />
                                {activeTab?.data && (
                                    <TableControls
                                        connectionId={connectionId}
                                        schema={activeSchema}
                                        table={activeTable}
                                        columns={columns}
                                        rows={rawRows}
                                        hiddenColumns={hiddenColumns}
                                        onToggleColumn={(col) =>
                                            setHiddenColumns((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(col))
                                                    next.delete(col);
                                                else next.add(col);
                                                return next;
                                            })
                                        }
                                        onRefresh={handleRefresh}
                                        filterRules={filterRules}
                                        onFilterChange={setFilterRules}
                                        sortRules={sortRules}
                                        onSortChange={setSortRules}
                                        defaultRefreshRate={
                                            settings?.table_refresh_rate ?? 0
                                        }
                                        selectedCount={selectedRows.size}
                                        selectedRows={processedRows.filter(
                                            (_, i) => selectedRows.has(i),
                                        )}
                                        onClearSelection={() =>
                                            setSelectedRows(new Set())
                                        }
                                    />
                                )}
                                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                                    <VirtualDataGrid
                                        connectionId={connectionId}
                                        rows={processedRows}
                                        columns={columns}
                                        hiddenColumns={hiddenColumns}
                                        selectedRows={selectedRows}
                                        onToggleRow={(rowIndex) => {
                                            setSelectedRows((prev) => {
                                                const next = new Set(prev);
                                                if (next.has(rowIndex))
                                                    next.delete(rowIndex);
                                                else next.add(rowIndex);
                                                return next;
                                            });
                                        }}
                                        onToggleAll={() => {
                                            setSelectedRows((prev) => {
                                                if (
                                                    prev.size ===
                                                        processedRows.length &&
                                                    processedRows.length > 0
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
                            </div>
                        </div>
                    ) : currentView === "functions" ? (
                        <ObjectTree
                            type="functions"
                            connectionId={connectionId}
                        />
                    ) : currentView === "triggers" ? (
                        <ObjectTree
                            type="triggers"
                            connectionId={connectionId}
                        />
                    ) : currentView === "sequences" ? (
                        <ObjectTree
                            type="sequences"
                            connectionId={connectionId}
                        />
                    ) : currentView === "enums" ? (
                        <ObjectTree type="enums" connectionId={connectionId} />
                    ) : currentView === "extensions" ? (
                        <ObjectTree
                            type="extensions"
                            connectionId={connectionId}
                        />
                    ) : null}
                    {currentView === "db-viewer" && <ChangesQueuePanel />}
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
