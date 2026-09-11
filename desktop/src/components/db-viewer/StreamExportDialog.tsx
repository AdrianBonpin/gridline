import { useState, useEffect, useRef } from "react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { exportQueryToFile, cancelQuery } from "../../lib/commands";

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

  const handleChooseFile = async () => {
    const ext = EXTENSIONS[format] ?? "csv";
    const picked = await save({
      defaultPath: `export.${ext}`,
      filters: [{ name: format.toUpperCase(), extensions: [ext] }],
    });
    if (picked) setPath(picked);
  };

  const handleExport = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    setProgress(0);
    try {
      let target = path;
      if (!target) {
        const ext = EXTENSIONS[format] ?? "csv";
        target = (await save({
          defaultPath: `export.${ext}`,
          filters: [{ name: format.toUpperCase(), extensions: [ext] }],
        })) ?? "";
        if (!target) {
          setRunning(false);
          return;
        }
        setPath(target);
      }
      jobIdRef.current = `export-${Date.now()}`;
      const res = await exportQueryToFile(connectionId, sql, format, target);
      setDone(true);
      setProgress(100);
      setRowsWritten(res.rows_written);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
