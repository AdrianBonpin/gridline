import { useEffect, useRef, useState } from "react";
import type { Folder, Tag } from "../../lib/types";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Folder as FolderIcon } from "lucide-react";
import { useNotificationStore } from "../../stores/notificationStore";
import { SearchableTagPicker } from "../tags/SearchableTagPicker";

interface CreateFolderDialogProps {
  open: boolean;
  parentOptions: Folder[];
  currentFolderId?: string | null;
  tags: Tag[];
  onCreate: (input: { name: string; parent_id: string | null; tag_ids: string[] }) => void;
  onClose: () => void;
}

export function CreateFolderDialog({ open, parentOptions, currentFolderId = null, tags, onCreate, onClose }: CreateFolderDialogProps) {
  const [name, setName] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const notify = useNotificationStore((s) => s.notify);

  const parentName = currentFolderId
    ? parentOptions.find((f) => f.id === currentFolderId)?.name ?? null
    : null;

  useEffect(() => {
    if (open) {
      setName("");
      setSelectedTagIds([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      notify("Name must not be empty", "error");
      return;
    }
    onCreate({ name: trimmed, parent_id: currentFolderId ?? null, tag_ids: selectedTagIds });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-96">
        <h3 className="font-heading text-text text-lg mb-1">New Folder</h3>
        {parentName && (
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-4">
            <FolderIcon size={12} />
            <span>{parentName}</span>
          </div>
        )}
        <Input
          ref={inputRef}
          placeholder="Folder name"
          value={name}
          onChange={setName}
          onKeyDown={handleKeyDown}
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
          <Button onClick={handleCreate}>Create</Button>
        </div>
      </div>
    </AnimatedModal>
  );
}