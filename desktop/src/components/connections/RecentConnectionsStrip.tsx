import { DbIcon } from "../../lib/dbIcons";
import type { Connection } from "../../lib/types";

interface RecentConnectionsStripProps {
  recents: Connection[];
  onOpen: (id: string) => void;
}

export function RecentConnectionsStrip({
  recents,
  onOpen,
}: RecentConnectionsStripProps) {
  if (recents.length === 0) return null;

  const visible = recents.slice(0, 8);

  return (
    <div className="mb-4">
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
        Recent
      </h3>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {visible.map((connection) => (
          <button
            key={connection.id}
            type="button"
            onClick={() => onOpen(connection.id)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border hover:border-border-hover text-sm text-text transition-colors cursor-pointer whitespace-nowrap"
          >
            <DbIcon type={connection.db_type} size={14} />
            <span className="truncate max-w-[180px]">{connection.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}