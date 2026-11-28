import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { INPUT_ROUNDING } from "../../lib/uiConstants";
import { createSqliteDatabase, selectFileForGrant } from "../../lib/commands";
import {
  FILE_GRANT_STATE,
  fileGrantErrorKind,
  fileGrantErrorMessage,
  type FileGrantErrorKind,
} from "../../lib/fileGrant";
import { useNotificationStore } from "../../stores/notificationStore";

interface SqlitePathInputProps {
  value: string;
  onChange: (value: string) => void;
}

const SQLITE_FILTERS = [
  { name: "SQLite database", extensions: ["sqlite", "sqlite3", "db", "db3"] },
];

/**
 * The file name the OS save dialog starts with. `PickRequest` carries a name,
 * not a directory, so only a value that already looks like a file name is
 * reused; anything else falls back to a plain default.
 */
function suggestedFileName(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  return base.includes(".") ? base : "gridline.db";
}

export function SqlitePathInput({ value, onChange }: SqlitePathInputProps) {
  const notify = useNotificationStore((s) => s.notify);
  const [grantError, setGrantError] = useState<FileGrantErrorKind | null>(null);
  const [creating, setCreating] = useState(false);

  // Choosing an *existing* database is still a plain path pick: opening one is
  // outside this change, which is about who may name a destination for a file
  // this process creates.
  const handleBrowse = async () => {
    try {
      const path = await open({ multiple: false, directory: false });
      if (path) onChange(path as string);
    } catch {
      // dialog unavailable (e.g., web preview) — no-op; user can type the path
    }
  };

  // Creating a database is a deliberate, separate action: testing a connection
  // never creates a file, so a new database has to be asked for explicitly.
  //
  // The destination comes from the operating system's save dialog, brokered by
  // Rust: the renderer asks for a **write** File Grant, receives display-only
  // metadata plus an opaque id, and hands only the id back. Nothing here can
  // name the file that gets created (`GLOSSARY.md` → File Grant).
  const handleCreate = async () => {
    setGrantError(null);
    setCreating(true);
    try {
      const picked = await selectFileForGrant({
        intent: "write",
        title: "Create SQLite database",
        defaultName: suggestedFileName(value),
        filters: SQLITE_FILTERS,
      });
      if (!picked) return; // cancelled: nothing was authorized, nothing to report
      const created = await createSqliteDatabase(picked.id);
      onChange(created);
      notify(`Created SQLite database at ${created}`, "success");
    } catch (e) {
      // A refusal or expiry is a selection problem, not a creation failure: the
      // grant is spent, so the recovery action is to pick the file again.
      const kind = fileGrantErrorKind(e);
      if (kind) {
        setGrantError(kind);
        return;
      }
      const message =
        fileGrantErrorMessage(e) ?? (e instanceof Error ? e.message : String(e));
      notify(`Failed to create database: ${message}`, "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="/path/to/database.sqlite"
          aria-label="File Path"
          className={`w-full ${INPUT_ROUNDING} bg-surface border border-border px-4 py-2 text-sm text-text font-mono placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors`}
        />
        <button
          type="button"
          onClick={handleBrowse}
          aria-label="Browse"
          className={`shrink-0 ${INPUT_ROUNDING} bg-surface-raised border border-border px-3 py-2 text-sm text-text hover:border-accent/50 cursor-pointer transition-colors`}
        >
          Browse…
        </button>
        <button
          type="button"
          onClick={() => {
            void handleCreate();
          }}
          disabled={creating}
          aria-label="Create database"
          title="Testing never creates a database — create a new file explicitly here"
          className={`shrink-0 ${INPUT_ROUNDING} bg-surface-raised border border-border px-3 py-2 text-sm text-text hover:border-accent/50 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-default`}
        >
          Create…
        </button>
      </div>
      {grantError && (
        <div
          role="alert"
          data-testid={`sqlite-create-grant-${grantError}`}
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
            onClick={() => {
              void handleCreate();
            }}
            className="shrink-0 rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/10 transition-colors cursor-pointer"
          >
            Choose file again
          </button>
        </div>
      )}
    </div>
  );
}
