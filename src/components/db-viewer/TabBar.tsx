import { useEffect, useRef } from "react";
import { ListChecks, Play, Table2, Terminal, X } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { ChangesQueuePanel } from "./ChangesQueuePanel";

export function TabBar() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const closeTab = useDbViewerStore((state) => state.closeTab);
  const setActiveTab = useDbViewerStore((state) => state.setActiveTab);
  const openQueryTab = useDbViewerStore((state) => state.openQueryTab);
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const changesPanelExpanded = useDbViewerStore(
    (state) => state.changesPanelExpanded,
  );
  const toggleChangesPanel = useDbViewerStore(
    (state) => state.toggleChangesPanel,
  );

  const pendingCount = changesQueue.filter(
    (c) => c.status === "pending",
  ).length;

  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!changesPanelExpanded) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        toggleChangesPanel();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toggleChangesPanel();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [changesPanelExpanded, toggleChangesPanel]);

  return (
    <div className="flex h-9 items-stretch border-b border-border">
      {/* Left: open tabs (scrollable) */}
      <div
        className="flex flex-1 min-w-0 items-stretch overflow-x-auto"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={[
                "group flex shrink-0 items-center gap-2 border-r border-border px-3 text-sm transition-colors cursor-pointer",
                isActive
                  ? "bg-canvas text-text"
                  : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              <span className="flex-1 text-left select-none">
                {tab.tabType === "query" ? (
                  <Terminal
                    data-testid="tab-icon-query"
                    className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                  />
                ) : (
                  <Table2
                    data-testid="tab-icon-table"
                    className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5 text-current"
                  />
                )}
                {tab.table}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                aria-label={`Close ${tab.table}`}
                className="rounded p-0.5 opacity-60 transition-opacity hover:bg-surface-raised hover:opacity-100 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Right: fixed actions */}
      <div className="flex shrink-0 items-center gap-1.5 border-l border-border px-2">
        <button
          type="button"
          onClick={openQueryTab}
          aria-label="New query tab"
          className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover cursor-pointer"
        >
          <Play className="h-3 w-3 fill-current" />
          Query
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => {
              if (changesQueue.length > 0) toggleChangesPanel();
            }}
            aria-label="Changes queue"
            className={[
              "flex items-center gap-1.5 rounded-md border bg-surface px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              pendingCount > 0
                ? "text-amber-400 border-amber-500 bg-amber-500/10 hover:bg-amber-500/20"
                : "border-border text-text-muted hover:text-text hover:bg-surface-raised",
            ].join(" ")}
          >
            <ListChecks className="h-3.5 w-3.5" />
            {pendingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {pendingCount}
              </span>
            )}
          </button>
          {changesPanelExpanded && (
            <div className="absolute right-0 top-full mt-1.5 z-30 w-[380px] max-w-[calc(100vw-2rem)] rounded-xl bg-surface border border-border shadow-lg overflow-hidden">
              <ChangesQueuePanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}