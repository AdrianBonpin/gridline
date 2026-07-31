import { Play, X } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";

export function TabBar() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const closeTab = useDbViewerStore((state) => state.closeTab);
  const setActiveTab = useDbViewerStore((state) => state.setActiveTab);
  const openQueryTab = useDbViewerStore((state) => state.openQueryTab);
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const toggleChangesPanel = useDbViewerStore(
    (state) => state.toggleChangesPanel,
  );

  const pendingCount = changesQueue.filter(
    (c) => c.status === "pending",
  ).length;

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
        <button
          type="button"
          onClick={() => {
            if (changesQueue.length > 0) toggleChangesPanel();
          }}
          aria-label="Changes queue"
          className={[
            "flex items-center gap-1.5 px-2.5 text-xs font-medium transition-colors cursor-pointer",
            pendingCount > 0
              ? "text-amber-400 hover:bg-surface-raised"
              : "text-text-muted hover:text-text hover:bg-surface-raised",
          ].join(" ")}
        >
          <span>Changes</span>
          {pendingCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
              {pendingCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}