import { RefreshCw, Plus, Search, Pencil, Check, AlertCircle } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Tooltip } from "../ui/Tooltip";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import * as cmd from "../../lib/commands";

export function DbViewerToolbar({
  databases,
  currentDatabase,
  setCurrentDatabase,
  schemas,
  currentSchema,
  setCurrentSchema,
  onEdit,
  connectionId,
}: {
  databases: string[];
  currentDatabase: string | null;
  setCurrentDatabase: (db: string | null) => void;
  schemas: string[];
  currentSchema: string | null;
  setCurrentSchema: (schema: string | null) => void;
  onEdit?: () => void;
  connectionId?: string;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle');
  const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const populate = useDbViewerStore((s) => s.populate);

  // Cleanup result timer on unmount
  useEffect(() => {
    return () => { if (resultTimer.current) clearTimeout(resultTimer.current); };
  }, []);

  const handleRefresh = useCallback(async () => {
    if (!connectionId || refreshing) return;
    setRefreshing(true);
    setResult('idle');
    try {
      const dbs = await cmd.getDatabases(connectionId);
      const scs = await cmd.getSchemas(connectionId);
      const tbls = await cmd.getTables(connectionId);
      populate(dbs, scs, tbls);
      setResult('success');
    } catch {
      setResult('error');
    } finally {
      setRefreshing(false);
      resultTimer.current = setTimeout(() => setResult('idle'), 1500);
    }
  }, [connectionId, refreshing, populate]);

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
          <Tooltip content={result === 'success' ? 'Refreshed' : result === 'error' ? 'Refresh failed' : 'Refresh Database'} side="bottom">
            <button
              aria-label="Refresh"
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer disabled:opacity-50"
            >
              {refreshing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : result === 'success' ? (
                <Check size={14} className="text-emerald-400" />
              ) : result === 'error' ? (
                <AlertCircle size={14} className="text-red-400" />
              ) : (
                <RefreshCw size={14} />
              )}
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