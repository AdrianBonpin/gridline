import type { Folder } from "../../lib/types";
import { ChevronRight, Home, Search, X } from "lucide-react";
import { getFolderPath } from "../../lib/utils";

interface FolderBreadcrumbProps {
  folders: Folder[];
  activeFolderId: string | null;
  onNavigate: (folderId: string | null) => void;
  hasSearch?: boolean;
  onClearSearch?: () => void;
}

export function FolderBreadcrumb({
  folders,
  activeFolderId,
  onNavigate,
  hasSearch = false,
  onClearSearch,
}: FolderBreadcrumbProps) {
  const path = getFolderPath(folders, activeFolderId);

  if (hasSearch) {
    return (
      <nav className="flex items-center gap-1 text-sm text-text-muted">
        <span className="flex items-center gap-1 px-2 py-1 text-text">
          <Search size={14} />
          <span>Showing Search Results</span>
        </span>
        {onClearSearch && (
          <button
            onClick={onClearSearch}
            aria-label="Clear search"
            title="Clear search"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-text-muted hover:text-text hover:bg-surface-raised transition-colors cursor-pointer"
          >
            <X size={14} /> Clear
          </button>
        )}
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-1 text-sm text-text-muted">
      <button
        onClick={() => onNavigate(null)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
          activeFolderId === null ? "text-text" : "hover:text-text hover:bg-surface-raised"
        }`}
      >
        <Home size={14} />
        <span>All Connections</span>
      </button>
      {path.map((folder) => (
        <div key={folder.id} className="flex items-center gap-1">
          <ChevronRight size={14} />
          <button
            onClick={() => onNavigate(folder.id)}
            className={`px-2 py-1 rounded-md transition-colors ${
              folder.id === activeFolderId ? "text-text" : "hover:text-text hover:bg-surface-raised"
            }`}
          >
            {folder.name}
          </button>
        </div>
      ))}
    </nav>
  );
}