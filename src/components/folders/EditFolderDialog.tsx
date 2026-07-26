import { useEffect, useRef, useState } from "react";
import type { Folder, Tag } from "../../lib/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useNotificationStore } from "../../stores/notificationStore";
import { SearchableTagPicker } from "../tags/SearchableTagPicker";

interface EditFolderDialogProps {
  open: boolean;
  folder: Folder | null;
  tags: Tag[];
  onSave: (id: string, input: { name: string; tag_ids: string[] }) => void;
  onClose: () => void;
}

export function EditFolderDialog({ open, folder, tags, onSave, onClose }: EditFolderDialogProps) {
  const [name, setName] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const notify = useNotificationStore((s) => s.notify);

  useEffect(() => {
    if (open && folder) {
      setName(folder.name);
      setSelectedTagIds(folder.tag_ids);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, folder]);

  if (!open || !folder) return null;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify("Name must not be empty", "error");
      return;
    }
    onSave(folder.id, { name: trimmed, tag_ids: selectedTagIds });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  return (
    <div className="fixed inset-0 bg-canvas/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        className="glass rounded-2xl p-6 w-96 shadow-2xl ring-1 ring-white/10"
        style={{ background: "linear-gradient(145deg, rgba(24,24,27,0.85), rgba(10,10,11,0.65))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-heading text-text text-lg mb-4">Edit Folder</h3>
        <Input
          ref={inputRef}
          placeholder="Folder name"
          value={name}
          onChange={setName}
        />
        {tags.length > 0 && (
          <SearchableTagPicker
            tags={tags}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
          />
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </div>
  );
}