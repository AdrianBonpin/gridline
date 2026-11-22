import { open, save } from "@tauri-apps/plugin-dialog";
import { INPUT_ROUNDING } from "../../lib/uiConstants";
import { createSqliteDatabase } from "../../lib/commands";
import { useNotificationStore } from "../../stores/notificationStore";

interface SqlitePathInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function SqlitePathInput({ value, onChange }: SqlitePathInputProps) {
  const notify = useNotificationStore((s) => s.notify);

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
  const handleCreate = async () => {
    let path: string | null = null;
    try {
      path = (await save({
        defaultPath: value || undefined,
        filters: [{ name: "SQLite database", extensions: ["sqlite", "sqlite3", "db"] }],
      })) as string | null;
    } catch {
      return; // dialog unavailable — nothing was selected, nothing to create
    }
    if (!path) return;
    try {
      await createSqliteDatabase(path);
      onChange(path);
      notify(`Created SQLite database at ${path}`, "success");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      notify(`Failed to create database: ${message}`, "error");
    }
  };

  return (
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
        aria-label="Create database"
        title="Testing never creates a database — create a new file explicitly here"
        className={`shrink-0 ${INPUT_ROUNDING} bg-surface-raised border border-border px-3 py-2 text-sm text-text hover:border-accent/50 cursor-pointer transition-colors`}
      >
        Create…
      </button>
    </div>
  );
}
