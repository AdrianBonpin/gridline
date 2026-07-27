import { ChevronLeft, ChevronRight } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";

const PAGE_SIZES = [50, 100, 200] as const;

export function PaginationControls() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const setPage = useDbViewerStore((state) => state.setPage);
  const setPageSize = useDbViewerStore((state) => state.setPageSize);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  if (!activeTab || !activeTab.data) {
    return null;
  }

  const { data } = activeTab;
  const pageSize = activeTab.pageSize;
  const totalRows = data.total_rows;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  const clampedPage = Math.max(1, Math.min(activeTab.page, totalPages));
  const startRow = (clampedPage - 1) * pageSize + 1;
  const endRow = Math.min(clampedPage * pageSize, totalRows);

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

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (activeTabId) {
      setPageSize(activeTabId, Number(e.target.value));
    }
  };

  return (
    <div className="flex h-10 items-center justify-between border-t border-border px-3 text-sm text-text-muted">
      <div className="flex items-center gap-3">
        <span>
          {startRow}-{endRow} of {totalRows}
        </span>
        <label className="flex items-center gap-1.5 text-xs">
          <span>Show</span>
          <select
            value={pageSize}
            onChange={handlePageSizeChange}
            className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text outline-none focus:border-accent"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
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