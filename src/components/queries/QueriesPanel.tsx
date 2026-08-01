import { useState, useEffect } from "react";
import { Trash2, Download, Play, Star, Clock, Save } from "lucide-react";
import { useQueryStore } from "../../stores/queryStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Input } from "../ui/Input";
import { ErrorBanner } from "../ui/ErrorBanner";

interface QueriesPanelProps {
  connectionId: string;
  onRestore: (sql: string) => void;
  onRun: (sql: string) => void;
  style?: React.CSSProperties;
}

export function QueriesPanel({ connectionId, onRestore, onRun, style }: QueriesPanelProps) {
  const [activeTab, setActiveTab] = useState<"history" | "saved">("history");

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

  // Connections for filter dropdown
  const connections = useConnectionStore((s) => s.connections);
  const [scopeConn, setScopeConn] = useState<string>(connectionId);

  // Fetch on mount / scope change
  useEffect(() => {
    if (historyStale) loadHistory(scopeConn);
  }, [historyStale, scopeConn, loadHistory]);

  useEffect(() => {
    loadSavedQueries(scopeConn || null);
  }, [scopeConn, loadSavedQueries]);

  // Client-side filtering
  const filteredHistory = (history ?? []).filter((e) => {
    if (favoritesOnly && !e.favorite) return false;
    if (historySearch) {
      return e.query_text.toLowerCase().includes(historySearch.toLowerCase());
    }
    return true;
  });

  const scopeOptions = [
    { value: "", label: "All connections" },
    ...connections.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col h-full border-r border-border shrink-0" data-testid="queries-panel" style={style}>
      {/* Tab bar */}
      <div className="flex h-9 items-stretch border-b border-border shrink-0">
        {(["history", "saved"] as const).map((tab) => (
          <div
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={[
              "group flex shrink-0 items-center gap-2 border-r border-border px-3 text-sm transition-colors cursor-pointer",
              activeTab === tab
                ? "bg-canvas text-text"
                : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            {tab === "history" ? <Clock className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            <span className="select-none">{tab === "history" ? "History" : "Saved Queries"}</span>
          </div>
        ))}
      </div>

      {/* Toolbar: scope filter + search */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        <SelectDropdown
          value={scopeConn}
          onChange={setScopeConn}
          options={scopeOptions}
          variant="ghost"
          aria-label="Filter by connection"
        />
        {activeTab === "history" && (
          <>
            <Input
              value={historySearch}
              onChange={setHistorySearch}
              placeholder="Search queries..."
              className="!rounded-md !py-1 !text-xs !w-48"
              aria-label="Search history"
            />
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
                className="rounded border-border bg-surface cursor-pointer"
              />
              <Star className="h-3 w-3" fill={favoritesOnly ? "currentColor" : "none"} />
              Favorites
            </label>
            <button
              type="button"
              onClick={() => clearHistory(scopeConn || undefined)}
              className="ml-auto flex items-center gap-1 text-xs text-text-muted hover:text-red-400 transition-colors cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          </>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "history" && (
          <>
            {historyLoading && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">Loading...</div>
            )}
            {historyError && (
              <ErrorBanner error={historyError} onRetry={() => loadHistory(scopeConn)} />
            )}
            {!historyLoading && !historyError && filteredHistory.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                {historySearch || favoritesOnly ? "No matching queries" : "No queries yet"}
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
                    {scopeConn === "" && (
                      <span>{connections.find((c) => c.id === entry.connection_id)?.name ?? entry.connection_id}</span>
                    )}
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

        {activeTab === "saved" && (
          <>
            {savedLoading && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">Loading...</div>
            )}
            {savedError && (
              <ErrorBanner error={savedError} onRetry={() => loadSavedQueries(scopeConn || null)} />
            )}
            {!savedLoading && !savedError && savedQueries && savedQueries.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-text-muted">
                No saved queries yet
              </div>
            )}
            {(savedQueries ?? []).map((q) => (
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