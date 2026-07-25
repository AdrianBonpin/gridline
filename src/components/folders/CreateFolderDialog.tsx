import { useState } from "react";
import type { Folder } from "../../lib/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface CreateFolderDialogProps {
  open: boolean;
  parentOptions: Folder[];
  onCreate: (input: { name: string; parent_id: string | null }) => void;
  onClose: () => void;
}

export function CreateFolderDialog({ open, parentOptions, onCreate, onClose }: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);

  if (!open) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, parent_id: parentId });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="glass rounded-xl p-6 w-80" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-heading mb-3">New Folder</h3>
        <Input placeholder="Folder name" value={name} onChange={setName} />
        <select
          className="w-full mt-3 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm text-white"
          value={parentId ?? ""}
          onChange={(e) => setParentId(e.target.value || null)}
        >
          <option value="">No parent</option>
          {parentOptions.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate}>Create</Button>
        </div>
      </div>
    </div>
  );
}