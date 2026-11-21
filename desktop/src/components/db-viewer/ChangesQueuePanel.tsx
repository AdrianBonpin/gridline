import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X, RotateCcw } from "lucide-react";
import { useDbViewerStore, currentChangeOrigin } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { useActiveChangeOrigin } from "../../hooks/useActiveChangeOrigin";
import * as cmd from "../../lib/commands";
import { buildChangePayload, buildChangeSql } from "../../lib/changePayload";
import { isSchemaModifyingQuery } from "../../lib/utils";
import {
  describeChangeOrigin,
  describeRetargeting,
  isSameChangeOrigin,
  itemsForChangeTarget,
  type ChangeOrigin,
} from "../../lib/changeOrigin";
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

/** How a change is named in a commit report: its description, else its shape. */
function describeChange(change: QueueItem): string {
  const description = change.description?.trim();
  return description && description.length > 0
    ? description
    : formatChangeLabel(change);
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

export function ChangesQueuePanel({
  onCommitted,
}: {
  /**
   * Called with exactly the changes this commit cycle applied and the origin
   * they belong to, so the viewer can refresh every affected tab.
   */
  onCommitted?: (
    committed: QueueItem[],
    origin: ChangeOrigin,
  ) => void | Promise<void>;
} = {}) {
  const changesQueue = useDbViewerStore((state) => state.changesQueue);
  const removeChange = useDbViewerStore((state) => state.removeChange);
  const clearChangesForTarget = useDbViewerStore((state) => state.clearChangesForTarget);
  const markChangeCommitted = useDbViewerStore((state) => state.markChangeCommitted);
  const markChangeFailed = useDbViewerStore((state) => state.markChangeFailed);
  const notify = useNotificationStore((state) => state.notify);
  const activeOrigin = useActiveChangeOrigin();

  const [view, setView] = useState<"visual" | "sql">("visual");
  // Why the last Commit All was refused. Visible, specific, and cleared as soon
  // as the origin changes.
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    setRefusal(null);
  }, [activeOrigin?.connectionId, activeOrigin?.database, activeOrigin?.target]);

  // Only the active Change Origin's work is exposed here; another connection,
  // database, or target never shows — let alone commits — this queue.
  const queue = useMemo(
    () => itemsForChangeTarget(changesQueue, activeOrigin),
    [changesQueue, activeOrigin],
  );

  const handleCommitAll = useCallback(async () => {
    // Resolve the origin at commit time instead of trusting the active
    // connection id alone: the saved connection may have been retargeted
    // (host/database/TLS changed) since this work was staged.
    const origin = currentChangeOrigin();
    if (!origin) {
      const message =
        "Cannot commit: no active saved connection, so this pending work has no Change Origin to apply to. Open the connection it was staged on.";
      setRefusal(message);
      notify(message, "error");
      return;
    }

    const pending = itemsForChangeTarget(
      useDbViewerStore.getState().changesQueue,
      origin,
    ).filter((c) => c.status === "pending");
    if (pending.length === 0) return;

    // Refuse the whole batch when any of it was staged against a target this
    // connection no longer points at — a reused connection id must never
    // redirect staged writes somewhere else.
    const stale = pending.filter((c) => !isSameChangeOrigin(c.origin, origin));
    if (stale.length > 0) {
      const first = stale[0];
      const message = first.origin
        ? describeRetargeting(first.origin, origin)
        : `Cannot commit "${describeChange(first)}": it was staged without a Change Origin, so it cannot be proven to belong to ${describeChangeOrigin(origin)}. Revert it and stage the change again.`;
      setRefusal(message);
      notify(message, "error");
      return;
    }
    setRefusal(null);

    const total = pending.length;
    const committedItems: QueueItem[] = [];
    let committedCount = 0;
    let failedChange: QueueItem | null = null;
    let failedMessage = "";
    let treeDirty = false;

    // Sequential, per-change atomicity: stop at the first failure and keep
    // every earlier success durable. There is no whole-queue rollback.
    for (const change of pending) {
      try {
        const payload = buildChangePayload(change);
        await cmd.executeChange(origin.connectionId, payload);
        markChangeCommitted(change.id);
        committedItems.push(change);
        committedCount++;
        if (change.type === "drop_table") {
          treeDirty = true;
          const st = useDbViewerStore.getState();
          // Only the committing origin's tabs close: another database's tab for
          // the same table name is a different object.
          st.closeTabsForTable(change.schema ?? "", change.table ?? "", origin);
        } else if (
          change.type === "rebuild_table" ||
          (change.type === "ddl" && change.sql && isSchemaModifyingQuery(change.sql))
        ) {
          treeDirty = true;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        markChangeFailed(change.id, msg);
        failedChange = change;
        failedMessage = msg;
        break;
      }
    }

    if (treeDirty) {
      // Columns may be gone/renamed; caches must re-introspect.
      useDbViewerStore.getState().invalidateMetadata();
    }

    if (failedChange) {
      // Honest partial-success report: what is durable, what failed, and what
      // was never attempted. There is no whole-queue rollback to promise.
      const remaining = total - committedCount - 1;
      const remainingPart =
        remaining > 0
          ? ` ${remaining} remaining change(s) were not applied.`
          : "";
      const keptPart =
        committedCount > 0 ? " Changes already committed are kept." : "";
      notify(
        `Commit All committed ${committedCount} of ${total} change(s). ` +
          `"${describeChange(failedChange)}" failed: ${failedMessage}.` +
          remainingPart +
          keptPart,
        "error",
      );
    } else if (committedCount > 0) {
      notify(`${committedCount} change(s) committed`, "success");
    }

    // Refresh every affected tab *after* reporting the commit outcome, so a slow
    // refresh can never delay (or hide) the result of the commit itself.
    if (committedCount > 0) {
      await onCommitted?.(committedItems, origin);
    }

    if (treeDirty) {
      const st = useDbViewerStore.getState();
      void st.refreshTree(origin.connectionId, st.currentSchema ?? undefined);
    }
  }, [markChangeCommitted, markChangeFailed, notify, onCommitted]);

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

  if (queue.length === 0) {
    return null;
  }

  const pendingCount = queue.filter((c) => c.status === "pending").length;

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

      {refusal && (
        <div
          role="alert"
          data-testid="commit-refusal"
          className="border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500"
        >
          {refusal}
        </div>
      )}

      <div className="max-h-64 overflow-y-auto px-2 py-2 space-y-2">
        {view === "visual" ? (
          queue.map((change) => (
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
              {change.status === "failed" && change.error && (
                <div className="mt-1 text-xs text-red-500 break-words">
                  {change.error}
                </div>
              )}
            </div>
          ))
        ) : (
          queue.map((change) => (
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
          onClick={() => clearChangesForTarget(activeOrigin)}
          className="text-xs text-text-muted hover:text-text hover:bg-surface-raised rounded-md px-2 py-1 transition-colors cursor-pointer"
        >
          Clear All
        </button>
        <button
          type="button"
          disabled={pendingCount === 0}
          onClick={handleCommitAll}
          data-testid="commit-all"
          className="inline-flex items-center rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Commit All ({pendingCount})
          <kbd className="ml-1.5 rounded bg-surface-raised px-1 text-[10px]">⌘S</kbd>
        </button>
      </div>
    </div>
  );
}
