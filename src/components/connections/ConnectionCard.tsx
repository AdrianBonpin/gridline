import { memo } from "react";
import type { Connection, Tag } from "../../lib/types";
import { Card } from "../ui/Card";
import { TagBadge } from "../tags/TagBadge";

const DB_ICONS: Record<string, string> = {
  postgresql: "🐘", mysql: "🐬", redis: "⚡", sqlite: "🗄️",
};
const DB_LABELS: Record<string, string> = {
  postgresql: "PostgreSQL", mysql: "MySQL", redis: "Redis", sqlite: "SQLite",
};

interface ConnectionCardProps {
  connection: Connection;
  tags: Tag[];
  onTagToggle?: (id: string) => void;
}

function ConnectionCardBase({ connection, tags, onTagToggle }: ConnectionCardProps) {
  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const cardTags = connection.tag_ids.map((id) => tagMap.get(id)).filter(Boolean) as Tag[];
  const hostLabel = connection.port ? `${connection.host}:${connection.port}` : connection.host;
  return (
    <Card className="hover:border-accent/50">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center text-xl">{DB_ICONS[connection.db_type] ?? "❓"}</div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{connection.name}</div>
          <div className="text-xs text-white/50">{DB_LABELS[connection.db_type] ?? connection.db_type}</div>
        </div>
      </div>
      <div className="text-xs text-white/60 mb-2 font-mono truncate">{hostLabel}</div>
      <div className="flex gap-1 flex-wrap">
        {cardTags.map((t) => <TagBadge key={t.id} tag={t} onToggle={onTagToggle} />)}
      </div>
    </Card>
  );
}

export const ConnectionCard = memo(ConnectionCardBase);