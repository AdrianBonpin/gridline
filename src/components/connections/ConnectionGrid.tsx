import type { Connection, Folder, Tag } from "../../lib/types";
import { Folder as FolderIcon, Check } from "lucide-react";
import { ConnectionCard } from "./ConnectionCard";
import { FolderBreadcrumb } from "../folders/FolderBreadcrumb";
import { getChildFolders } from "../../lib/utils";
import { useUiStore } from "../../stores/uiStore";

interface ConnectionGridProps {
    connections: Connection[];
    tags: Tag[];
    folders?: Folder[];
    activeFolderId?: string | null;
    onFolderSelect?: (id: string | null) => void;
    hasSearch?: boolean;
    onTagToggle?: (id: string) => void;
}

export function ConnectionGrid({
    connections,
    tags,
    folders = [],
    activeFolderId = null,
    onFolderSelect,
    hasSearch = false,
    onTagToggle,
}: ConnectionGridProps) {
    const selectedItemIds = useUiStore((s) => s.selectedItemIds);
    const toggleItemSelection = useUiStore((s) => s.toggleItemSelection);
    const clearSelection = useUiStore((s) => s.clearSelection);

    const currentFolderId =
        activeFolderId !== null && folders.some((f) => f.id === activeFolderId)
            ? activeFolderId
            : null;
    const visibleFolders = getChildFolders(folders, currentFolderId);
    const directConnections = connections.filter(
        (c) => c.folder_id === currentFolderId,
    );
    const hasItems = visibleFolders.length > 0 || directConnections.length > 0;
    const isSelecting = selectedItemIds.length > 0;

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
            <FolderBreadcrumb
                folders={folders}
                activeFolderId={currentFolderId}
                onNavigate={handleBreadcrumbNavigate}
            />

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
                        const count = directConnections.filter(
                            (c) => c.folder_id === f.id,
                        ).length;
                        const subfolderCount = getChildFolders(
                            folders,
                            f.id,
                        ).length;
                        return (
                            <div
                                key={f.id}
                                className={`relative group rounded-xl border transition-colors ${
                                    isSelected
                                        ? "bg-accent/10 border-accent"
                                        : "bg-surface border-border hover:border-border-hover"
                                }`}
                            >
                                <button
                                    onClick={() => handleFolderClick(f.id)}
                                    className="w-full p-3 text-left min-w-0"
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
                                            {f.name}
                                        </span>
                                    </div>
                                    <div className="text-xs text-text-muted mt-1">
                                        {count > 0 &&
                                            `${count} item${count !== 1 ? "s" : ""}`}
                                        {count > 0 &&
                                            subfolderCount > 0 &&
                                            " · "}
                                        {subfolderCount > 0 &&
                                            `${subfolderCount} subfolder${subfolderCount !== 1 ? "s" : ""}`}
                                        {count === 0 &&
                                            subfolderCount === 0 &&
                                            "Empty folder"}
                                    </div>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleItemSelection(f.id);
                                    }}
                                    className={`absolute -top-1 -left-1 w-4 h-4 rounded border flex items-center justify-center transition-all ${
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
                    })}
                    {directConnections.map((c) => (
                        <ConnectionCard
                            key={c.id}
                            connection={c}
                            tags={tags}
                            onTagToggle={onTagToggle}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
