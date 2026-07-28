import type { Folder } from "../../lib/types";
import { ChevronRight, Folder as FolderIcon } from "lucide-react";

interface FolderTreeProps {
  folders: Folder[];
  activeFolderId: string | null;
  onSelect: (id: string | null) => void;
}

export function FolderTree({ folders, activeFolderId, onSelect }: FolderTreeProps) {
  const roots = folders.filter((f) => f.parent_id === null);
  const childrenOf = (id: string) => folders.filter((f) => f.parent_id === id);

  const renderFolder = (folder: Folder, depth: number) => {
    const isActive = activeFolderId === folder.id;
    return (
      <div key={folder.id}>
        <button
          onClick={() => onSelect(folder.id)}
          className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded text-sm ${isActive ? "bg-accent/20 text-white" : "text-white/70 hover:text-white"}`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FolderIcon size={14} /> {folder.name}
        </button>
        {childrenOf(folder.id).map((c) => renderFolder(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1 w-full text-left px-2 py-1 rounded text-sm ${activeFolderId === null ? "bg-accent/20 text-white" : "text-white/70 hover:text-white"}`}
      >
        <ChevronRight size={14} /> All Connections
      </button>
      {roots.map((r) => renderFolder(r, 0))}
    </div>
  );
}