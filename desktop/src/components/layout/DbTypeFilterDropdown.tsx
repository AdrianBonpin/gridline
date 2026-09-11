import { useEffect, useRef, useState } from "react";
import { Filter } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import type { DbType } from "../../lib/types";

const DB_TYPES: { value: DbType; label: string }[] = [
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "sqlite", label: "SQLite" },
  { value: "redis", label: "Redis" },
];

export function DbTypeFilterDropdown() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeDbTypes = useUiStore((s) => s.activeDbTypes);
  const toggleDbType = useUiStore((s) => s.toggleDbType);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const activeEnvironment = useUiStore((s) => s.activeEnvironment);
  const setEnvironment = useUiStore((s) => s.setEnvironment);

  const activeCount = activeDbTypes.length + (activeEnvironment ? 1 : 0);
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

  const handleClearAll = () => {
    clearFilters();
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
        <Filter size={14} />
        <span>Filters</span>
        {hasActiveFilters && (
          <span className="ml-0.5 flex items-center justify-center min-w-[1.125rem] h-[1.125rem] px-1 rounded-full text-[10px] bg-accent text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-1 z-20 min-w-[12rem] rounded-xl bg-surface border border-border shadow-lg p-1.5">
          <div className="flex flex-col">
            <div className="py-1">
              {DB_TYPES.map((dbType) => {
                const checked = activeDbTypes.includes(dbType.value);
                return (
                  <label
                    key={dbType.value}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                      checked ? "bg-accent/10" : "hover:bg-surface-raised"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDbType(dbType.value)}
                      className="w-4 h-4 rounded border-border accent-accent cursor-pointer"
                    />
                    <span className={checked ? "text-accent" : "text-text"}>
                      {dbType.label}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="px-2 py-2">
              <label className="block text-[10px] uppercase tracking-wider text-text-muted mb-1">
                Environment
              </label>
              <SelectDropdown
                value={activeEnvironment ?? ""}
                onChange={(val) => setEnvironment(val === "" ? null : val)}
                options={[
                  { value: "", label: "All" },
                  { value: "production", label: "Production" },
                  { value: "staging", label: "Staging" },
                  { value: "development", label: "Development" },
                  { value: "none", label: "None" },
                ]}
                placeholder="All"
                aria-label="Environment filter"
              />
            </div>
            <div className="border-t border-border my-1" />
            <button
              onClick={handleClearAll}
              className="w-full text-left px-2 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-raised rounded-lg transition-colors cursor-pointer"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}