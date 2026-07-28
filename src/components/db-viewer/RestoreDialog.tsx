import { useState, useEffect, useCallback } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { detectPgTools, pgRestore } from "../../lib/commands";
import type { PgToolStatus } from "../../lib/types";

interface RestoreDialogProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
}

const PLATFORM_INSTALL_INSTRUCTIONS: Record<string, string> = {
  darwin: "brew install libpq",
  linux: "sudo apt install postgresql-client  # Debian/Ubuntu\nsudo dnf install postgresql  # Fedora\nsudo pacman -S postgresql  # Arch",
  win32: "Download PostgreSQL installer from https://www.postgresql.org/download/windows/ and ensure pg_restore is in your PATH.",
};

function getPlatformInstructions(): string {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (platform.includes("mac") || platform.includes("darwin")) return PLATFORM_INSTALL_INSTRUCTIONS.darwin;
  if (platform.includes("linux")) return PLATFORM_INSTALL_INSTRUCTIONS.linux;
  if (platform.includes("win")) return PLATFORM_INSTALL_INSTRUCTIONS.win32;
  return PLATFORM_INSTALL_INSTRUCTIONS.linux;
}

export function RestoreDialog({ open, connectionId, onClose }: RestoreDialogProps) {
  const [filePath, setFilePath] = useState("");
  const [format, setFormat] = useState("custom");
  const [clean, setClean] = useState(true);
  const [schema, setSchema] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [toolStatus, setToolStatus] = useState<PgToolStatus | null>(null);
  const [checkingTools, setCheckingTools] = useState(false);
  const [running, setRunning] = useState(false);

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
      .catch(() => setToolStatus({ pg_dump_found: false, pg_restore_found: false, pg_dump_version: null, pg_restore_version: null }))
      .finally(() => setCheckingTools(false));
  }, [open]);

  const handlePickFile = useCallback(async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Backup Files", extensions: ["dump", "sql", "tar", "custom", "gz"] }],
      });
      if (picked && typeof picked === "string") setFilePath(picked);
    } catch {
      // dialog not available (non-Tauri env), use manual path input
    }
  }, []);

  const handleStartRestore = useCallback(async () => {
    if (!filePath) {
      notify("Please select a file path", "error");
      return;
    }
    setRunning(true);
    const jobId = `restore-${Date.now()}`;
    startJob(jobId, "restore");
    try {
      await pgRestore(connectionId, {
        format,
        filePath,
        clean,
        schema: schema || undefined,
      });
      notify("Restore completed successfully", "success");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(`Restore failed: ${parseError(msg)}`, "error");
    } finally {
      setRunning(false);
    }
  }, [filePath, format, clean, schema, connectionId, startJob, notify, onClose]);

  const toolsMissing = toolStatus && !toolStatus.pg_restore_found;
  const canStart = filePath && confirmed && !running;

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-full min-w-md max-w-lg max-h-[80vh] overflow-y-auto">
        <h3 className="font-heading text-text text-lg mb-4">Restore Database</h3>

        {checkingTools && (
          <p className="text-sm text-text-muted mb-4">Checking for pg_restore...</p>
        )}

        {toolsMissing && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 mb-4 space-y-2">
            <p className="text-amber-300 text-sm font-medium">pg_restore not found</p>
            <p className="text-amber-200/80 text-xs">
              The PostgreSQL client tools are required for backup/restore operations. Install them using:
            </p>
            <pre className="text-xs text-amber-100 bg-amber-500/10 rounded p-2 whitespace-pre-wrap">
              {getPlatformInstructions()}
            </pre>
          </div>
        )}

        {!checkingTools && !toolsMissing && (
          <div className="space-y-4">
            {/* File path */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Backup File</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="/path/to/backup.dump"
                  className="flex-1 rounded-full bg-surface border border-border px-4 py-2 text-sm text-text placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors"
                />
                <Button variant="secondary" onClick={handlePickFile}>
                  Browse
                </Button>
              </div>
            </div>

            {/* Format */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="rounded-lg bg-surface border border-border px-3 py-2 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
              >
                <option value="custom">Custom Archive</option>
                <option value="plain">Plain SQL</option>
                <option value="tar">Tarball</option>
                <option value="directory">Directory</option>
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

            {/* Clean toggle */}
            <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={clean}
                onChange={(e) => setClean(e.target.checked)}
                className="rounded bg-surface border-border accent-accent"
              />
              Clean (DROP before CREATE)
            </label>

            {/* Destructive confirmation */}
            <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 rounded bg-surface border-border accent-red-500"
                  data-testid="restore-confirm-checkbox"
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
                jobType="restore"
                status="running"
              />
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button onClick={handleStartRestore} disabled={!canStart}>
                {running ? "Restoring..." : "Start Restore"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}

function parseError(msg: string): string {
  if (msg.includes("pg_restore:")) {
    const [, ...rest] = msg.split("pg_restore:");
    return rest.join(":").trim() || msg;
  }
  if (msg.includes("No such file or directory")) {
    return `File not found. Check the path and try again.`;
  }
  if (msg.includes("Permission denied")) {
    return `Permission denied. Check file permissions.`;
  }
  return msg;
}