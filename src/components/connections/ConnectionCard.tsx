import { memo } from "react";
import type { Connection, Tag } from "../../lib/types";
import { DB_ICONS, DB_LABELS } from "../../lib/dbIcons";
import { ENV_LABELS, ENV_COLORS } from "../../lib/environment";
import { TagBadge } from "../tags/TagBadge";
import { Check, GripVertical } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

interface ConnectionCardProps {
    connection: Connection;
    tags: Tag[];
    onTagToggle?: (id: string) => void;
    onOpenDbViewer?: (connectionId: string) => void;
}

function ConnectionCardBase({
    connection,
    tags,
    onTagToggle,
    onOpenDbViewer,
}: ConnectionCardProps) {
    const selectedItemIds = useUiStore((s) => s.selectedItemIds);
    const toggleItemSelection = useUiStore((s) => s.toggleItemSelection);

    const { attributes, listeners, setNodeRef, transform, isDragging } =
        useDraggable({
            id: connection.id,
            data: { type: "connection", connection },
        });

    const style: React.CSSProperties = {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? "grabbing" : "default",
    };
    const tagMap = new Map(tags.map((t) => [t.id, t]));
    const cardTags = connection.tag_ids
        .map((id) => tagMap.get(id))
        .filter(Boolean) as Tag[];
    const hostLabel = connection.port
        ? `${connection.host}:${connection.port}`
        : connection.host;
    const isSelected = selectedItemIds.includes(connection.id);

    const handleClick = () => {
        if (selectedItemIds.length > 0) {
            // Something already selected — toggle this item in the selection
            toggleItemSelection(connection.id);
        } else {
            // Nothing selected — open the connection
            onOpenDbViewer?.(connection.id);
        }
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={handleClick}
            className={`relative group rounded-xl border transition-colors cursor-pointer ${
                isSelected
                    ? "bg-accent/10 border-accent"
                    : "bg-surface border-border hover:border-border-hover"
            }`}
        >
            <div
                {...listeners}
                {...attributes}
                className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab z-10"
                aria-label="Drag to move connection"
            >
                <GripVertical size={14} className="text-text-muted" />
            </div>
            <div className="p-4">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-xl">
                        {DB_ICONS[connection.db_type] ?? "❓"}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-semibold truncate text-text">
                            {connection.name}
                        </div>
                        <div className="text-xs text-text-muted">
                            {DB_LABELS[connection.db_type] ??
                                connection.db_type}
                        </div>
                    </div>
                    {connection.environment && (
                        <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${ENV_COLORS[connection.environment] ?? "bg-surface-raised border-border text-text-muted"}`}
                        >
                            {ENV_LABELS[connection.environment] ?? connection.environment}
                        </span>
                    )}
                </div>
                <div className="text-xs text-text-muted mb-2 font-mono truncate">
                    {hostLabel}
                </div>
                <div className="flex gap-1 flex-wrap">
                    {cardTags.map((t) => (
                        <TagBadge key={t.id} tag={t} onToggle={onTagToggle} />
                    ))}
                </div>
            </div>
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    toggleItemSelection(connection.id);
                }}
                className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded border flex items-center justify-center transition-all ${
                    isSelected
                        ? "bg-accent border-accent opacity-100"
                        : "border-border bg-surface opacity-0 group-hover:opacity-100"
                }`}
            >
                {isSelected && <Check size={12} className="text-white" />}
            </button>
        </div>
    );
}

export const ConnectionCard = memo(ConnectionCardBase);
