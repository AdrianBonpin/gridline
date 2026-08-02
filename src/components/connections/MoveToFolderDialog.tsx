import { useState } from "react";
import { Folder as FolderIcon, Check } from "lucide-react";
import { AnimatedModal } from "../ui/AnimatedModal";
import { Button } from "../ui/Button";
import type { Folder } from "../../lib/types";

interface MoveToFolderDialogProps {
  open: boolean;
  folders: Folder[];
  selectedCount: number;
  onConfirm: (targetFolderId: string | null) => void;
  onClose: () => void;
}

export function MoveToFolderDialog({
  open,
  folders,
  selectedCount,
  onConfirm,
  onClose,
}: MoveToFolderDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleConfirm = () => {
    onConfirm(selectedId);
  };

  const isSelected = (id: string | null) => selectedId === id;

  return (
    <AnimatedModal open={open} onClose={onClose}>
      <div className="w-[360px]">
        <h3 className="font-heading text-lg text-text mb-4">
          Move {selectedCount} item{selectedCount !== 1 ? "s" : ""} to folder
        </h3>
        <div className="max-h-[300px] overflow-y-auto space-y-1 pr-1">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
              isSelected(null)
                ? "bg-accent/10 text-text"
                : "text-text-muted hover:text-text hover:bg-surface-raised"
            }`}
          >
            <FolderIcon size={14} />
            <span className="flex-1">Root (no folder)</span>
            {isSelected(null) && <Check size={14} className="text-accent" />}
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedId(folder.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                isSelected(folder.id)
                  ? "bg-accent/10 text-text"
                  : "text-text-muted hover:text-text hover:bg-surface-raised"
              }`}
            >
              <FolderIcon size={14} />
              <span className="flex-1 truncate">{folder.name}</span>
              {isSelected(folder.id) && <Check size={14} className="text-accent" />}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>Move</Button>
        </div>
      </div>
    </AnimatedModal>
  );
}