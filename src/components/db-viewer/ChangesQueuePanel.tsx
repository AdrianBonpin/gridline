import { useState } from "react";
import { X, Check, ChevronUp, ChevronDown } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { QueueItem, QueueStatus } from "../../stores/dbViewerStore";

const statusBg: Record<QueueStatus, string> = {
  pending: "bg-accent/5",
  committed: "bg-green-500/5",
  failed: "bg-red-500/5",
  cancelled: "bg-surface-raised/50",
};

function capitalizeType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function StatusIndicator({ status }: { status: QueueStatus }) {
  switch (status) {
    case "pending":
      return (
        <div className="flex items-center gap-1.5 text-amber-400">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span>Pending</span>
        </div>
      );
    case "committed":
      return (
        <div className="flex items-center gap-1.5 text-green-500">
          <Check className="h-4 w-4" />
          <span>Committed</span>
        </div>
      );
    case "failed":
      return (
        <div className="flex items-center gap-1.5 text-red-500">
          <X className="h-4 w-4" />
          <span>Failed</span>
        </div>
      );
    case "cancelled":
      return (
        <div className="flex items-center gap-1.5 text-text-muted">
          <span>Cancelled</span>
        </div>
      );
    default:
      return null;
  }
}

export function ChangesQueuePanel() {
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const cancelChange = useDbViewerStore((state) => state.cancelChange);
  const [expanded, setExpanded] = useState(true);

  if (changesQueue.length === 0) {
    return null;
  }

  const pendingCount = changesQueue.filter((c) => c.status === "pending").length;
  const processedCount = changesQueue.filter(
    (c) => c.status === "committed" || c.status === "failed",
  ).length;

  const changeWord = pendingCount === 1 ? "change" : "changes";

  return (
    <div className="border-t border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-text hover:bg-surface-raised/50"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronUp className="h-4 w-4 text-text-muted" />
          )}
          <span className="font-medium">
            Changes Queue ({pendingCount} pending {changeWord}, {processedCount}{" "}
            processed)
          </span>
          {pendingCount > 0 && (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs text-accent-muted">
              {pendingCount}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={pendingCount === 0}
          onClick={(e) => e.stopPropagation()}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Commit All
        </button>
      </button>

      {expanded && (
        <div className="max-h-48 overflow-y-auto">
          {changesQueue.map((change) => (
            <ChangeRow
              key={change.id}
              change={change}
              onCancel={() => cancelChange(change.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  onCancel,
}: {
  change: QueueItem;
  onCancel: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2 text-sm ${statusBg[change.status]}`}
    >
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-surface-raised px-2 py-0.5 text-xs font-medium text-text-muted">
          {capitalizeType(change.type)}
        </span>
        <span className="text-text">
          {change.table ? change.table : "-"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <StatusIndicator status={change.status} />
        {change.status === "pending" && (
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-500"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}