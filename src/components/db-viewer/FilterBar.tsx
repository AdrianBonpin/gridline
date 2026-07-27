import { useState, useRef, useEffect } from "react";
import { Search, ToggleLeft, ToggleRight, Columns, Check } from "lucide-react";

export interface FilterBarProps {
  filterText: string;
  onFilterChange: (text: string) => void;
  enabled: boolean;
  onToggle: () => void;
  columns: { name: string }[];
  hiddenColumns: Set<string>;
  onToggleColumn: (colName: string) => void;
}

export function FilterBar({
  filterText,
  onFilterChange,
  enabled,
  onToggle,
  columns,
  hiddenColumns,
  onToggleColumn,
}: FilterBarProps) {
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!colMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setColMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [colMenuOpen]);

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

      {/* column visibility dropdown */}
      <div className="relative shrink-0" ref={menuRef}>
        <button
          type="button"
          onClick={() => setColMenuOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
          aria-label="Toggle columns"
        >
          <Columns size={14} />
          <span>Columns</span>
        </button>
        {colMenuOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-lg bg-surface border border-border shadow-lg z-30 py-1 max-h-64 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">Visible columns</div>
            {columns.map((col) => (
              <button
                key={col.name}
                type="button"
                onClick={() => onToggleColumn(col.name)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  hiddenColumns.has(col.name) ? "border-border bg-transparent" : "border-accent bg-accent"
                }`}>
                  {!hiddenColumns.has(col.name) && <Check size={10} className="text-white" />}
                </span>
                <span className="truncate">{col.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}