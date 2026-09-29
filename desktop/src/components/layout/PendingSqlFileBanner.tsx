import { FileCode2, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

/**
 * Shown when a `.sql` file was opened from the OS but no database connection is
 * active. The file is already loaded in memory; picking a connection in the
 * Home screen delivers it (see `useSqlFileOpen`).
 */
export function PendingSqlFileBanner() {
  const pending = useUiStore((s) => s.pendingSqlFile);
  const clear = useUiStore((s) => s.clearPendingSqlFile);
  if (!pending) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-border bg-surface-raised px-3 py-1.5 text-xs text-text-muted"
    >
      <FileCode2 className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="truncate">
        <span className="font-medium text-text">{pending.name}</span> is ready — open a connection
        to use it.
      </span>
      <button
        type="button"
        onClick={clear}
        aria-label="Dismiss pending SQL file"
        className="ml-auto flex items-center rounded px-1 py-0.5 hover:bg-surface hover:text-text transition-colors cursor-pointer"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
