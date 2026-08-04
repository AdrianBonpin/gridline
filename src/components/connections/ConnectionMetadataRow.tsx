import { useState } from "react";
import { Input } from "../ui/Input";
import { EnvironmentSelect } from "./EnvironmentSelect";
import { FolderSelect } from "./FolderSelect";
import { SearchableTagPicker } from "../tags/SearchableTagPicker";
import { Plus, Layers } from "lucide-react";
import type { ConnectionFormData } from "./connectionFormData";
import type { Folder, Tag } from "../../lib/types";

interface ConnectionMetadataRowProps {
  form: ConnectionFormData;
  folders: Folder[];
  tags: Tag[];
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function ConnectionMetadataRow({ form, folders, tags, onChange }: ConnectionMetadataRowProps) {
  const [openPanel, setOpenPanel] = useState<"tags" | "env" | null>(null);
  const toggle = (panel: "tags" | "env") =>
    setOpenPanel((cur) => (cur === panel ? null : panel));

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-text mb-1.5">Connection Label</label>
        <Input
          value={form.name}
          onChange={(value) => onChange({ name: value })}
          placeholder="My Production Database"
          aria-label="Connection Label"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => toggle("tags")}
          aria-label="Add Tags"
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
            openPanel === "tags" ? "border-accent text-text" : "border-border text-text-muted hover:text-text"
          }`}
        >
          <Plus size={12} /> Add Tags
        </button>
        <button
          type="button"
          onClick={() => toggle("env")}
          aria-label="Set Env"
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
            openPanel === "env" ? "border-accent text-text" : "border-border text-text-muted hover:text-text"
          }`}
        >
          <Layers size={12} /> Set Env
        </button>
      </div>

      {openPanel === "tags" && (
        <SearchableTagPicker
          tags={tags}
          selectedTagIds={form.tag_ids ?? []}
          onToggle={(tagId) => {
            const current = form.tag_ids ?? [];
            const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId];
            onChange({ tag_ids: next });
          }}
        />
      )}
      {openPanel === "env" && (
        <div data-testid="environment-section">
          <label className="block text-sm text-text mb-1.5">Environment</label>
          <EnvironmentSelect value={form.environment} onChange={(value) => onChange({ environment: value })} />
        </div>
      )}

      <div data-testid="folder-section">
        <label className="block text-sm text-text mb-1.5">Folder</label>
        <FolderSelect folders={folders} value={form.folder_id ?? null} onChange={(value) => onChange({ folder_id: value })} />
      </div>
    </div>
  );
}