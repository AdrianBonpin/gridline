import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { useConnectionStore } from "../../stores/connectionStore";
import { useUiStore } from "../../stores/uiStore";
import { useSettingsStore } from "../../stores/settingsStore";
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
import { EditConnectionModal } from "../db-viewer/EditConnectionModal";
import { MoveToFolderDialog } from "../connections/MoveToFolderDialog";
import { RecentConnectionsStrip } from "../connections/RecentConnectionsStrip";
import {
    handleImport,
    handleExport,
    describeImportResult,
    importErrorMessage,
} from "../../lib/importExport";
import { useNotificationStore } from "../../stores/notificationStore";
import { errorText, getChildFolders } from "../../lib/utils";
import { useShortcut } from "../../hooks/useShortcut";
import type { Connection, Folder } from "../../lib/types";

// Cap on individually reported dropped links, so importing a file from a
// machine with a different folder/tag layout cannot bury the screen in toasts.
const MAX_IMPORT_WARNINGS = 5;

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
    const moveSelectionToFolder = useConnectionStore((s) => s.moveSelectionToFolder);
    const recordRecent = useConnectionStore((s) => s.recordRecent);
    const loadRecent = useConnectionStore((s) => s.loadRecent);
    const recent = useConnectionStore((s) => s.recent);
    const notify = useNotificationStore((s) => s.notify);
    const selectedItemIds = useUiStore((s) => s.selectedItemIds);
    const clearSelection = useUiStore((s) => s.clearSelection);
    const selectAllItems = useUiStore((s) => s.selectAllItems);
    const confirmBeforeDelete =
        useSettingsStore((s) => s.settings?.confirm_before_delete ?? true);
    const [folderDialogOpen, setFolderDialogOpen] = useState(false);
    const [editFolder, setEditFolder] = useState<Folder | null>(null);
    const [moveToFolderOpen, setMoveToFolderOpen] = useState(false);
    const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{
        type: "folder" | "selected" | "connection";
        folder?: Folder;
        connection?: Connection;
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
        recordRecent(connectionId);
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
        } catch (e) {
            // The store rolled the optimistic move back; say why it did.
            notify(`Failed to move connection: ${errorText(e)}`, "error");
        }
    }, [notify]);

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

    // Load recent connections on mount for the root strip
    useEffect(() => {
        loadRecent();
    }, [loadRecent]);

    /**
     * Delete every selected item, reporting exactly what happened.
     *
     * A locked store or a keychain failure used to be swallowed with
     * `console.error`, while the selection was cleared and the item stayed on
     * screen — indistinguishable from a successful delete. Every failure is now
     * reported per item, with its reason, and the selection is reduced to
     * exactly the items that still exist so the user can retry them.
     */
    const executeDeleteSelected = async () => {
        const folderIds = new Set(folders.map((f) => f.id));
        const failed: { id: string; name: string; reason: string }[] = [];
        let deleted = 0;
        for (const id of selectedItemIds) {
            const isFolder = folderIds.has(id);
            // Names come from the full store, not the filtered view, so a
            // failure is always named even if a filter hides the item.
            const name = isFolder
                ? (folders.find((f) => f.id === id)?.name ?? id)
                : (useConnectionStore
                      .getState()
                      .connections.find((c) => c.id === id)?.name ?? id);
            try {
                if (isFolder) {
                    await deleteFolder(id);
                } else {
                    await deleteConnection(id);
                }
                deleted += 1;
            } catch (e) {
                failed.push({ id, name, reason: errorText(e) });
            }
        }
        setConfirmDelete(null);
        // The selection survives for exactly the items that still exist: a
        // failed delete is retryable and never looks like it removed anything.
        selectAllItems(failed.map((f) => f.id));

        // One visible error per failed item, named, with its reason — never a
        // capped summary that hides which items are still there.
        for (const failure of failed) {
            notify(
                `Failed to delete "${failure.name}": ${failure.reason}`,
                "error",
            );
        }
        if (failed.length > 0 && deleted > 0) {
            notify(
                `Deleted ${deleted} of ${deleted + failed.length} items. ` +
                    `${failed.length} still selected.`,
                "info",
            );
        }
    };

    const executeDeleteFolder = async (folder: Folder) => {
        try {
            await deleteFolder(folder.id);
            if (activeFolderId === folder.id) {
                setActiveFolderId(null);
            }
        } catch (e) {
            notify(
                `Failed to delete folder "${folder.name}": ${errorText(e)}`,
                "error",
            );
        }
        setConfirmDelete(null);
    };

    const handleDuplicateConnection = async (conn: Connection) => {
        try {
            await useConnectionStore.getState().duplicateConnection(conn.id);
        } catch (e) {
            notify(
                `Failed to duplicate "${conn.name}": ${errorText(e)}`,
                "error",
            );
        }
    };

    /**
     * Delete one connection, from the card menu or its confirmation dialog.
     * A failure keeps the connection on screen and says why; the same path
     * serves both entry points so neither can end in silence.
     */
    const deleteOneConnection = async (conn: Connection) => {
        try {
            await deleteConnection(conn.id);
        } catch (e) {
            notify(
                `Failed to delete connection "${conn.name}": ${errorText(e)}`,
                "error",
            );
        }
        setConfirmDelete(null);
    };

    const handleDeleteConnection = (conn: Connection) => {
        if (confirmBeforeDelete) {
            setConfirmDelete({ type: "connection", connection: conn });
        } else {
            void deleteOneConnection(conn);
        }
    };

    return (
        <main className="min-h-full p-6 bg-canvas select-none max-w-7xl mx-auto">
            <div className="mb-6">
                <SearchBar ref={searchRef} onDetectUrl={handleSearchUrl} />
            </div>
            <div className="mb-4">
                <ActionRow
                    onNewFolder={() => setFolderDialogOpen(true)}
                    onImport={async () => {
                        let r: Awaited<ReturnType<typeof handleImport>>;
                        try {
                            r = await handleImport();
                        } catch (e) {
                            // A malformed or unreadable file rejects the whole
                            // import; that must be visible, not an unhandled
                            // rejection only the console sees.
                            notify(`Import failed: ${importErrorMessage(e)}`, "error");
                            return;
                        }
                        if (!r) return;
                        const summary = describeImportResult(r);
                        notify(summary.message, summary.type);
                        // Dropped links are reported per record, so a broken
                        // folder/tag reference is never silent.
                        for (const warning of summary.warnings.slice(0, MAX_IMPORT_WARNINGS)) {
                            notify(warning, "info");
                        }
                        if (summary.warnings.length > MAX_IMPORT_WARNINGS) {
                            notify(
                                `${summary.warnings.length - MAX_IMPORT_WARNINGS} more links dropped`,
                                "info"
                            );
                        }
                        await loadAll();
                    }}
                    onExport={async () => {
                        await handleExport();
                    }}
                    onDeleteSelected={() =>
                        confirmBeforeDelete
                            ? setConfirmDelete({ type: "selected" })
                            : executeDeleteSelected()
                    }
                    onMoveToFolder={() => setMoveToFolderOpen(true)}
                    visibleItemIds={visibleItemIds}
                />
            </div>
            {activeFolderId === null && !searchQuery && (
                <RecentConnectionsStrip recents={recent} onOpen={handleOpenDbViewer} />
            )}
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
                        confirmBeforeDelete
                            ? setConfirmDelete({ type: "folder", folder: f })
                            : executeDeleteFolder(f)
                    }
                    onEditConnection={setEditingConnection}
                    onDuplicateConnection={handleDuplicateConnection}
                    onDeleteConnection={handleDeleteConnection}
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
                        // Keep the dialog open: the input is still there to
                        // retry, and the reason is visible rather than logged.
                        notify(
                            `Failed to create folder "${input.name}": ${errorText(e)}`,
                            "error",
                        );
                        return;
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
                        notify(
                            `Failed to save folder "${input.name}": ${errorText(e)}`,
                            "error",
                        );
                        return;
                    }
                    setEditFolder(null);
                }}
                onClose={() => setEditFolder(null)}
            />
            <MoveToFolderDialog
                open={moveToFolderOpen}
                folders={folders}
                selectedCount={selectedItemIds.length}
                onConfirm={async (target) => {
                    try {
                        await moveSelectionToFolder(selectedItemIds, target);
                    } catch (e) {
                        // The selection is retained so the move can be retried.
                        notify(
                            `Failed to move selection: ${errorText(e)}`,
                            "error",
                        );
                        return;
                    }
                    clearSelection();
                    setMoveToFolderOpen(false);
                }}
                onClose={() => setMoveToFolderOpen(false)}
            />
            {editingConnection && (
                <EditConnectionModal
                    connection={editingConnection}
                    open
                    onClose={() => setEditingConnection(null)}
                    onSaved={() => {}}
                />
            )}
            {confirmDelete?.type === "selected" && (
                <ConfirmDialog
                    open
                    title="Delete Items"
                    message={`Are you sure you want to delete ${selectedItemIds.length} item${selectedItemIds.length !== 1 ? "s" : ""}? Deleting a connection also permanently deletes its Connection-owned Data: query history, recent-connection records, and saved queries for that connection. Global saved queries are kept.`}
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
        {confirmDelete?.type === "connection" &&
                confirmDelete.connection && (
                    <ConfirmDialog
                        open
                        title="Delete Connection"
                        message={`Are you sure you want to delete "${confirmDelete.connection.name}"? This permanently deletes its Connection-owned Data: query history, recent-connection records, and saved queries for this connection. Global saved queries are kept.`}
                        confirmLabel="Delete"
                        confirmVariant="ghost"
                        onConfirm={async () => {
                            await deleteOneConnection(confirmDelete.connection!);
                        }}
                        onCancel={() => setConfirmDelete(null)}
                    />
                )}
        </main>
    );
}
