import { open } from "@tauri-apps/plugin-dialog";
import { INPUT_ROUNDING } from "../../lib/uiConstants";

interface SqlitePathInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function SqlitePathInput({ value, onChange }: SqlitePathInputProps) {
  const handleBrowse = async () => {
    try {
      const path = await open({ multiple: false, directory: false });
      if (path) onChange(path as string);
    } catch {
      // dialog unavailable (e.g., web preview) — no-op; user can type the path
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
    </div>
  );
}