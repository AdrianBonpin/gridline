import { Input } from "../ui/Input";
import { EnvironmentSelect } from "./EnvironmentSelect";
import { FolderSelect } from "./FolderSelect";
import { ConnectionStringInput } from "./ConnectionStringInput";
import { SearchableTagPicker } from "../tags/SearchableTagPicker";
import type { ConnectionFormData } from "./connectionFormData";
import type { Folder, Tag } from "../../lib/types";

export interface SimpleConnectionFormProps {
    form: ConnectionFormData;
    folders: Folder[];
    tags: Tag[];
    onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function SimpleConnectionForm({
    form,
    folders,
    tags,
    onChange,
}: SimpleConnectionFormProps) {
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm text-text mb-1.5">Label</label>
                <Input
                    value={form.name}
                    onChange={(value) => onChange({ name: value })}
                    placeholder="My Production Database"
                    aria-label="Connection Label"
                />
                <p className="text-xs text-text-muted mt-1.5">
                    A friendly name to identify this connection.
                </p>
            </div>

            <div>
                <label className="block text-sm text-text mb-1.5">
                    Environment
                </label>
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

            <div>
                <label className="block text-sm text-text mb-1.5">
                    Connection String
                </label>
                <ConnectionStringInput
                    value={form.connection_string}
                    onChange={(value) => onChange({ connection_string: value })}
                    placeholder="postgresql://user:password@host:5432/database"
                    aria-label="Connection String"
                />
                <p className="text-xs text-text-muted mt-1.5">
                    Paste your connection string to auto-detect database type.
                </p>
            </div>
        </div>
    );
}
