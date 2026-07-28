import { useState, useEffect, useCallback } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { detectPgTools, pgDump } from "../../lib/commands";
import type { PgToolStatus } from "../../lib/types";

interface BackupDialogProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
}

type BackupFormat = "plain" | "custom" | "tar" | "directory";

const FORMAT_OPTIONS = [
  { value: "plain", label: "Plain SQL" },
  { value: "custom", label: "Custom Archive" },
  { value: "tar", label: "Tarball" },
  { value: "directory", label: "Directory" },
];

const PLATFORM_INSTALL_INSTRUCTIONS: Record<string, string> = {
  darwin: "brew install libpq",
  linux: "sudo apt install postgresql-client  # Debian/Ubuntu\nsudo dnf install postgresql  # Fedora\nsudo pacman -S postgresql  # Arch",
  win32: "Download PostgreSQL installer from https://www.postgresql.org/download/windows/ and ensure pg_dump is in your PATH.",
};

function getPlatformInstructions(): string {
  const platform = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (platform.includes("mac") || platform.includes("darwin")) return PLATFORM_INSTALL_INSTRUCTIONS.darwin;
  if (platform.includes("linux")) return PLATFORM_INSTALL_INSTRUCTIONS.linux;
  if (platform.includes("win")) return PLATFORM_INSTALL_INSTRUCTIONS.win32;
  return PLATFORM_INSTALL_INSTRUCTIONS.linux;
}

export function BackupDialog({ open, connectionId, onClose }: BackupDialogProps) {
  const [format, setFormat] = useState<BackupFormat>("custom");
  const [filePath, setFilePath] = useState("");
  const [schema, setSchema] = useState("");
  const [noOwner, setNoOwner] = useState(true);
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
    detectPgTools()
      .then((status) => setToolStatus(status))
      .catch(() => setToolStatus({ pg_dump_found: false, pg_restore_found: false, pg_dump_version: null, pg_restore_version: null }))
      .finally(() => setCheckingTools(false));
  }, [open]);

  const handlePickFile = useCallback(async () => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const extensions: Record<BackupFormat, string[]> = {
        plain: ["sql"],
        custom: ["dump", "custom"],
        tar: ["tar"],
        directory: [],
      };
      const picked = await save({
        defaultPath: `backup.${format === "custom" ? "dump" : format === "plain" ? "sql" : "tar"}`,
        filters: [{ name: "Backup", extensions: extensions[format] }],
      });
      if (picked) setFilePath(picked);
    } catch {
      // dialog not available (non-Tauri env), use manual path input
    }
  }, [format]);

  const handleStartBackup = useCallback(async () => {
    if (!filePath) {
      notify("Please select a file path", "error");
      return;
    }
    setRunning(true);
    const jobId = `dump-${Date.now()}`;
    startJob(jobId, "dump");
    try {
      await pgDump(connectionId, {
        format,
        filePath,
        schema: schema || undefined,
        tables: undefined,
        noOwner,
      });
      notify("Backup completed successfully", "success");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(`Backup failed: ${parseError(msg)}`, "error");
    } finally {
      setRunning(false);
    }
  }, [filePath, format, schema, noOwner, connectionId, startJob, notify, onClose]);

  const toolsMissing = toolStatus && !toolStatus.pg_dump_found;

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-full min-w-md max-w-lg max-h-[80vh] overflow-y-auto">
        <h3 className="font-heading text-text text-lg mb-4">Backup Database</h3>

        {checkingTools && (
          <p className="text-sm text-text-muted mb-4">Checking for pg_dump...</p>
        )}

        {toolsMissing && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-md px-4 py-3 mb-4 space-y-2">
            <p className="text-amber-300 text-sm font-medium">pg_dump not found</p>
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
            {/* Format selector */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Format</label>
              <Select
                value={format}
                onChange={(v) => setFormat(v as BackupFormat)}
                options={FORMAT_OPTIONS}
              />
            </div>

            {/* File path */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Output File</label>
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

            {/* No owner toggle */}
            <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={noOwner}
                onChange={(e) => setNoOwner(e.target.checked)}
                className="rounded bg-surface border-border accent-accent"
              />
              No Owner (--no-owner flag)
            </label>

            {/* Progress */}
            {activeJob?.status === "running" && (
              <BackupProgress
                progress={50}
                jobType="dump"
                status="running"
              />
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose} disabled={running}>
                Cancel
              </Button>
              <Button onClick={handleStartBackup} disabled={running || !filePath}>
                {running ? "Backing up..." : "Start Backup"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </AnimatedModal>
  );
}

function parseError(msg: string): string {
  if (msg.includes("pg_dump:")) {
    const [, ...rest] = msg.split("pg_dump:");
    return rest.join(":").trim() || msg;
  }
  if (msg.includes("No such file or directory")) {
    return `File not found. Check the output path and try again.`;
  }
  if (msg.includes("Permission denied")) {
    return `Permission denied. Check file permissions for the output path.`;
  }
  return msg;
}