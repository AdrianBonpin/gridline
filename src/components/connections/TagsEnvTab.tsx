import { EnvironmentSelect } from "../connections/EnvironmentSelect";
import { FolderSelect } from "../connections/FolderSelect";
import { SearchableTagPicker } from "../tags/SearchableTagPicker";
import { useConnectionStore } from "../../stores/connectionStore";
import type { ConnectionFormData } from "../connections/connectionFormData";

interface TagsEnvTabProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function TagsEnvTab({ form, onChange }: TagsEnvTabProps) {
  const folders = useConnectionStore((s) => s.folders);
  const tags = useConnectionStore((s) => s.tags);

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text mb-1.5">Environment</label>
        <EnvironmentSelect
          value={form.environment}
          onChange={(value) => onChange({ environment: value })}
        />
      </div>

      <div>
        <label className="block text-sm text-text mb-1.5">Folder</label>
        <FolderSelect
          folders={folders}
          value={form.folder_id ?? null}
          onChange={(value) => onChange({ folder_id: value })}
        />
      </div>

      <div>
        <label className="block text-sm text-text mb-1.5">Tags</label>
        <SearchableTagPicker
          tags={tags}
          selectedTagIds={form.tag_ids ?? []}
          onToggle={(tagId) => {
            const current = form.tag_ids ?? [];
            const next = current.includes(tagId)
              ? current.filter((id) => id !== tagId)
              : [...current, tagId];
            onChange({ tag_ids: next });
          }}
        />
      </div>
    </div>
  );
}