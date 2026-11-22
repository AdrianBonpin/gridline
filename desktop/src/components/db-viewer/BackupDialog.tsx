import { useState, useEffect, useCallback } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { CopyButton } from "../ui/CopyButton";
import { Select } from "../ui/Select";
import { BackupProgress } from "./BackupProgress";
import { useBackupStore } from "../../stores/backupStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { detectPgTools, pgDump, selectFileForGrant } from "../../lib/commands";
import type { FileGrant } from "../../lib/fileGrant";
import { fileGrantErrorMessage } from "../../lib/fileGrant";
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
  // The File Grant authorizes the write; `selectedPath` is display only.
  const [grant, setGrant] = useState<FileGrant | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
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
      .catch(() => setToolStatus({ pg_dump_found: false, pg_restore_found: false, pg_dump_version: null, pg_restore_version: null, pg_dump_source: null, pg_restore_source: null }))
      .finally(() => setCheckingTools(false));
  }, [open]);

  // Rust brokers the dialog and issues the File Grant for the chosen path.
  const handlePickFile = useCallback(async () => {
    const extensions: Record<BackupFormat, string[]> = {
      plain: ["sql"],
      custom: ["dump", "custom"],
      tar: ["tar"],
      directory: [],
    };
    try {
      const picked = await selectFileForGrant({
        intent: "write",
        title: "Save backup as",
        defaultName: `backup.${format === "custom" ? "dump" : format === "plain" ? "sql" : "tar"}`,
        filters: [{ name: "Backup", extensions: extensions[format] }],
      });
      if (!picked) return;
      setGrant(picked);
      setSelectedPath(picked.path);
    } catch (e) {
      notify(fileGrantErrorMessage(e) ?? String(e), "error");
    }
  }, [format, notify]);

  const handleStartBackup = useCallback(async () => {
    if (!grant) {
      notify("Please select an output file", "error");
      return;
    }
    const grantId = grant.id;
    // Single use: this selection is spent by the attempt.
    setGrant(null);
    setRunning(true);
    const jobId = `dump-${Date.now()}`;
    startJob(jobId, "dump");
    try {
      await pgDump(
        connectionId,
        {
          format,
          schema: schema || undefined,
          tables: undefined,
          noOwner,
        },
        grantId,
      );
      notify("Backup completed successfully", "success");
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      notify(`Backup failed: ${parseError(msg)}`, "error");
    } finally {
      setRunning(false);
    }
  }, [grant, format, schema, noOwner, connectionId, startJob, notify, onClose]);

  const toolsMissing = toolStatus && !toolStatus.pg_dump_found;
  const installInstructions = getPlatformInstructions();

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
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-amber-200/60">Install</span>
                <CopyButton
                  text={installInstructions}
                  className="text-amber-200/70 hover:text-amber-100"
                />
              </div>
              <pre className="text-xs text-amber-100 bg-amber-500/10 rounded p-2 whitespace-pre-wrap">
                {installInstructions}
              </pre>
            </div>
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
                  value={selectedPath}
                  readOnly
                  aria-label="Output file"
                  placeholder="Choose an output file…"
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
              <Button onClick={handleStartBackup} disabled={running || !grant}>
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