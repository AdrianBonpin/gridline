import { useState } from "react";
import type { Tag } from "../../lib/types";
import { Search } from "lucide-react";

interface SearchableTagPickerProps {
  tags: Tag[];
  selectedTagIds: string[];
  onToggle: (tagId: string) => void;
}

export function SearchableTagPicker({ tags, selectedTagIds, onToggle }: SearchableTagPickerProps) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? tags.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()))
    : tags;

  return (
    <div className="mt-3">
      <div className="text-xs text-text-muted mb-2">Tags</div>
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tags..."
          className="w-full rounded-full bg-surface border border-border pl-7 pr-3 py-1.5 text-xs text-text placeholder-text-muted/60 focus:outline-none focus:border-accent transition-colors"
        />
      </div>
      <div className="max-h-32 overflow-y-auto space-y-1">
        {filtered.length === 0 && (
          <div className="text-xs text-text-muted py-1">No tags found</div>
        )}
        {filtered.map((tag) => {
          const active = selectedTagIds.includes(tag.id);
          return (
            <button
              key={tag.id}
              onClick={() => onToggle(tag.id)}
              className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-left transition-colors cursor-pointer ${
                active
                  ? "bg-accent/10"
                  : "hover:bg-surface-raised"
              }`}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: tag.color }}
              />
              <span className={active ? "text-accent-muted" : "text-text-muted"}>{tag.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}