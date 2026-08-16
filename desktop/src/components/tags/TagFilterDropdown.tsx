import { useEffect, useRef, useState } from "react";
import { Tag as TagIcon } from "lucide-react";
import { useSortedTags } from "../../hooks/useSortedTags";
import { useUiStore } from "../../stores/uiStore";

export function TagFilterDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tags = useSortedTags();
  const activeTagIds = useUiStore((s) => s.activeTagIds);
  const toggleTag = useUiStore((s) => s.toggleTag);
  const openSettings = useUiStore((s) => s.openSettings);

  const activeCount = activeTagIds.length;
  const hasActiveFilters = activeCount > 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleManageTags = () => {
    openSettings();
    setOpen(false);
  };

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all cursor-pointer ${
          hasActiveFilters
            ? "bg-accent/10 border-accent text-accent"
            : "bg-transparent border-border text-text-muted hover:text-text hover:border-border-hover"
        }`}
      >
        <TagIcon size={14} />
        <span>Tags</span>
        {hasActiveFilters && (
          <span className="ml-0.5 flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] bg-accent text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-1 z-20 min-w-[12rem] rounded-xl bg-surface border border-border shadow-lg p-1.5">
          {tags.length === 0 ? (
            <div className="p-3 text-center">
              <div className="text-xs text-text-muted mb-2">No tags yet</div>
              <button
                onClick={handleManageTags}
                className="text-xs text-accent hover:underline cursor-pointer"
              >
                Create in Settings
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="max-h-48 overflow-y-auto py-1">
                {tags.map((tag) => {
                  const checked = activeTagIds.includes(tag.id);
                  return (
                    <label
                      key={tag.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        checked ? "bg-accent/10" : "hover:bg-surface-raised"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTag(tag.id)}
                        className="w-4 h-4 rounded border-border accent-accent cursor-pointer"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className={checked ? "text-accent" : "text-text"}>
                        {tag.name}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="border-t border-border my-1" />
              <button
                onClick={handleManageTags}
                className="w-full text-left px-2 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-raised rounded-lg transition-colors cursor-pointer"
              >
                Manage tags
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}