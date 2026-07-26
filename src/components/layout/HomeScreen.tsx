import { useEffect, useState, useMemo } from "react";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useFilteredConnections } from "../../hooks/useConnections";
import { SearchBar } from "../search/SearchBar";
import { ActionRow } from "./ActionRow";
import { ConnectionGrid } from "../connections/ConnectionGrid";
import { CreateFolderDialog } from "../folders/CreateFolderDialog";
import { handleImport, handleExport } from "../../lib/importExport";
import { getChildFolders } from "../../lib/utils";

export function HomeScreen() {
  const connections = useFilteredConnections();
  const tags = useConnectionStore((s) => s.tags);
  const folders = useConnectionStore((s) => s.folders);
  const activeFolderId = useUiStore((s) => s.activeFolderId);
  const setActiveFolderId = useUiStore((s) => s.setActiveFolderId);
  const searchQuery = useUiStore((s) => s.searchQuery);
  const toggleTag = useUiStore((s) => s.toggleTag);
  const createFolder = useConnectionStore((s) => s.createFolder);
  const deleteFolder = useConnectionStore((s) => s.deleteFolder);
  const loadAll = useConnectionStore((s) => s.loadAll);
  const selectedItemIds = useUiStore((s) => s.selectedItemIds);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);

  const currentFolderId =
    activeFolderId !== null && folders.some((f) => f.id === activeFolderId)
      ? activeFolderId
      : null;
  const visibleFolderIds = useMemo(
    () => getChildFolders(folders, currentFolderId).map((f) => f.id),
    [folders, currentFolderId],
  );
  const visibleConnectionIds = useMemo(
    () => connections.filter((c) => c.folder_id === currentFolderId).map((c) => c.id),
    [connections, currentFolderId],
  );
  const visibleItemIds = useMemo(
    () => [...visibleFolderIds, ...visibleConnectionIds],
    [visibleFolderIds, visibleConnectionIds],
  );

  // Reset to root if the active folder no longer exists
  useEffect(() => {
    if (activeFolderId !== null && !folders.some((f) => f.id === activeFolderId)) {
      setActiveFolderId(null);
    }
  }, [folders, activeFolderId, setActiveFolderId]);

  const handleDeleteSelected = async () => {
    for (const id of selectedItemIds) {
      try {
        await deleteFolder(id);
      } catch (e) {
        console.error("Failed to delete folder:", e);
      }
    }
    clearSelection();
  };

  return (
    <main className="min-h-screen p-6 bg-canvas select-none">
      <h1 className="font-heading text-2xl text-text text-center mb-6">Gridline</h1>
      <div className="mb-6">
        <SearchBar />
      </div>
      <div className="mb-4">
        <ActionRow
          onNewFolder={() => setFolderDialogOpen(true)}
          onImport={async () => { const r = await handleImport(); if (r) await loadAll(); }}
          onExport={async () => { await handleExport(); }}
          onDeleteSelected={handleDeleteSelected}
          visibleItemIds={visibleItemIds}
        />
      </div>
      <ConnectionGrid
        connections={connections}
        tags={tags}
        folders={folders}
        activeFolderId={activeFolderId}
        onFolderSelect={setActiveFolderId}
        hasSearch={searchQuery.length > 0}
        onTagToggle={toggleTag}
      />
      <CreateFolderDialog
        open={folderDialogOpen}
        parentOptions={folders}
        currentFolderId={activeFolderId}
        onCreate={async (input) => {
          try {
            await createFolder(input);
          } catch (e) {
            console.error("Failed to create folder:", e);
          }
          setFolderDialogOpen(false);
        }}
        onClose={() => setFolderDialogOpen(false)}
      />
    </main>
  );
}