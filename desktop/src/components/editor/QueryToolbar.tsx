import { useState } from "react";
import { Play, Square, Wand2, Save } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { QueryHistoryDropdown } from "./QueryHistoryDropdown";
import { SaveQueryDialog } from "./SaveQueryDialog";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { DbType } from "../../lib/types";

const DB_TYPE_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  redis: "Redis",
};

/**
 * Resolve the run-query modifier key for the given platform string
 * (from `navigator.platform`). Mac platforms show ⌘ + the return glyph,
 * everything else shows Ctrl + Enter.
 */
export function queryShortcut(platform: string): {
  mod: string;
  enter: string;
} {
  const isMac = /Mac|iPhone|iPad/.test(platform);
  return isMac
    ? { mod: "⌘", enter: "⏎" }
    : { mod: "Ctrl", enter: "Enter" };
}

interface QueryToolbarProps {
  onRun: () => void;
  onFormat: () => void;
  connectionId: string;
  onRestore: (sql: string) => void;
  onRunFromHistory: (sql: string) => void;
  dbType?: DbType;
  readOnly?: boolean;
  isRunning?: boolean;
  onCancel?: () => void;
}

export function QueryToolbar({
  onRun,
  onFormat,
  connectionId,
  onRestore,
  onRunFromHistory,
  dbType,
  readOnly = false,
  isRunning: isRunningProp,
  onCancel,
}: QueryToolbarProps) {
  const tabs = useDbViewerStore((s) => s.tabs);
  const activeTabId = useDbViewerStore((s) => s.activeTabId);
  const isRunning =
    isRunningProp ?? tabs.find((t) => t.id === activeTabId)?.loading ?? false;
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const currentQueryText = activeTab?.query ?? "";

  const shortcut = queryShortcut(
    typeof navigator !== "undefined" ? navigator.platform : "",
  );

  return (
    <div className="relative flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
      {/* run pulse: mirrors the table toolbar refresh pulse, absolutely positioned so it never shifts layout */}
      {isRunning && (
        <div
          data-testid="query-run-pulse"
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none animate-toolbar-pulse bg-accent"
        />
      )}
      <div
        className="flex items-center gap-1"
        aria-label="Query toolbar actions"
      >
        {/* Run Query: outline play that fills on hover; tooltip (delayed) reveals the shortcut */}
        <Tooltip
          content={
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px] leading-none">
                {shortcut.mod}
              </kbd>
              <span className="text-text-muted">+</span>
              <kbd className="rounded border border-border bg-surface px-1 font-mono text-[10px] leading-none">
                {shortcut.enter}
              </kbd>
            </span>
          }
          side="bottom"
        >
          <button
            type="button"
            onClick={onRun}
            disabled={readOnly}
            className="group flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-medium text-white transition-colors hover:bg-accent-hover cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Run query"
          >
            <Play className="h-3.5 w-3.5 transition-[fill] duration-150 group-hover:fill-current" />
            <span>Run Query</span>
          </button>
        </Tooltip>

        {/* Cancel Query */}
        {isRunning && onCancel && (
          <Tooltip content="Cancel running query" side="bottom">
            <button
              type="button"
              onClick={onCancel}
              className="flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/10 px-2.5 py-1 font-medium text-red-400 transition-colors hover:bg-red-500/20 cursor-pointer"
              aria-label="Cancel query"
            >
              <Square className="h-3 w-3 fill-current" />
              <span>Cancel</span>
            </button>
          </Tooltip>
        )}

        {/* History dropdown */}
        <QueryHistoryDropdown
          connectionId={connectionId}
          onRestore={onRestore}
          onRun={onRunFromHistory}
        />

        {/* Auto format: icon only with tooltip */}
        <Tooltip content="Auto format query" side="bottom">
          <button
            type="button"
            onClick={onFormat}
            disabled={readOnly}
            className="flex items-center rounded px-2 py-1.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Auto format query"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        {/* Save Query icon */}
        <Tooltip content="Save query" side="bottom">
          <button
            type="button"
            aria-label="Save query"
            onClick={() => {
              if (currentQueryText.trim()) {
                setSaveDialogOpen(true);
              }
            }}
            disabled={readOnly || !currentQueryText.trim()}
            className="flex items-center rounded px-2 py-1.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {dbType && (
        <div className="ml-auto">
          <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            {DB_TYPE_LABELS[dbType]}
          </span>
        </div>
      )}

      <SaveQueryDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        connectionId={connectionId}
        queryText={currentQueryText}
      />
    </div>
  );
}