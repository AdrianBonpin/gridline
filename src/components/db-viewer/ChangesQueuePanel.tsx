import { useCallback } from "react";
import { X, Check, ChevronUp, ChevronDown } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as cmd from "../../lib/commands";
import { buildChangePayload } from "../../lib/changePayload";
import type { QueueItem, QueueStatus } from "../../stores/dbViewerStore";

const statusBg: Record<QueueStatus, string> = {
  pending: "bg-accent/5",
  committed: "bg-green-500/5",
  failed: "bg-red-500/5",
  cancelled: "bg-surface-raised/50",
};

function formatChangeLabel(change: QueueItem): string {
  const schema = change.schema ?? "";
  const table = change.table ?? "";
  const fullName = schema ? `${schema}.${table}` : table;
  switch (change.type) {
    case "bulk_insert":
      return change.description ?? `Import ${change.rows?.length ?? 0} rows into ${fullName}`;
    case "empty_table":
      return `Empty Table: ${fullName}`;
    case "drop_table":
      return `Drop Table: ${fullName}`;
    default:
      return change.table ?? "-";
  }
}

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
  const markChangeCommitted = useDbViewerStore((state) => state.markChangeCommitted);
  const markChangeFailed = useDbViewerStore((state) => state.markChangeFailed);
  const notify = useNotificationStore((state) => state.notify);
  const expanded = useDbViewerStore((state) => state.changesPanelExpanded);
  const toggleChangesPanel = useDbViewerStore(
    (state) => state.toggleChangesPanel,
  );

  const handleCommitAll = useCallback(async () => {
    const connectionId = useUiStore.getState().activeConnectionId;
    if (!connectionId) {
      notify("No active connection", "error");
      return;
    }

    const pending = useDbViewerStore.getState().changesQueue.filter(
      (c) => c.status === "pending",
    );
    if (pending.length === 0) return;

    let committedCount = 0;

    for (const change of pending) {
      try {
        const payload = buildChangePayload(change);
        await cmd.executeChange(connectionId, payload);
        markChangeCommitted(change.id);
        committedCount++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markChangeFailed(change.id, msg);
        notify(`Change failed: ${msg}`, "error");
        break;
      }
    }

    if (committedCount > 0) {
      notify(`${committedCount} change(s) committed`, "success");
    }
  }, [markChangeCommitted, markChangeFailed, notify]);

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
      <div
        role="button"
        tabIndex={0}
        aria-label="Toggle changes panel"
        onClick={() => toggleChangesPanel()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleChangesPanel(); }}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-text hover:bg-surface-raised/50 cursor-pointer"
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
          onClick={(e) => {
            e.stopPropagation();
            handleCommitAll();
          }}
          className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Commit All
        </button>
      </div>

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
          {formatChangeLabel(change)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <StatusIndicator status={change.status} />
        {change.status === "pending" && (
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-500 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}