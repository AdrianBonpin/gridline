import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";

export function PaginationControls() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const setPage = useDbViewerStore((state) => state.setPage);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || !activeTab.data) {
    return null;
  }

  const { data } = activeTab;
  const totalRows = data.total_rows;
  const totalPages = Math.max(1, Math.ceil(totalRows / activeTab.pageSize));

  const clampedPage = Math.max(1, Math.min(activeTab.page, totalPages));
  const startRow = (clampedPage - 1) * activeTab.pageSize + 1;
  const endRow = Math.min(clampedPage * activeTab.pageSize, totalRows);

  const canGoPrev = clampedPage > 1;
  const canGoNext = clampedPage < totalPages;

  const handlePrev = () => {
    if (canGoPrev && activeTabId) {
      setPage(activeTabId, clampedPage - 1);
    }
  };

  const handleNext = () => {
    if (canGoNext && activeTabId) {
      setPage(activeTabId, clampedPage + 1);
    }
  };

  return (
    <div className="flex h-10 items-center justify-between border-t border-border px-3 text-sm text-text-muted">
      <span>
        {startRow}-{endRow} of {totalRows}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!canGoPrev}
          aria-label="Previous page"
          className="flex items-center rounded p-1 transition-colors hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4rem] text-center text-text">
          Page {clampedPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={handleNext}
          disabled={!canGoNext}
          aria-label="Next page"
          className="flex items-center rounded p-1 transition-colors hover:bg-surface-raised disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}