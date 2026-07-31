import { X } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";

export function TabBar() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const closeTab = useDbViewerStore((state) => state.closeTab);
  const setActiveTab = useDbViewerStore((state) => state.setActiveTab);

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-nowrap h-8 items-stretch overflow-x-auto border-b border-border"
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
  );
}