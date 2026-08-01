import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Download, Play, Star, Search, X } from "lucide-react";
import { useQueryStore } from "../../stores/queryStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Tooltip } from "../ui/Tooltip";
import { ErrorBanner } from "../ui/ErrorBanner";

interface QueriesPanelProps {
  connectionId: string;
  onRestore: (sql: string) => void;
  onRun: (sql: string) => void;
  style?: React.CSSProperties;
}

const MODE_OPTIONS = [
  { value: "history", label: "History" },
  { value: "saved", label: "Saved Queries" },
];

export function QueriesPanel({ connectionId, onRestore, onRun, style }: QueriesPanelProps) {
  const [mode, setMode] = useState<"history" | "saved">("history");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // History state
  const history = useQueryStore((s) => s.history);
  const historyLoading = useQueryStore((s) => s.historyLoading);
  const historyError = useQueryStore((s) => s.historyError);
  const historyStale = useQueryStore((s) => s.historyStale);
  const historySearch = useQueryStore((s) => s.historySearch);
  const favoritesOnly = useQueryStore((s) => s.favoritesOnly);
  const loadHistory = useQueryStore((s) => s.loadHistory);
  const clearHistory = useQueryStore((s) => s.clearHistory);
  const toggleFavorite = useQueryStore((s) => s.toggleFavorite);
  const setHistorySearch = useQueryStore((s) => s.setHistorySearch);
  const setFavoritesOnly = useQueryStore((s) => s.setFavoritesOnly);

  // Saved queries state
  const savedQueries = useQueryStore((s) => s.savedQueries);
  const savedLoading = useQueryStore((s) => s.savedLoading);
  const savedError = useQueryStore((s) => s.savedError);
  const loadSavedQueries = useQueryStore((s) => s.loadSavedQueries);
  const deleteSavedQuery = useQueryStore((s) => s.deleteSavedQuery);

  // Shared local search state; history mode also syncs to the store
  const [searchQuery, setSearchQuery] = useState(historySearch);
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setHistorySearch(value);
    },
    [setHistorySearch],
  );

  // Fetch scoped to this connection only
  useEffect(() => {
    if (historyStale) loadHistory(connectionId);
  }, [historyStale, connectionId, loadHistory]);

  useEffect(() => {
    loadSavedQueries(connectionId);
  }, [connectionId, loadSavedQueries]);

  // Focus input when search opens
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Auto-hide on blur when empty
  const handleSearchBlur = useCallback(() => {
    // Small delay to allow clicks on clear button / search icon
    setTimeout(() => {
      if (!searchQuery.trim()) {
        setSearchOpen(false);
      }
    }, 150);
  }, [searchQuery]);

  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      const next = !prev;
      if (!next) handleSearchChange(""); // clear when closing
      return next;
    });
  }, [handleSearchChange]);

  // Client-side filtering for the active mode
  const filteredHistory = (history ?? []).filter((e) => {
    if (favoritesOnly && !e.favorite) return false;
    if (searchQuery) {
      return e.query_text.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const filteredSaved = (savedQueries ?? []).filter((q) => {
    if (!searchQuery) return true;
    const haystack = [q.name, q.folder ?? "", q.query_text]
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full border-r border-border shrink-0" data-testid="queries-panel" style={style}>
      {/* Header row */}
      <div className={`px-3 pt-3 border-b border-border space-y-2 ${searchOpen ? "pb-3" : ""}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-normal text-text-muted">Queries</span>
          <div className="flex items-center gap-1">
            {mode === "history" && (
              <>
                <Tooltip
                  content={favoritesOnly ? "Show all queries" : "Show favorites only"}
                  side="bottom"
                >
                  <button
                    type="button"
                    aria-label="Show favorites only"
                    onClick={() => setFavoritesOnly(!favoritesOnly)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${
                      favoritesOnly
                        ? "text-accent bg-accent/10"
                        : "text-text-muted hover:text-text hover:bg-surface-raised"
                    }`}
                  >
                    <Star size={14} fill={favoritesOnly ? "currentColor" : "none"} />
                  </button>
                </Tooltip>
                <Tooltip content="Clear history" side="bottom">
                  <button
                    type="button"
                    aria-label="Clear history"
                    onClick={() => clearHistory(connectionId)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              </>
            )}
            <Tooltip content="Search queries" side="bottom">
              <button
                type="button"
                aria-label="Search queries"
                onClick={toggleSearch}
                className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${
                  searchOpen
                    ? "text-accent bg-accent/10"
                    : "text-text-muted hover:text-text hover:bg-surface-raised"
                }`}
              >
                <Search size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        {/* Mode dropdown — its own row, Explorer-style */}
        <div className="flex items-center">
          <SelectDropdown
            value={mode}
            onChange={(v) => setMode(v as "history" | "saved")}
            options={MODE_OPTIONS}
            variant="ghost"
            aria-label="History/Saved"
          />
        </div>
        {/* Animated search input */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-out ${searchOpen ? "max-h-10 opacity-100" : "max-h-0 opacity-0"}`}
        >
          <div className="relative flex items-center">
            <Search
              size={12}
              className="absolute left-2.5 text-text-muted pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onBlur={handleSearchBlur}
              placeholder="Filter queries…"
              className="w-full bg-transparent border-0 border-b border-border pl-8 pr-7 py-1.5 text-xs text-text placeholder:text-text-muted/60 outline-none focus:border-accent/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange("")}
                className="absolute right-1 flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {mode === "history" && (
          <>
            {historyLoading && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">Loading...</div>
            )}
            {historyError && (
              <ErrorBanner error={historyError} onRetry={() => loadHistory(connectionId)} />
            )}
            {!historyLoading && !historyError && filteredHistory.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                {searchQuery || favoritesOnly ? "No matching queries" : "No queries yet"}
              </div>
            )}
            {filteredHistory.map((entry) => (
              <div
                key={entry.id}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-raised border-b border-border/50 transition-colors"
              >
                <button
                  type="button"
                  aria-label={entry.favorite ? "Unfavorite" : "Favorite"}
                  onClick={() => toggleFavorite(entry.id, entry.connection_id)}
                  className={`shrink-0 mt-0.5 cursor-pointer ${
                    entry.favorite ? "text-amber-400" : "text-text-muted opacity-40 group-hover:opacity-80"
                  }`}
                >
                  <Star className="h-3.5 w-3.5" fill={entry.favorite ? "currentColor" : "none"} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text font-mono truncate">{entry.query_text}</div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-text-muted">
                    {entry.status === "error" ? (
                      <span className="text-red-400">Error</span>
                    ) : (
                      <>
                        {entry.execution_time_ms != null && <span>{entry.execution_time_ms}ms</span>}
                        {entry.row_count != null && <span>{entry.row_count} rows</span>}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Load query into editor"
                    title="Load into editor"
                    onClick={() => onRestore(entry.query_text)}
                    className="rounded p-1 text-text-muted hover:text-text cursor-pointer"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Run query from history"
                    title="Run"
                    onClick={() => onRun(entry.query_text)}
                    className="rounded p-1 text-text-muted hover:text-text cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {mode === "saved" && (
          <>
            {savedLoading && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">Loading...</div>
            )}
            {savedError && (
              <ErrorBanner error={savedError} onRetry={() => loadSavedQueries(connectionId)} />
            )}
            {!savedLoading && !savedError && savedQueries && savedQueries.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No saved queries yet
              </div>
            )}
            {filteredSaved.map((q) => (
              <div
                key={q.id}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-surface-raised border-b border-border/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text font-medium">{q.name}</div>
                  {q.folder && (
                    <div className="text-[10px] text-text-muted mt-0.5">{q.folder}</div>
                  )}
                  <div className="text-xs text-text-muted font-mono truncate max-w-md mt-0.5">{q.query_text}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Load saved query"
                    onClick={() => onRestore(q.query_text)}
                    className="rounded p-1 text-text-muted hover:text-text cursor-pointer"
                  >
                    <Download className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Run saved query"
                    onClick={() => onRun(q.query_text)}
                    className="rounded p-1 text-text-muted hover:text-text cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete saved query"
                    onClick={() => deleteSavedQuery(q.id)}
                    className="rounded p-1 text-text-muted hover:text-red-400 cursor-pointer"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}