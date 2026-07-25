import type { Connection, Tag } from "../../lib/types";
import { ConnectionCard } from "./ConnectionCard";

interface ConnectionGridProps {
  connections: Connection[];
  tags: Tag[];
  hasSearch?: boolean;
  onTagToggle?: (id: string) => void;
}

export function ConnectionGrid({ connections, tags, hasSearch = false, onTagToggle }: ConnectionGridProps) {
  if (connections.length === 0) {
    return (
      <div className="text-center py-16 text-white/50">
        {hasSearch ? "No connections match your search." : "No connections yet. Create one to get started."}
      </div>
    );
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {connections.map((c) => <ConnectionCard key={c.id} connection={c} tags={tags} onTagToggle={onTagToggle} />)}
    </div>
  );
}