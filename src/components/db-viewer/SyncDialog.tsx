import { useState, useEffect, useCallback } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { detectPgTools, dbSync } from "../../lib/commands";
import type { PgToolStatus } from "../../lib/types";

interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SyncDialog({ open, onClose }: SyncDialogProps) {
  const [sourceConnectionId, setSourceConnectionId] = useState("");
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [schema, setSchema] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [toolStatus, setToolStatus] = useState<PgToolStatus | null>(null);
  const [checkingTools, setCheckingTools] = useState(false);
  const [running, setRunning] = useState(false);

  const connections = useConnectionStore((s) => s.connections);
  const activeJobId = useBackupStore((s) => s.activeJobId);
  const jobs = useBackupStore((s) => s.jobs);
  const startJob = useBackupStore((s) => s.startJob);
  const notify = useNotificationStore((s) => s.notify);

  const activeJob = jobs.find((j) => j.id === activeJobId);

  useEffect(() => {
    if (!open) return;
    setCheckingTools(true);
    setConfirmed(false);
    detectPgTools()
      .then((status) => setToolStatus(status))
      .catch(() => setToolStatus({ pg_dump_found: false, pg_restore_found: false, pg_dump_version: null, pg_restore_version: null, pg_dump_source: null, pg_restore_source: null }))
      .finally(() => setCheckingTools(false));
  }, [open]);

  const handleStartSync = useCallback(async () => {
    if (!sourceConnectionId || !targetConnectionId) {
      notify("Please select both source and target connections", "error");
      return;
    }
    if (sourceConnectionId === targetConnectionId) {
      notify("Source and target must be different", "error");
      return;
    }
    setRunning(true);
    const jobId = `sync-${Date.now()}`;
    startJob(jobId, "sync");
    try {
      await dbSync({
        sourceConnectionId,
        targetConnectionId,
        schema: schema || undefined,
        tables: undefined,
      });
      notify("Sync completed successfully", "success");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(`Sync failed: ${parseError(msg)}`, "error");
    } finally {
      setRunning(false);
    }
  }, [sourceConnectionId, targetConnectionId, schema, startJob, notify, onClose]);

  const toolsMissing = toolStatus && (!toolStatus.pg_dump_found || !toolStatus.pg_restore_found);
  const canStart = sourceConnectionId && targetConnectionId && confirmed && !running;

  const postgresqlConnections = connections.filter((c) => c.db_type === "postgresql");

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-full min-w-md max-w-lg max-h-[80vh] overflow-y-auto">
        <h3 className="font-heading text-text text-lg mb-4">Sync Databases</h3>

        {checkingTools && (
          <p className="text-sm text-text-muted mb-4">Checking for pg_dump/pg_restore...</p>
        )}

        {toolsMissing && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 mb-4 space-y-2">
            <p className="text-amber-300 text-sm font-medium">PostgreSQL tools not found</p>
            <p className="text-amber-200/80 text-xs">
              Both pg_dump and pg_restore are required for database sync.
            </p>
            {!toolStatus?.pg_dump_found && (
              <p className="text-amber-200/80 text-xs">pg_dump is missing.</p>
            )}
            {!toolStatus?.pg_restore_found && (
              <p className="text-amber-200/80 text-xs">pg_restore is missing.</p>
            )}
          </div>
        )}

        {!checkingTools && !toolsMissing && (
          <div className="space-y-4">
            {/* Source connection */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Source Connection</label>
              <select
                value={sourceConnectionId}
                onChange={(e) => setSourceConnectionId(e.target.value)}
                className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
              >
                <option value="">Select source...</option>
                {postgresqlConnections.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.id === targetConnectionId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Target connection */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Target Connection</label>
              <select
                value={targetConnectionId}
                onChange={(e) => setTargetConnectionId(e.target.value)}
                className="w-full rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
              >
                <option value="">Select target...</option>
                {postgresqlConnections.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.id === sourceConnectionId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Schema filter */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Schema (optional)</label>
              <input
                type="text"
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                placeholder="public"
                className="w-full rounded-full bg-surface border border-border px-4 py-2 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors"
              />
            </div>

            {/* Destructive confirmation */}
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 rounded bg-surface border-border accent-red-500"
                  data-testid="sync-confirm-checkbox"
                />
                <span className="text-sm text-red-300">
                  I understand this will overwrite data on the target database. This action cannot be undone.
                </span>
              </label>
            </div>

            {/* Progress */}
            {activeJob?.status === "running" && (
              <BackupProgress
                progress={50}
                jobType="sync"
                status="running"
              />
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button onClick={handleStartSync} disabled={!canStart}>
                {running ? "Syncing..." : "Start Sync"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}

function parseError(msg: string): string {
  if (msg.includes("pg_dump:") || msg.includes("pg_restore:")) {
    const parts = msg.split(/pg_(dump|restore):/);
    return parts[parts.length - 1]?.trim() || msg;
  }
  if (msg.includes("No such file or directory")) {
    return `File not found. Check the output path and try again.`;
  }
  if (msg.includes("Permission denied")) {
    return `Permission denied. Check file permissions.`;
  }
  return msg;
}