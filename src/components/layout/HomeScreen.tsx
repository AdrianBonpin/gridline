import { useState } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useFilteredConnections } from "../../hooks/useConnections";
import { SearchBar } from "../search/SearchBar";
import { ActionRow } from "./ActionRow";
import { ConnectionGrid } from "../connections/ConnectionGrid";
import { FolderTree } from "../folders/FolderTree";
import { CreateFolderDialog } from "../folders/CreateFolderDialog";

export function HomeScreen() {
  const connections = useFilteredConnections();
  const tags = useConnectionStore((s) => s.tags);
  const folders = useConnectionStore((s) => s.folders);
  const activeFolderId = useUiStore((s) => s.activeFolderId);
  const setActiveFolderId = useUiStore((s) => s.setActiveFolderId);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const toggleTag = useUiStore((s) => s.toggleTag);
  const createFolder = useConnectionStore((s) => s.createFolder);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  return (
    <main className="min-h-screen p-6">
      <h1 className="font-heading text-2xl text-center mb-6">Gridline</h1>
      <div className="mb-6">
        <SearchBar />
      </div>
      <div className="mb-4">
        <ActionRow onNewFolder={() => setFolderDialogOpen(true)} />
      </div>
      <div className="flex gap-6">
        <aside className="w-56 shrink-0">
          <FolderTree
            folders={folders}
            activeFolderId={activeFolderId}
            onSelect={setActiveFolderId}
          />
        </aside>
        <div className="flex-1">
          <ConnectionGrid
            connections={connections}
            tags={tags}
            hasSearch={searchQuery.length > 0}
            onTagToggle={toggleTag}
          />
        </div>
      </div>
      <CreateFolderDialog
        open={folderDialogOpen}
        parentOptions={folders}
        onCreate={(input) => {
          createFolder(input);
          setFolderDialogOpen(false);
        }}
        onClose={() => setFolderDialogOpen(false)}
      />
    </main>
  );
}