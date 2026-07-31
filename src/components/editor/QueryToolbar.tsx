import { Play, Wand2 } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import type { DbType } from "../../lib/types";

const DB_TYPE_LABELS: Record<DbType, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  redis: "Redis",
};

interface QueryToolbarProps {
  onRun: () => void;
  onFormat: () => void;
  dbType?: DbType;
  readOnly?: boolean;
}

export function QueryToolbar({
  onRun,
  onFormat,
  dbType,
  readOnly = false,
}: QueryToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
      <div className="flex items-center gap-1">
        {/* Run Query: outline play that fills on hover; tooltip (delayed) reveals the shortcut */}
        <Tooltip content="Run query — Cmd/Ctrl+Enter" side="bottom">
          <button
            type="button"
            onClick={onRun}
            disabled={readOnly}
            className="group flex items-center gap-1.5 rounded px-2 py-0.5 font-medium text-text hover:bg-surface-raised transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Run query"
          >
            <Play className="h-3.5 w-3.5 transition-[fill] duration-150 group-hover:fill-current" />
            <span>Run Query</span>
          </button>
        </Tooltip>

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
      </div>

      {dbType && (
        <div className="ml-auto">
          <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-muted">
            {DB_TYPE_LABELS[dbType]}
          </span>
        </div>
      )}
    </div>
  );
}