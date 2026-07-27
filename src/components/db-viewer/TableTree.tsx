import { useState } from "react";
import { ChevronRight, ChevronDown, Table2, Key, Diamond, Type } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { TableOverflowMenu } from "./TableOverflowMenu";

export function TableTree() {
  const tables = useDbViewerStore((s) => s.tables);
  const currentSchema = useDbViewerStore((s) => s.currentSchema);
  const openTab = useDbViewerStore((s) => s.openTab);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filteredTables = currentSchema
    ? tables.filter((t) => t.schema === currentSchema)
    : tables;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
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
            <div className="group flex items-center gap-1 px-3 py-1 hover:bg-surface-raised">
              <button
                aria-label={isExpanded ? "Collapse" : "Expand"}
                onClick={() => toggle(key)}
                className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text cursor-pointer"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <Table2 size={14} className="text-text-muted" />
              <button
                onClick={() => openTab(table.schema, table.name)}
                className="flex-1 text-left text-sm text-text hover:text-accent cursor-pointer truncate"
              >
                {table.name}
              </button>
              <TableOverflowMenu
                schema={table.schema}
                table={table.name}
                onOpenTab={handleOpenTab}
              />
            </div>
            {isExpanded && (
              <div className="pl-10 pr-3 py-1 space-y-1">
                {(table.columns ?? []).length === 0 && (
                  <div className="text-xs text-text-muted">No columns</div>
                )}
                {(table.columns ?? []).map((column) => (
                  <div
                    key={column.name}
                    className="flex items-center gap-2 text-xs text-text-muted"
                    title={column.data_type}
                  >
                    {column.is_primary_key ? (
                      <Key size={12} className="text-accent" />
                    ) : column.is_foreign_key ? (
                      <Diamond size={12} className="text-warning" />
                    ) : (
                      <Type size={12} />
                    )}
                    <span className="truncate">{column.name}</span>
                    <span className="text-text-subtle truncate">{column.data_type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}