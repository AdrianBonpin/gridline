import { useEffect, useState } from "react";
import type { Folder } from "../../lib/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Folder as FolderIcon } from "lucide-react";

interface CreateFolderDialogProps {
  open: boolean;
  parentOptions: Folder[];
  currentFolderId?: string | null;
  onCreate: (input: { name: string; parent_id: string | null }) => void;
  onClose: () => void;
}

export function CreateFolderDialog({ open, parentOptions, currentFolderId = null, onCreate, onClose }: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const parentName = currentFolderId
    ? parentOptions.find((f) => f.id === currentFolderId)?.name ?? null
    : null;

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  if (!open) return null;

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate({ name: trimmed, parent_id: currentFolderId ?? null });
  };

  return (
    <div className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="glass rounded-2xl p-6 w-80 shadow-2xl ring-1 ring-white/10"
        style={{ background: "linear-gradient(145deg, rgba(24,24,27,0.85), rgba(10,10,11,0.65))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-text text-lg mb-1">New Folder</h3>
        {parentName ? (
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-4">
            <FolderIcon size={12} />
            <span>Inside {parentName}</span>
          </div>
        ) : (
          <div className="text-xs text-text-muted mb-4">Top-level folder</div>
        )}
        <Input placeholder="Folder name" value={name} onChange={setName} />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate}>Create</Button>
        </div>
      </div>
    </div>
  );
}