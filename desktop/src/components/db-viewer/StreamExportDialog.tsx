import { useState, useEffect, useRef } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { listen } from "@tauri-apps/api/event";
import { exportQueryToFile, cancelQuery, selectFileForGrant } from "../../lib/commands";
import type { FileFilter, FileGrant } from "../../lib/fileGrant";
import {
  FILE_GRANT_STATE,
  fileGrantErrorKind,
  fileGrantErrorMessage,
  type FileGrantErrorKind,
} from "../../lib/fileGrant";

interface StreamExportDialogProps {
  connectionId: string;
  sql: string;
  onClose: () => void;
}

const FORMAT_OPTIONS = [
  { value: "csv", label: "CSV" },
  { value: "jsonl", label: "JSON Lines" },
  { value: "json", label: "JSON" },
];

const EXTENSIONS: Record<string, string> = {
  csv: "csv",
  jsonl: "jsonl",
  json: "json",
};

export function StreamExportDialog({ connectionId, sql, onClose }: StreamExportDialogProps) {
  const [format, setFormat] = useState("csv");
  // The destination is authorized by a backend-issued File Grant; `path` is
  // display metadata only, and `grant.id` is what the export consumes.
  const [grant, setGrant] = useState<FileGrant | null>(null);
  const [grantError, setGrantError] = useState<FileGrantErrorKind | null>(null);
  const [path, setPath] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [rowsWritten, setRowsWritten] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);

  // Filter export-progress events to this job so concurrent exports don't
  // clobber each other's progress bar.
  useEffect(() => {
    const unlisten = listen<{ job_id: string; percent: number }>("export-progress", (e) => {
      if (e.payload.job_id === jobIdRef.current) {
        setProgress(e.payload.percent);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  /** Ask Rust for a native save dialog and adopt the grant it issues. */
  const chooseFile = async (): Promise<FileGrant | null> => {
    const ext = EXTENSIONS[format] ?? "csv";
    const filters: FileFilter[] = [{ name: format.toUpperCase(), extensions: [ext] }];
    try {
      const picked = await selectFileForGrant({
        intent: "write",
        title: "Export all rows as",
        defaultName: `export.${ext}`,
        filters,
      });
      if (!picked) return null; // cancelled: nothing to authorize
      setGrant(picked);
      setPath(picked.path);
      setGrantError(null);
      return picked;
    } catch (e) {
      const kind = fileGrantErrorKind(e);
      if (kind) setGrantError(kind);
      setError(fileGrantErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)));
      return null;
    }
  };

  const handleChooseFile = async () => {
    await chooseFile();
  };

  const handleExport = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    setProgress(0);
    try {
      // Choosing the destination is part of starting the export when nothing is
      // authorized yet, exactly as the previous flow opened the dialog here.
      const active = grant ?? (await chooseFile());
      if (!active) {
        setRunning(false);
        return;
      }
      // A grant is single-use: this selection is spent by the attempt.
      setGrant(null);

      jobIdRef.current = `export-${Date.now()}`;
      const res = await exportQueryToFile(connectionId, sql, format, active.id);
      setDone(true);
      setProgress(100);
      setRowsWritten(res.rows_written);
    } catch (e) {
      const kind = fileGrantErrorKind(e);
      if (kind) setGrantError(kind);
      setError(fileGrantErrorMessage(e) ?? (e instanceof Error ? e.message : String(e)));
    } finally {
      setRunning(false);
    }
  };

  const handleCancel = async () => {
    try {
      await cancelQuery(connectionId);
    } catch {
      // ignore — the export may already have finished
    }
    setRunning(false);
  };

  return (
    <AnimatedModal open onClose={onClose}>
      <div className="w-[420px] flex flex-col gap-4">
        <h2 className="text-base font-semibold text-text">Export all rows to file</h2>

        <div className="flex items-center gap-3">
          <Select
            label="Format"
            value={format}
            onChange={setFormat}
            options={FORMAT_OPTIONS}
            disabled={running}
          />
          <Button variant="secondary" onClick={handleChooseFile} disabled={running}>
            Choose file…
          </Button>
        </div>

        {grantError && (
          <div
            data-testid={`export-file-grant-${grantError}`}
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold text-amber-300">
                {FILE_GRANT_STATE[grantError].title}
              </p>
              <p className="text-[11px] leading-relaxed text-amber-200/80">
                {FILE_GRANT_STATE[grantError].detail}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleChooseFile()}
              className="shrink-0 rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer"
            >
              Choose file
            </button>
          </div>
        )}

        {path && (
          <p className="text-xs text-text-muted break-all" data-testid="export-path">
            {path}
          </p>
        )}

        {running && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 w-full rounded-full bg-surface-raised overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
            <span className="text-xs text-text-muted">{Math.round(progress)}%</span>
          </div>
        )}

        {done && rowsWritten !== null && (
          <p className="text-xs text-emerald-400" data-testid="export-done">
            {rowsWritten} rows written
          </p>
        )}

        {error && (
          <p className="text-xs text-red-400" data-testid="export-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {running && (
            <Button variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          )}
          <Button onClick={handleExport} disabled={running}>
            Export
          </Button>
        </div>
      </div>
    </AnimatedModal>
  );
}
