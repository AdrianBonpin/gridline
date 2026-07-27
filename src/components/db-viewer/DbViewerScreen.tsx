import { useCallback, useEffect, useRef, useState } from "react";
import { TooltipProvider } from "../ui/Tooltip";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { TableTree } from "./TableTree";
import { TabBar } from "./TabBar";
import { DataGrid } from "./DataGrid";
import { PaginationControls } from "./PaginationControls";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { useDbConnection } from "../../hooks/useDbConnection";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { ConnectionDropBanner } from "./ConnectionDropBanner";
import * as cmd from "../../lib/commands";

export interface DbViewerScreenProps {
  connectionId: string;
  onHome: () => void;
  onSettings: () => void;
}

export function DbViewerScreen({ connectionId, onHome, onSettings }: DbViewerScreenProps) {
  const { connectionError, connect } = useDbConnection(connectionId);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // Issue 1: Auto-fetch table data when a tab becomes active and has no data
  const activeTab = useDbViewerStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });
  const setTabData = useDbViewerStore((s) => s.setTabData);
  const setTabError = useDbViewerStore((s) => s.setTabError);
  const fetchingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.data !== null || activeTab.loading || activeTab.error) return;
    if (fetchingRef.current.has(activeTab.id)) return;

    fetchingRef.current.add(activeTab.id);
    (async () => {
      try {
        const result = await cmd.getTableData(
          connectionId,
          activeTab.schema,
          activeTab.table,
          activeTab.page,
          activeTab.pageSize,
        );
        setTabData(activeTab.id, result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setTabError(activeTab.id, msg);
      } finally {
        fetchingRef.current.delete(activeTab.id);
      }
    })();
  }, [activeTab, connectionId, setTabData, setTabError]);

  const handleNavigate = useCallback(
    (view: string) => {
      if (view === "home") {
        onHome();
      } else if (view === "settings") {
        onSettings();
      }
    },
    [onHome, onSettings],
  );

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
            <div className="w-72 border-r border-border flex flex-col overflow-hidden">
              <DbViewerToolbar />
              <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "none" }}>
                <TableTree />
              </div>
            </div>
            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
              <TabBar />
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <DataGrid />
                <PaginationControls />
              </div>
            </div>
          </div>
          <ChangesQueuePanel />
        </div>
      </div>
    </TooltipProvider>
  );
}