import type { Folder } from "../../lib/types";
import { ChevronRight, Folder as FolderIcon } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";

interface FolderTreeProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
}

export function FolderTree({ folders, activeFolderId, onSelect }: FolderTreeProps) {
  const roots = folders.filter((f) => f.parent_id === null);
  const childrenOf = (id: string) => folders.filter((f) => f.parent_id === id);
  const { setNodeRef: setRootRef, isOver: isRootOver } = useDroppable({
    id: "root",
  });

  const FolderItem = ({ folder, depth }: { folder: Folder; depth: number }) => {
    const isActive = activeFolderId === folder.id;
    const { setNodeRef: setDropRef, isOver } = useDroppable({
      id: `folder-${folder.id}`,
      data: { type: "folder", folder },
    });
    return (
      <div key={folder.id}>
        <button
          ref={setDropRef}
          onClick={() => onSelect(folder.id)}
          className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded text-sm ${
            isActive ? "bg-accent/20 text-white" : "text-white/70 hover:text-white"
          } ${isOver ? "ring-1 ring-accent bg-accent/10" : ""}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FolderIcon size={14} /> {folder.name}
        </button>
        {childrenOf(folder.id).map((c) => (
          <FolderItem key={c.id} folder={c} depth={depth + 1} />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      <button
        ref={setRootRef}
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded text-sm ${
          activeFolderId === null ? "bg-accent/20 text-white" : "text-white/70 hover:text-white"
        } ${isRootOver ? "ring-1 ring-accent bg-accent/10" : ""}`}
      >
        <ChevronRight size={14} /> All Connections
      </button>
      {roots.map((r) => (
        <FolderItem key={r.id} folder={r} depth={0} />
      ))}
    </div>
  );
}