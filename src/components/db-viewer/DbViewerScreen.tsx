import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "../ui/Tooltip";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { TableTree } from "./TableTree";
import { TabBar } from "./TabBar";
import { DataGrid } from "./DataGrid";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { TableControls } from "./TableControls";
import { useDbConnection } from "../../hooks/useDbConnection";
import { useDbViewerStore } from "../../stores/dbViewerStore";
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
  operator: "eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt" | "null" | "notnull";
  value: string;
};

type SortRule = { id: string; column: string; order: "asc" | "desc" };

function applyFilters(rows: unknown[][], columns: ColumnInfo[], rules: FilterRule[]): unknown[][] {
  if (rules.length === 0) return rows;
  return rows.filter((row) =>
    rules.every((rule) => {
      const ci = columns.findIndex((c) => c.name === rule.column);
      if (ci < 0) return true;
      const cell = row[ci];
      const str = cell === null || cell === undefined ? "" : String(cell);
      switch (rule.operator) {
        case "null": return cell === null;
        case "notnull": return cell !== null;
        case "eq": return str === rule.value;
        case "neq": return str !== rule.value;
        case "contains": return str.toLowerCase().includes(rule.value.toLowerCase());
        case "starts": return str.toLowerCase().startsWith(rule.value.toLowerCase());
        case "ends": return str.toLowerCase().endsWith(rule.value.toLowerCase());
        case "gt": return Number(str) > Number(rule.value);
        case "lt": return Number(str) < Number(rule.value);
        default: return true;
      }
    }),
  );
}

function applySorts(rows: unknown[][], columns: ColumnInfo[], rules: SortRule[]): unknown[][] {
  if (rules.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const rule of rules) {
      const ci = columns.findIndex((c) => c.name === rule.column);
      if (ci < 0) continue;
      const va = a[ci];
      const vb = b[ci];
      const cmp =
        va === null && vb === null ? 0
        : va === null ? -1
        : vb === null ? 1
        : String(va).localeCompare(String(vb), undefined, { numeric: true });
      if (cmp !== 0) return rule.order === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

export function DbViewerScreen({ connectionId, onHome, onSettings }: DbViewerScreenProps) {
  const { connectionError, connect } = useDbConnection(connectionId);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [tablePanelWidth, setTablePanelWidth] = useState(280);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const panelResizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const activeTab = useDbViewerStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });
  const setTabData = useDbViewerStore((s) => s.setTabData);
  const setTabError = useDbViewerStore((s) => s.setTabError);
  const fetchingRef = useRef<Set<string>>(new Set());

  const fetchData = useCallback(async (tab: NonNullable<typeof activeTab>) => {
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
  }, [connectionId, setTabData, setTabError]);

  // Auto-fetch when tab needs data
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.data !== null || activeTab.loading || activeTab.error) return;
    fetchData(activeTab);
  }, [activeTab, fetchData]);

  // Refresh: clear data so auto-fetch effect re-fetches
  const handleRefresh = useCallback(() => {
    const tabId = useDbViewerStore.getState().activeTabId;
    if (!tabId) return;
    useDbViewerStore.setState((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, data: null, loading: false, error: null } : t,
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

  const onPanelResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    panelResizeRef.current = { startX: e.clientX, startW: tablePanelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!panelResizeRef.current) return;
      const w = Math.max(180, Math.min(600, panelResizeRef.current.startW + (ev.clientX - panelResizeRef.current.startX)));
      setTablePanelWidth(w);
    };
    const onUp = () => {
      panelResizeRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [tablePanelWidth]);

  const handleNavigate = useCallback(
    (view: string) => {
      if (view === "home") onHome();
      else if (view === "settings") onSettings();
    },
    [onHome, onSettings],
  );

  const activeSchema = activeTab?.schema ?? "";
  const activeTable = activeTab?.table ?? "";

  return (
    <TooltipProvider>
      <div className="h-screen bg-canvas flex">
        <DbViewerSidebar currentView="db-viewer" onNavigate={handleNavigate} />
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
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="border-r border-border flex flex-col shrink-0" style={{ width: tablePanelWidth }}>
              <DbViewerToolbar />
              <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "none" }}>
                <TableTree />
              </div>
            </div>
            {/* panel resize handle */}
            <div
              className="w-[5px] cursor-col-resize hover:bg-accent/30 active:bg-accent/50 shrink-0"
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
                      if (next.has(col)) next.delete(col); else next.add(col);
                      return next;
                    })
                  }
                  onRefresh={handleRefresh}
                  filterRules={filterRules}
                  onFilterChange={setFilterRules}
                  sortRules={sortRules}
                  onSortChange={setSortRules}
                />
              )}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <DataGrid rows={processedRows} hiddenColumns={hiddenColumns} />
              </div>
            </div>
          </div>
          <ChangesQueuePanel />
        </div>
      </div>
    </TooltipProvider>
  );
}