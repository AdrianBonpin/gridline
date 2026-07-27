import { RefreshCw, Plus, Search } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Tooltip } from "../ui/Tooltip";

export function DbViewerToolbar() {
  const databases = useDbViewerStore((s) => s.databases);
  const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
  const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
  const schemas = useDbViewerStore((s) => s.schemas);
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);

  return (
    <div className="p-3 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">Tables</span>
        <div className="flex items-center gap-1">
          <Tooltip content="Refresh Database" side="bottom">
            <button
              aria-label="Refresh"
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
            >
              <RefreshCw size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Create Table" side="bottom">
            <button
              aria-label="Create Table"
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer opacity-50"
            >
              <Plus size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Search Tables" side="bottom">
            <button
              aria-label="Search Tables"
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer opacity-50"
            >
              <Search size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      {databases.length > 1 && (
        <SelectDropdown
          value={currentDatabase ?? ""}
          onChange={setCurrentDatabase}
          options={databases.map((d) => ({ value: d, label: d }))}
          placeholder="Select database"
          aria-label="Select database"
        />
      )}
      {schemas.length > 1 && (
        <SelectDropdown
          value={currentSchema ?? ""}
          onChange={setCurrentSchema}
          options={schemas.map((s) => ({ value: s, label: s }))}
          placeholder="Select schema"
          aria-label="Select schema"
        />
      )}
    </div>
  );
}