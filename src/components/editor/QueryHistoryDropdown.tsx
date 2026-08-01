import { useState, useEffect, useRef, useCallback } from "react";
import { Clock, Trash2, Download, Play, Star } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useQueryStore } from "../../stores/queryStore";

interface QueryHistoryDropdownProps {
  connectionId: string;
  onRestore: (sql: string) => void;
  onRun: (sql: string) => void;
}

export function QueryHistoryDropdown({
  connectionId,
  onRestore,
  onRun,
}: QueryHistoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const history = useQueryStore((s) => s.history);
  const loading = useQueryStore((s) => s.historyLoading);
  const stale = useQueryStore((s) => s.historyStale);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const clearHistory = useQueryStore((s) => s.clearHistory);
  const toggleFavorite = useQueryStore((s) => s.toggleFavorite);

  // Lazy fetch on open
  const handleToggle = useCallback(() => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && stale) {
      loadHistory(connectionId);
    }
  }, [open, stale, connectionId, loadHistory]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <Tooltip content="Query history" side="bottom">
        <button
          type="button"
          onClick={handleToggle}
          aria-label="Query history"
          className="flex items-center rounded px-2 py-1.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer text-text-muted"
        >
          <Clock className="h-3.5 w-3.5" />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute left-0 top-full mt-1 rounded-xl bg-surface border border-border py-1 z-20 w-80 shadow-lg max-h-80 overflow-y-auto">
          {loading && (
            <div className="px-3 py-4 text-center text-sm text-text-muted">
              Loading...
            </div>
          )}
          {!loading && (!history || history.length === 0) && (
            <div className="px-3 py-4 text-center text-sm text-text-muted">
              No queries yet
            </div>
          )}
          {!loading && history && history.length > 0 && (
            <>
              {history.slice(0, 50).map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-start gap-2 px-3 py-2 hover:bg-surface-raised border-b border-border/50 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text font-mono truncate max-w-[220px]">
                      {entry.query_text}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                      {entry.status === "error" ? (
                        <span className="text-red-400">Error</span>
                      ) : (
                        <>
                          {entry.execution_time_ms != null && (
                            <span>{entry.execution_time_ms}ms</span>
                          )}
                          {entry.row_count != null && (
                            <span>{entry.row_count} rows</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip content="Load into editor" side="top">
                      <button
                        type="button"
                        aria-label="Load query into editor"
                        onClick={() => {
                          setOpen(false);
                          onRestore(entry.query_text);
                        }}
                        className="rounded p-1 text-text-muted hover:text-text hover:bg-surface-raised opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </Tooltip>
                    <Tooltip content="Run query" side="top">
                      <button
                        type="button"
                        aria-label="Run query from history"
                        onClick={() => {
                          setOpen(false);
                          onRun(entry.query_text);
                        }}
                        className="rounded p-1 text-text-muted hover:text-text hover:bg-surface-raised opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        <Play className="h-3 w-3" />
                      </button>
                    </Tooltip>
                    <button
                      type="button"
                      aria-label={entry.favorite ? "Unfavorite" : "Favorite"}
                      onClick={() => toggleFavorite(entry.id, connectionId)}
                      className={`rounded p-1 cursor-pointer ${
                        entry.favorite
                          ? "text-amber-400 hover:text-amber-300"
                          : "text-text-muted hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      }`}
                    >
                      <Star
                        className="h-3 w-3"
                        fill={entry.favorite ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                </div>
              ))}
              {/* Clear History footer */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  clearHistory(connectionId);
                }}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-text-muted hover:text-red-400 hover:bg-surface-raised transition-colors cursor-pointer border-t border-border"
              >
                <Trash2 className="h-3 w-3" />
                Clear History
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}