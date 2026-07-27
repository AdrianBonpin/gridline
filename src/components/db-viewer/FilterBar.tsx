import { Search, ToggleLeft, ToggleRight } from "lucide-react";

export interface FilterBarProps {
  filterText: string;
  onFilterChange: (text: string) => void;
  enabled: boolean;
  onToggle: () => void;
}

export function FilterBar({ filterText, onFilterChange, enabled, onToggle }: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 bg-surface/50">
      <button
        type="button"
        onClick={onToggle}
        aria-label={enabled ? "Disable filter" : "Enable filter"}
        className="shrink-0 text-text-muted hover:text-text transition-colors"
      >
        {enabled ? <ToggleRight size={16} className="text-accent" /> : <ToggleLeft size={16} />}
      </button>
      <Search size={14} className="shrink-0 text-text-muted" />
      <input
        type="text"
        value={filterText}
        onChange={(e) => onFilterChange(e.target.value)}
        disabled={!enabled}
        placeholder="Filter rows..."
        aria-label="Filter rows"
        className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted/60 outline-none border-none py-0.5 disabled:opacity-40"
      />
      {filterText && enabled && (
        <button
          type="button"
          onClick={() => onFilterChange("")}
          aria-label="Clear filter"
          className="shrink-0 text-xs text-text-muted hover:text-text transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}