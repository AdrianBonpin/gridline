import type { Connection, Folder, Tag } from "../../lib/types";
import { Folder as FolderIcon, Check, Pencil, Trash2 } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { ConnectionCard } from "./ConnectionCard";
import { FolderBreadcrumb } from "../folders/FolderBreadcrumb";
import { getChildFolders, getDescendantFolderIds } from "../../lib/utils";
import { useUiStore } from "../../stores/uiStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { TagBadge } from "../tags/TagBadge";

interface DroppableFolderCardProps {
    folder: Folder;
    isSelected: boolean;
    count: number;
    subfolderCount: number;
    folderTags: Tag[];
    onFolderClick: (id: string) => void;
    onToggleSelection: (id: string) => void;
}

function DroppableFolderCard({
    folder,
    isSelected,
    count,
    subfolderCount,
    folderTags,
    onFolderClick,
    onToggleSelection,
}: DroppableFolderCardProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: `folder-${folder.id}`,
        data: { type: "folder", folder },
    });

    return (
        <div
            ref={setNodeRef}
            className={`relative group rounded-xl border transition-colors ${
                isSelected
                    ? "bg-accent/10 border-accent"
                    : "bg-surface border-border hover:border-border-hover"
            } ${isOver ? "ring-1 ring-accent bg-accent/10" : ""}`}
        >
            <button
                onClick={() => onFolderClick(folder.id)}
                className="w-full p-3 text-left min-w-0 cursor-pointer"
            >
                <div className="flex items-center gap-2">
                    <FolderIcon
                        size={18}
                        className={
                            isSelected
                                ? "text-accent"
                                : "text-text-muted"
                        }
                    />
                    <span className="font-semibold text-sm truncate text-text">
                        {folder.name}
                    </span>
                </div>
                <div className="text-xs text-text-muted mt-1">
                    {count > 0 &&
                        `${count} item${count !== 1 ? "s" : ""}`}
                    {count > 0 && subfolderCount > 0 && " · "}
                    {subfolderCount > 0 &&
                        `${subfolderCount} subfolder${subfolderCount !== 1 ? "s" : ""}`}
                    {count === 0 &&
                        subfolderCount === 0 &&
                        "Empty folder"}
                </div>
                {folderTags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                        {folderTags.map((t) => (
                            <TagBadge key={t.id} tag={t} />
                        ))}
                    </div>
                )}
            </button>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelection(folder.id);
                }}
                className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded border flex items-center justify-center transition-all ${
                    isSelected
                        ? "bg-accent border-accent opacity-100"
                        : "border-border bg-surface opacity-0 group-hover:opacity-100"
                }`}
            >
                {isSelected && (
                    <Check
                        size={12}
                        className="text-white"
                    />
                )}
            </button>
        </div>
    );
}

interface ConnectionGridProps {
    connections: Connection[];
    tags: Tag[];
    folders?: Folder[];
    activeFolderId?: string | null;
    onFolderSelect?: (id: string | null) => void;
    hasSearch?: boolean;
    onTagToggle?: (id: string) => void;
    onEditFolder?: (folder: Folder) => void;
    onDeleteFolder?: (folder: Folder) => void;
    onOpenDbViewer?: (connectionId: string) => void;
}

export function ConnectionGrid({
    connections,
    tags,
    folders = [],
    activeFolderId = null,
    onFolderSelect,
    hasSearch = false,
    onTagToggle,
    onEditFolder,
    onDeleteFolder,
    onOpenDbViewer,
}: ConnectionGridProps) {
    const selectedItemIds = useUiStore((s) => s.selectedItemIds);
    const toggleItemSelection = useUiStore((s) => s.toggleItemSelection);
    const clearSelection = useUiStore((s) => s.clearSelection);
    const activeTagIds = useUiStore((s) => s.activeTagIds);
    const activeDbTypes = useUiStore((s) => s.activeDbTypes);
    const activeEnvironment = useUiStore((s) => s.activeEnvironment);

    const currentFolderId = hasSearch
        ? null
        : activeFolderId !== null && folders.some((f) => f.id === activeFolderId)
            ? activeFolderId
            : null;
    const hasActiveFilters =
        activeTagIds.length > 0 ||
        activeDbTypes.length > 0 ||
        (activeEnvironment !== null && activeEnvironment !== undefined);

    const connectionMatchesFilters = (c: Connection) => {
        if (activeTagIds.length > 0 && !c.tag_ids.some((id) => activeTagIds.includes(id))) {
            return false;
        }
        if (activeDbTypes.length > 0 && !activeDbTypes.includes(c.db_type)) {
            return false;
        }
        if (activeEnvironment !== null && activeEnvironment !== undefined && c.environment !== activeEnvironment) {
            return false;
        }
        return true;
    };

    const visibleFolders = hasSearch
        ? []
        : getChildFolders(folders, currentFolderId).filter((f) => {
            if (!hasActiveFilters) return true;
            const folderMatchesTags = f.tag_ids.some((id) => activeTagIds.includes(id));
            if (folderMatchesTags) return true;
            const subIds = new Set(getDescendantFolderIds(folders, f.id));
            return connections.some(
                (c) => c.folder_id !== null && subIds.has(c.folder_id) && connectionMatchesFilters(c),
            );
        });
    const directConnections = hasSearch
        ? connections
        : connections.filter((c) => c.folder_id === currentFolderId);
    const allStoreConnections = useConnectionStore((s) => s.connections);
    const allStoreFolders = useConnectionStore((s) => s.folders);
    // Check if any direct connections OR any subfolder has connections anywhere below
    const hasItems = visibleFolders.length > 0 || directConnections.length > 0 ||
        (currentFolderId && allStoreConnections.some((c) => {
            const allowed = new Set(getDescendantFolderIds(allStoreFolders, currentFolderId));
            return c.folder_id !== null && allowed.has(c.folder_id);
        }));
    const isSelecting = selectedItemIds.length > 0;
    const activeFolder = currentFolderId
        ? (folders.find((f) => f.id === currentFolderId) ?? null)
        : null;

    const handleFolderClick = (folderId: string) => {
        if (isSelecting) {
            toggleItemSelection(folderId);
        } else {
            onFolderSelect?.(folderId);
        }
    };

    const handleBreadcrumbNavigate = (folderId: string | null) => {
        clearSelection();
        onFolderSelect?.(folderId);
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <FolderBreadcrumb
                    folders={folders}
                    activeFolderId={currentFolderId}
                    onNavigate={handleBreadcrumbNavigate}
                    hasSearch={hasSearch}
                    onClearSearch={() => useUiStore.getState().clearFilters()}
                />
                {activeFolder && (
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => onEditFolder?.(activeFolder)}
                            className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors px-2 py-1 rounded-md cursor-pointer"
                        >
                            <Pencil size={12} /> Edit
                        </button>
                        <button
                            onClick={() => onDeleteFolder?.(activeFolder)}
                            className="inline-flex items-center gap-1 text-xs !text-red-400 hover:!text-red-300 transition-colors px-2 py-1 rounded-md cursor-pointer"
                        >
                            <Trash2 size={12} /> Delete
                        </button>
                    </div>
                )}
            </div>

            {!hasItems ? (
                <div className="text-center w-full py-16 text-text-muted">
                    {hasSearch
                        ? "No connections match your search."
                        : activeFolderId
                          ? "This folder is empty. Add a connection or subfolder."
                          : "No connections yet. Create one to get started."}
                </div>
            ) : (
                <div
                    className="grid gap-3"
                    style={{
                        gridTemplateColumns:
                            "repeat(auto-fill, minmax(260px, 1fr))",
                    }}
                >
                    {visibleFolders.map((f) => {
                        const isSelected = selectedItemIds.includes(f.id);
                        // Count all connections in this subfolder (including nested descendants)
                        const subIds = new Set(getDescendantFolderIds(folders, f.id));
                        const count = allStoreConnections.filter(
                            (c) => c.folder_id !== null && subIds.has(c.folder_id),
                        ).length;
                        const subfolderCount = getChildFolders(
                            folders,
                            f.id,
                        ).length;
                        const tagMap = new Map(tags.map((t) => [t.id, t]));
                        const folderTags = f.tag_ids
                            .map((id) => tagMap.get(id))
                            .filter(Boolean) as Tag[];
                        return (
                            <DroppableFolderCard
                                key={f.id}
                                folder={f}
                                isSelected={isSelected}
                                count={count}
                                subfolderCount={subfolderCount}
                                folderTags={folderTags}
                                onFolderClick={handleFolderClick}
                                onToggleSelection={toggleItemSelection}
                            />
                        );
                    })}
                    {directConnections.map((c) => (
                        <ConnectionCard
                            key={c.id}
                            connection={c}
                            tags={tags}
                            onTagToggle={onTagToggle}
                            onOpenDbViewer={onOpenDbViewer}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
