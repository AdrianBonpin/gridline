import { useState } from "react";
import type { Tag } from "../../lib/types";
import { Search } from "lucide-react";
import { useConnectionStore } from "../../stores/connectionStore";

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
          <div className="py-2 text-xs text-text-muted">
            {tags.length === 0 ? (
              <>
                <p>No tags yet.</p>
                <InlineTagCreator onCreated={onToggle} />
              </>
            ) : (
              <p>No tags match your search.</p>
            )}
          </div>
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

function InlineTagCreator({ onCreated }: { onCreated: (tagId: string) => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#8b5cf6");
  const [show, setShow] = useState(false);

  if (!show) {
    return (
      <button onClick={() => setShow(true)} className="text-accent hover:underline cursor-pointer text-xs">
        Create first tag
      </button>
    );
  }

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      await useConnectionStore.getState().createTag({ name: name.trim(), color });
      const tags = useConnectionStore.getState().tags;
      const created = tags.find((t) => t.name === name.trim());
      if (created) onCreated(created.id);
      setName("");
      setShow(false);
    } catch {
      // silent
    }
  };

  const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#d946ef", "#ec4899", "#6b7280"];

  return (
    <div className="space-y-2 p-2 border border-border rounded-lg bg-canvas">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tag name"
        className="w-full rounded-full bg-surface border border-border px-3 py-1.5 text-xs text-text placeholder-text-muted/60 focus:outline-none focus:border-accent transition-colors"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") setShow(false);
        }}
      />
      <div className="flex gap-1 flex-wrap">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full border-2 transition-colors cursor-pointer ${color === c ? "border-text" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={handleCreate} className="text-xs text-white bg-accent rounded-full px-3 py-1 cursor-pointer hover:bg-accent-hover transition-colors">
          Create
        </button>
        <button onClick={() => setShow(false)} className="text-xs text-text-muted cursor-pointer hover:text-text">
          Cancel
        </button>
      </div>
    </div>
  );
}