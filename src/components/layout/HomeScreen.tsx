import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useFilteredConnections } from "../../hooks/useConnections";
import { useSortedTags } from "../../hooks/useSortedTags";
import { SearchBar } from "../search/SearchBar";
import type { SearchBarHandle } from "../search/SearchBar";
import { ActionRow } from "./ActionRow";
import { ConnectionGrid } from "../connections/ConnectionGrid";
import { ConnectionCard } from "../connections/ConnectionCard";
import { CreateFolderDialog } from "../folders/CreateFolderDialog";
import { EditFolderDialog } from "../folders/EditFolderDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { handleImport, handleExport } from "../../lib/importExport";
import { getChildFolders } from "../../lib/utils";
import { useShortcut } from "../../hooks/useShortcut";
import type { Folder } from "../../lib/types";

export function HomeScreen() {
    const connections = useFilteredConnections();
    const tags = useSortedTags();
    const folders = useConnectionStore((s) => s.folders);
    const activeFolderId = useUiStore((s) => s.activeFolderId);
    const setActiveFolderId = useUiStore((s) => s.setActiveFolderId);
    const searchQuery = useUiStore((s) => s.searchQuery);
    const toggleTag = useUiStore((s) => s.toggleTag);
    const createFolder = useConnectionStore((s) => s.createFolder);
    const updateFolder = useConnectionStore((s) => s.updateFolder);
    const deleteFolder = useConnectionStore((s) => s.deleteFolder);
    const deleteConnection = useConnectionStore((s) => s.deleteConnection);
    const loadAll = useConnectionStore((s) => s.loadAll);
    const selectedItemIds = useUiStore((s) => s.selectedItemIds);
    const clearSelection = useUiStore((s) => s.clearSelection);
    const [folderDialogOpen, setFolderDialogOpen] = useState(false);
    const [editFolder, setEditFolder] = useState<Folder | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{
        type: "folder" | "selected";
        folder?: Folder;
    } | null>(null);
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const searchRef = useRef<SearchBarHandle>(null);
    const setSearchQuery = useUiStore((s) => s.setSearchQuery);
    const setPrefilledConnectionString = useUiStore(
        (s) => s.setPrefilledConnectionString,
    );
    const setActiveView = useUiStore((s) => s.setActiveView);
    const setActiveConnectionId = useUiStore((s) => s.setActiveConnectionId);

    const handleOpenDbViewer = (connectionId: string) => {
        setActiveConnectionId(connectionId);
        setActiveView("db-viewer");
    };

    const handleSearchUrl = (url: string) => {
        setSearchQuery("");
        setPrefilledConnectionString(url);
        setActiveView("new-connection");
    };

    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        const { active, over } = event;
        if (!over) return;

        const connectionId = active.id as string;
        let folderId: string | null = null;

        if (over.id === "root") {
            folderId = null;
        } else if (typeof over.id === "string" && over.id.startsWith("folder-")) {
            const folderData = (over.data.current as any)?.folder;
            folderId = folderData?.id ?? null;
        } else {
            return; // dropped on something unexpected
        }

        try {
            await useConnectionStore.getState().moveConnection(connectionId, folderId);
        } catch {
            // Error handling in store; no additional action needed here
        }
    }, []);

    // Cmd+K to focus search (configurable in Settings → Shortcuts)
    useShortcut("command_palette", () => {
        searchRef.current?.focus();
    });

    const currentFolderId =
        activeFolderId !== null && folders.some((f) => f.id === activeFolderId)
            ? activeFolderId
            : null;
    const visibleFolderIds = useMemo(
        () => getChildFolders(folders, currentFolderId).map((f) => f.id),
        [folders, currentFolderId],
    );
    const visibleConnectionIds = useMemo(
        () =>
            connections
                .filter((c) => c.folder_id === currentFolderId)
                .map((c) => c.id),
        [connections, currentFolderId],
    );
    const visibleItemIds = useMemo(
        () => [...visibleFolderIds, ...visibleConnectionIds],
        [visibleFolderIds, visibleConnectionIds],
    );

    // Reset to root if the active folder no longer exists
    useEffect(() => {
        if (
            activeFolderId !== null &&
            !folders.some((f) => f.id === activeFolderId)
        ) {
            setActiveFolderId(null);
        }
    }, [folders, activeFolderId, setActiveFolderId]);

    const executeDeleteSelected = async () => {
        const folderIds = new Set(folders.map((f) => f.id));
        for (const id of selectedItemIds) {
            try {
                if (folderIds.has(id)) {
                    await deleteFolder(id);
                } else {
                    await deleteConnection(id);
                }
            } catch (e) {
                console.error("Failed to delete item:", e);
            }
        }
        clearSelection();
        setConfirmDelete(null);
    };

    const executeDeleteFolder = async (folder: Folder) => {
        try {
            await deleteFolder(folder.id);
            if (activeFolderId === folder.id) {
                setActiveFolderId(null);
            }
        } catch (e) {
            console.error("Failed to delete folder:", e);
        }
        setConfirmDelete(null);
    };

    return (
        <main className="min-h-screen p-6 bg-canvas select-none max-w-7xl mx-auto">
            <div className="mb-6">
                <SearchBar ref={searchRef} onDetectUrl={handleSearchUrl} />
            </div>
            <div className="mb-4">
                <ActionRow
                    onNewFolder={() => setFolderDialogOpen(true)}
                    onImport={async () => {
                        const r = await handleImport();
                        if (r) await loadAll();
                    }}
                    onExport={async () => {
                        await handleExport();
                    }}
                    onDeleteSelected={() =>
                        setConfirmDelete({ type: "selected" })
                    }
                    visibleItemIds={visibleItemIds}
                />
            </div>
            <DndContext
                onDragStart={(event) => setActiveDragId(event.active.id as string)}
                onDragEnd={async (event) => {
                    setActiveDragId(null);
                    await handleDragEnd(event);
                }}
                collisionDetection={closestCenter}
            >
                <ConnectionGrid
                    connections={connections}
                    tags={tags}
                    folders={folders}
                    activeFolderId={activeFolderId}
                    onFolderSelect={setActiveFolderId}
                    hasSearch={searchQuery.length > 0}
                    onTagToggle={toggleTag}
                    onOpenDbViewer={handleOpenDbViewer}
                    onEditFolder={(f) => setEditFolder(f)}
                    onDeleteFolder={(f) =>
                        setConfirmDelete({ type: "folder", folder: f })
                    }
                />
                <DragOverlay dropAnimation={null}>
                    {activeDragId && connections.find((c) => c.id === activeDragId) ? (
                        <div className="opacity-80">
                            <ConnectionCard
                                connection={connections.find((c) => c.id === activeDragId)!}
                                tags={tags}
                                onTagToggle={() => {}}
                                onOpenDbViewer={() => {}}
                            />
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>
            <CreateFolderDialog
                open={folderDialogOpen}
                parentOptions={folders}
                currentFolderId={activeFolderId}
                tags={tags}
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
            <EditFolderDialog
                open={editFolder !== null}
                folder={editFolder}
                tags={tags}
                onSave={async (id, input) => {
                    try {
                        const folder = folders.find((f) => f.id === id);
                        await updateFolder(id, {
                            name: input.name,
                            parent_id: folder?.parent_id ?? null,
                            tag_ids: input.tag_ids,
                        });
                    } catch (e) {
                        console.error("Failed to update folder:", e);
                    }
                    setEditFolder(null);
                }}
                onClose={() => setEditFolder(null)}
            />
            {confirmDelete?.type === "selected" && (
                <ConfirmDialog
                    open
                    title="Delete Items"
                    message={`Are you sure you want to delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? "s" : ""}?`}
                    confirmLabel="Delete"
                    confirmVariant="ghost"
                    onConfirm={executeDeleteSelected}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
            {confirmDelete?.type === "folder" && confirmDelete.folder && (
                <ConfirmDialog
                    open
                    title="Delete Folder"
                    message={`Are you sure you want to delete "${confirmDelete.folder.name}"? Any items inside this folder will be moved to the parent folder.`}
                    confirmLabel="Delete"
                    confirmVariant="ghost"
                    onConfirm={() => executeDeleteFolder(confirmDelete.folder!)}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}
        </main>
    );
}
