import { memo } from "react";
import type { Connection, Tag } from "../../lib/types";
import { DB_ICONS, DB_LABELS } from "../../lib/dbIcons";
import { TagBadge } from "../tags/TagBadge";
import { Check } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

interface ConnectionCardProps {
  connection: Connection;
  tags: Tag[];
  onTagToggle?: (id: string) => void;
}

function ConnectionCardBase({ connection, tags, onTagToggle }: ConnectionCardProps) {
  const selectedItemIds = useUiStore((s) => s.selectedItemIds);
  const toggleItemSelection = useUiStore((s) => s.toggleItemSelection);
  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const cardTags = connection.tag_ids.map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
  const hostLabel = connection.port ? `${connection.host}:${connection.port}` : connection.host;
  const isSelected = selectedItemIds.includes(connection.id);

  return (
    <div className={`relative group rounded-xl border transition-colors ${
      isSelected
        ? "bg-accent/10 border-accent"
        : "bg-surface border-border hover:border-border-hover"
    }`}>
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-xl">
            {DB_ICONS[connection.db_type] ?? "❓"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-text">{connection.name}</div>
            <div className="text-xs text-text-muted">{DB_LABELS[connection.db_type] ?? connection.db_type}</div>
          </div>
        </div>
        <div className="text-xs text-text-muted mb-2 font-mono truncate">{hostLabel}</div>
        <div className="flex gap-1 flex-wrap">
          {cardTags.map((t) => <TagBadge key={t.id} tag={t} onToggle={onTagToggle} />)}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); toggleItemSelection(connection.id); }}
        className={`absolute top-2 left-2 w-5 h-5 rounded border flex items-center justify-center transition-all ${
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