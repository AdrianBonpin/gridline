import type { Connection, Folder, Tag } from "../../lib/types";
import { Folder as FolderIcon } from "lucide-react";
import { ConnectionCard } from "./ConnectionCard";
interface ConnectionGridProps {
  connections: Connection[];
  tags: Tag[];
  folders?: Folder[];
  activeFolderId?: string | null;
  onFolderSelect?: (id: string | null) => void;
  hasSearch?: boolean;
  onTagToggle?: (id: string) => void;
}

export function ConnectionGrid({ connections, tags, folders = [], activeFolderId = null, onFolderSelect, hasSearch = false, onTagToggle }: ConnectionGridProps) {
  const folderConnCount = (folderId: string) =>
    connections.filter((c) => c.folder_id === folderId).length;

  const hasFolders = folders.length > 0;
  const hasConns = connections.length > 0;

  if (!hasFolders && !hasConns) {
    return (
      <div className="text-center w-full py-16 text-white/50">
        {hasSearch ? "No connections match your search." : "No connections yet. Create one to get started."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasFolders && (
        <div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            <button
              onClick={() => onFolderSelect?.(null)}
              className={`rounded-xl p-3 text-left transition-colors border ${
                activeFolderId === null
                  ? "bg-accent/20 border-accent/50 text-white"
                  : "bg-surface border-border text-white/70 hover:text-white hover:border-accent/50"
              }`}
            >
              <div className="font-semibold text-sm">All Connections</div>
              <div className="text-xs text-white/50 mt-0.5">{connections.length} total</div>
            </button>
            {folders.map((f) => {
              const count = folderConnCount(f.id);
              const isActive = activeFolderId === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => onFolderSelect?.(f.id)}
                  className={`rounded-xl p-3 text-left transition-colors border ${
                    isActive
                      ? "bg-accent/20 border-accent/50 text-white"
                      : "bg-surface border-border text-white/70 hover:text-white hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <FolderIcon size={18} className={isActive ? "text-accent" : "text-white/60"} />
                    <span className="font-semibold text-sm truncate">{f.name}</span>
                  </div>
                  <div className="text-xs text-white/50 mt-1">{count} connection{count !== 1 ? "s" : ""}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {hasConns && (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {connections.map((c) => <ConnectionCard key={c.id} connection={c} tags={tags} onTagToggle={onTagToggle} />)}
        </div>
      )}
    </div>
  );
}