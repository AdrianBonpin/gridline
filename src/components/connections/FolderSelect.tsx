import { ChevronDown } from "lucide-react";
import type { Folder } from "../../lib/types";
import { getFolderPathLabel } from "../../lib/utils";

interface FolderSelectProps {
  folders: Folder[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export function FolderSelect({ folders, value, onChange }: FolderSelectProps) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className="w-full appearance-none rounded-full bg-surface border border-border px-4 py-2 pr-10 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
      >
        <option value="">Root</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {getFolderPathLabel(folders, folder.id)}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
    </div>
  );
}