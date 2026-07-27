import { useEffect, useCallback } from "react";
import { TooltipProvider } from "../ui/Tooltip";
import { DbViewerSidebar } from "./DbViewerSidebar";
import { DbViewerToolbar } from "./DbViewerToolbar";
import { TableTree } from "./TableTree";
import { TabBar } from "./TabBar";
import { DataGrid } from "./DataGrid";
import { PaginationControls } from "./PaginationControls";
import { ChangesQueuePanel } from "./ChangesQueuePanel";
import { useDbViewerStore } from "../../stores/dbViewerStore";

export interface DbViewerScreenProps {
  connectionId: string;
  onHome: () => void;
  onSettings: () => void;
}

export function DbViewerScreen({ connectionId, onHome, onSettings }: DbViewerScreenProps) {
  const reset = useDbViewerStore((state) => state.reset);

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

  useEffect(() => {
    return () => {
      const hasPending = useDbViewerStore
        .getState()
        .changesQueue.some((c) => c.status === "pending");
      if (!hasPending) reset();
    };
  }, [connectionId, reset]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-canvas flex">
        <DbViewerSidebar currentView="db-viewer" onNavigate={handleNavigate} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex">
            <div className="w-72 border-r border-border flex flex-col">
              <DbViewerToolbar />
              <TableTree />
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <TabBar />
              <div className="flex-1 flex flex-col">
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