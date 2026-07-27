import { useState } from "react";
import { ChevronRight, ChevronDown, Table2, Key, Diamond, Type } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { TableOverflowMenu } from "./TableOverflowMenu";
import * as cmd from "../../lib/commands";

export function TableTree() {
  const tables = useDbViewerStore((s) => s.tables);
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const openTab = useDbViewerStore((s) => s.openTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [columnCache, setColumnCache] = useState<Record<string, string[]>>({});
  const connectionId = useUiStore((s) => s.activeConnectionId);

  const filteredTables = currentSchema
    ? tables.filter((t) => t.schema === currentSchema)
    : tables;

  const toggle = async (key: string, schema: string, tableName: string) => {
    const isExpanded = expanded.has(key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    if (!isExpanded && !columnCache[key] && connectionId) {
      try {
        const result = await cmd.getTableData(connectionId, schema, tableName, 1, 0);
        setColumnCache((prev) => ({ ...prev, [key]: result.columns }));
      } catch {
        /* ignore, columns can't be loaded */
      }
    }
  };

  const handleOpenTab = (schema: string, table: string, forceNew?: boolean) => {
    openTab(schema, table, forceNew);
    return "tab";
  };

  return (
    <div className="py-2">
      {filteredTables.length === 0 && (
        <div className="px-3 py-2 text-sm text-text-muted">No tables</div>
      )}
      {filteredTables.map((table) => {
        const key = `${table.schema}.${table.name}`;
        const isExpanded = expanded.has(key);
        return (
          <div key={key}>
            <div
              className="group flex items-center gap-1 px-3 py-1 hover:bg-surface-raised cursor-pointer"
              onClick={() => openTab(table.schema, table.name)}
            >
              <button
                aria-label={isExpanded ? "Collapse" : "Expand"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(key, table.schema, table.name);
                }}
                className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text cursor-pointer"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Table2 size={14} className="text-text-muted" />
              <span className="flex-1 text-left text-sm text-text group-hover:text-accent truncate">
                {table.name}
              </span>
              <div onClick={(e) => e.stopPropagation()}>
                <TableOverflowMenu
                  schema={table.schema}
                  table={table.name}
                  onOpenTab={handleOpenTab}
                />
              </div>
            </div>
            {isExpanded && (
              <div className="pl-10 pr-3 py-1 space-y-1">
                {(columnCache[key] ?? []).length === 0 && (
                  <div className="text-xs text-text-muted">No columns</div>
                )}
                {(columnCache[key] ?? table.columns?.map((c) => c.name) ?? []).map((colName) => {
                  const colInfo = table.columns?.find((c) => c.name === colName);
                  return (
                    <div
                      key={colName}
                      className="flex items-center gap-2 text-xs text-text-muted"
                      title={colInfo?.data_type ?? colName}
                    >
                      {colInfo?.is_primary_key ? (
                        <Key size={12} className="text-accent" />
                      ) : colInfo?.is_foreign_key ? (
                        <Diamond size={12} className="text-warning" />
                      ) : (
                        <Type size={12} />
                      )}
                      <span className="truncate">{colName}</span>
                      {colInfo?.data_type && (
                        <span className="text-text-subtle truncate">{colInfo.data_type}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}