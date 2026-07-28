import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { Table2, Eye, ChevronUp, ChevronDown, Key, ArrowRight } from "lucide-react";
import type { TableNode as TableNodeType } from "../../lib/types";
import { abbreviateType } from "../../lib/utils";

export interface SchemaVisualizerNodeData {
  table: TableNodeType;
  isExternal: boolean;
  onExpandExternal?: (schema: string, table: string) => void;
}

interface SchemaVisualizerNodeProps {
  id: string;
  data: SchemaVisualizerNodeData;
  selected: boolean;
}

export const SchemaVisualizerNode = memo(function SchemaVisualizerNode({
  data,
  selected,
}: SchemaVisualizerNodeProps) {
  const { table, isExternal, onExpandExternal } = data;
  const [collapsed, setCollapsed] = useState(false);
  const isView = table.table_type === "VIEW";

  const visibleColumns = collapsed
    ? table.columns.filter((c) => c.is_pk || c.is_fk || c.is_unique)
    : table.columns;

  const handleClick = () => {
    if (isExternal && onExpandExternal) {
      onExpandExternal(table.schema, table.name);
    }
  };

  const cardClass = [
    "rounded-none border bg-surface min-w-[220px] text-xs font-mono",
    selected ? "border-accent shadow-lg shadow-accent/10" : "border-border",
    isExternal ? "opacity-50 border-dashed cursor-pointer" : "",
  ].join(" ");

  return (
    <div className={cardClass} onClick={handleClick}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border bg-surface-raised">
        <div className="flex items-center gap-1.5">
          {isView ? (
            <Eye size={12} className="text-text-muted" />
          ) : (
            <Table2 size={12} className="text-text-muted" />
          )}
          <span className="font-semibold text-text truncate max-w-[160px]">
            {table.schema}.{table.name}
          </span>
        </div>
        {!isExternal && (
          <button
            type="button"
            aria-label={collapsed ? "Expand columns" : "Collapse columns"}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted"
            onClick={(e) => {
              e.stopPropagation();
              setCollapsed(!collapsed);
            }}
          >
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        )}
      </div>

      {/* Column rows */}
      <div>
        {visibleColumns.map((col) => (
          <div
            key={col.name}
            className="flex items-center justify-between px-2 py-1 border-b border-border last:border-b-0 hover:bg-surface-hover relative"
          >
            {/* Left side: badges + name */}
            <div className="flex items-center gap-1">
              {col.is_pk && <Key size={10} className="text-amber-400 shrink-0" />}
              {col.is_fk && !col.is_pk && (
                <ArrowRight size={10} className="text-accent shrink-0" />
              )}
              <span className="text-text truncate max-w-[120px]">{col.name}</span>
            </div>
            {/* Right side: type */}
            <span className="text-text-muted text-[10px] shrink-0 ml-2">
              {abbreviateType(col.data_type)}
            </span>

            {/* FK source handle */}
            {col.is_fk && (
              <Handle
                type="source"
                position={Position.Right}
                id={`fk-${col.name}`}
                className="!w-2 !h-2 !bg-accent !border-2 !border-canvas"
                style={{ top: "50%", right: -5 }}
              />
            )}
            {/* PK target handle */}
            {col.is_pk && (
              <Handle
                type="target"
                position={Position.Left}
                id={`pk-${col.name}`}
                className="!w-2 !h-2 !bg-amber-400 !border-2 !border-canvas"
                style={{ top: "50%", left: -5 }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Show collapsed count */}
      {collapsed && table.columns.length > visibleColumns.length && (
        <div className="px-2 py-1 text-[10px] text-text-muted border-t border-border">
          +{table.columns.length - visibleColumns.length} more columns
        </div>
      )}
    </div>
  );
});