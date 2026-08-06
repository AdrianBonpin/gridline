import { useCallback, useEffect, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as cmd from "../../lib/commands";
import { buildChangePayload, buildChangeSql } from "../../lib/changePayload";
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
    case "rebuild_table":
      return change.description ?? `Rebuild ${fullName}`;
    case "ddl":
      return change.description ?? "DDL";
    default:
      return change.table ?? "-";
  }
}

/** Render the old → new value change for update queue items. */
function formatValueDiff(change: QueueItem): string | null {
  if (change.type !== "update" || !change.newData) return null;
  const colName = Object.keys(change.newData)[0];
  if (!colName) return null;
  const oldVal =
    change.oldData && change.oldData[colName] !== undefined
      ? String(change.oldData[colName])
      : "NULL";
  const newVal =
    change.newData[colName] === null || change.newData[colName] === undefined
      ? "NULL"
      : String(change.newData[colName]);
  return `${colName}: ${oldVal} → ${newVal}`;
}

function capitalizeType(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Badge label for a queue-item type — ddl/rebuild render uppercase. */
function badgeLabel(type: string): string {
  if (type === "ddl") return "DDL";
  if (type === "rebuild_table") return "REBUILD";
  return capitalizeType(type);
}

function tableRef(change: QueueItem): string {
  if (change.schema && change.table) return `${change.schema}.${change.table}`;
  return change.table ?? "-";
}

export function ChangesQueuePanel({ onCommitted }: { onCommitted?: () => void } = {}) {
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const removeChange = useDbViewerStore((state) => state.removeChange);
  const clearChanges = useDbViewerStore((state) => state.clearChanges);
  const markChangeCommitted = useDbViewerStore((state) => state.markChangeCommitted);
  const markChangeFailed = useDbViewerStore((state) => state.markChangeFailed);
  const notify = useNotificationStore((state) => state.notify);

  const [view, setView] = useState<"visual" | "sql">("visual");

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
    let treeDirty = false;

    for (const change of pending) {
      try {
        const payload = buildChangePayload(change);
        await cmd.executeChange(connectionId, payload);
        markChangeCommitted(change.id);
        committedCount++;
        if (change.type === "drop_table") {
          treeDirty = true;
          const st = useDbViewerStore.getState();
          st.closeTabsForTable(change.schema ?? "", change.table ?? "");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markChangeFailed(change.id, msg);
        notify(`Change failed: ${msg}`, "error");
        break;
      }
    }

    if (committedCount > 0) {
      onCommitted?.();
      notify(`${committedCount} change(s) committed`, "success");
    }

    if (treeDirty) {
      const st = useDbViewerStore.getState();
      void st.refreshTree(connectionId, st.currentSchema ?? undefined);
    }
  }, [markChangeCommitted, markChangeFailed, notify]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleCommitAll();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleCommitAll]);

  if (changesQueue.length === 0) {
    return null;
  }

  const pendingCount = changesQueue.filter((c) => c.status === "pending").length;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-medium text-sm text-text">Pending Changes</span>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            type="button"
            aria-label="Visual"
            onClick={() => setView("visual")}
            className={[
              "px-2 py-0.5 text-xs transition-colors",
              view === "visual"
                ? "bg-surface-raised text-text"
                : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            Visual
          </button>
          <button
            type="button"
            aria-label="SQL"
            onClick={() => setView("sql")}
            className={[
              "px-2 py-0.5 text-xs transition-colors",
              view === "sql"
                ? "bg-surface-raised text-text"
                : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            SQL
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto px-2 py-2 space-y-2">
        {view === "visual" ? (
          changesQueue.map((change) => (
            <div
              key={change.id}
              className={`rounded-lg border border-border bg-surface-raised/40 px-3 py-2 ${statusBg[change.status]}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={[
                      "rounded px-1.5 py-0.5 text-xs font-medium",
                      change.type === "rebuild_table"
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-surface-raised text-text-muted",
                    ].join(" ")}
                  >
                    {badgeLabel(change.type)}
                  </span>
                  <span className="text-sm text-text truncate">
                    {tableRef(change)}
                  </span>
                </div>
                {change.status === "pending" ? (
                  <button
                    type="button"
                    aria-label="Revert change"
                    title="Revert change"
                    onClick={() => removeChange(change.id)}
                    className="rounded p-1 text-text-muted hover:bg-red-500/10 hover:text-red-500 cursor-pointer shrink-0"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                ) : change.status === "committed" ? (
                  <span title="Committed" className="shrink-0 text-green-500">
                    <Check className="h-4 w-4" />
                  </span>
                ) : change.status === "failed" ? (
                  <span title="Failed" className="shrink-0 text-red-500">
                    <X className="h-4 w-4" />
                  </span>
                ) : null}
              </div>
              {change.type === "rebuild_table" ? (
                <>
                  <div className="mt-1 text-xs text-text-muted truncate">
                    {formatChangeLabel(change)}
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-canvas border border-border p-2 text-xs text-text-muted font-mono">
                    {buildChangeSql(change)}
                  </pre>
                </>
              ) : (
                <>
                  <div className="mt-1 text-xs text-text-muted truncate">
                    {formatChangeLabel(change)}
                  </div>
                  {formatValueDiff(change) && (
                    <div className="mt-0.5 font-mono text-xs text-text">
                      <span className="text-text-muted line-through">
                        {formatValueDiff(change)!.split(" → ")[0]}
                      </span>
                      <span className="mx-1 text-text-muted">→</span>
                      <span className="text-accent">
                        {formatValueDiff(change)!.split(" → ")[1]}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        ) : (
          changesQueue.map((change) => (
            <pre
              key={change.id}
              className="text-xs text-text-muted whitespace-pre-wrap rounded-md bg-canvas px-3 py-2 font-mono border border-border"
            >
              {buildChangeSql(change)}
            </pre>
          ))
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <button
          type="button"
          onClick={clearChanges}
          className="text-xs text-text-muted hover:text-text hover:bg-surface-raised rounded-md px-2 py-1 transition-colors cursor-pointer"
        >
          Clear All
        </button>
        <button
          type="button"
          disabled={pendingCount === 0}
          onClick={handleCommitAll}
          className="inline-flex items-center rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Commit All ({pendingCount})
          <kbd className="ml-1.5 rounded bg-surface-raised px-1 text-[10px]">⌘S</kbd>
        </button>
      </div>
    </div>
  );
}