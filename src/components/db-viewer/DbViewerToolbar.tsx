import { RefreshCw, Plus, Search, Pencil } from "lucide-react";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Tooltip } from "../ui/Tooltip";

export function DbViewerToolbar({
  databases,
  currentDatabase,
  setCurrentDatabase,
  schemas,
  currentSchema,
  setCurrentSchema,
  onEdit,
}: {
  databases: string[];
  currentDatabase: string | null;
  setCurrentDatabase: (db: string | null) => void;
  schemas: string[];
  currentSchema: string | null;
  setCurrentSchema: (schema: string | null) => void;
  onEdit?: () => void;
}) {

  return (
    <div className="p-3 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text">Tables</span>
        <div className="flex items-center gap-1">
          {onEdit && (
            <Tooltip content="Edit Connection" side="bottom">
              <button
                aria-label="Edit Connection"
                onClick={onEdit}
                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
              >
                <Pencil size={14} />
              </button>
            </Tooltip>
          )}
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