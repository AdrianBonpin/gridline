import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Key } from "lucide-react";
import type { ColumnInfo } from "../../lib/types";
import { abbreviateType } from "../../lib/utils";

interface VirtualDataGridProps {
  connectionId: string;
  rows: unknown[][];
  columns: ColumnInfo[];
  hiddenColumns: Set<string>;
  selectedRows: Set<number>;
  onToggleRow: (rowIndex: number) => void;
  onToggleAll: () => void;
}

const ROW_HEIGHT = 36;

export function VirtualDataGrid({
  connectionId: _connectionId,
  rows,
  columns,
  hiddenColumns,
  selectedRows,
  onToggleRow,
  onToggleAll,
}: VirtualDataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.name));
  const allSelected = rows.length > 0 && selectedRows.size === rows.length;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  return (
    <div ref={parentRef} className="overflow-auto h-full" style={{ overscrollBehavior: "none" }}>
      {rows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-text-muted">
          No rows in result set
        </div>
      ) : (
        <table className="border-collapse text-left text-sm" style={{ tableLayout: "fixed", width: "100%" }}>
          <colgroup>
            <col style={{ width: 40, minWidth: 40 }} />
            {visibleColumns.map((col) => (
              <col key={col.name} style={{ width: 200 }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th className="border-b border-r border-border px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                />
              </th>
              {visibleColumns.map((col) => (
                <th
                  key={col.name}
                  className="group relative border-b border-r border-border px-3 py-2 font-heading text-text-muted last:border-r-0"
                >
                  <div className="truncate flex items-center gap-1">
                    {col.is_pk && <Key size={10} className="text-accent shrink-0" />}
                    {col.is_fk && <Key size={10} className="text-amber-400 shrink-0" />}
                    <span className="text-text text-xs">{col.name}</span>
                    <span className="text-[10px] text-text-muted/50 shrink-0" title={col.data_type}>
                      {abbreviateType(col.data_type)}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: virtualizer.getTotalSize() }}>
              <td style={{ padding: 0 }} colSpan={visibleColumns.length + 1}>
                <div style={{ position: "relative" }}>
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const row = rows[virtualRow.index];
                    const isSelected = selectedRows.has(virtualRow.index);
                    return (
                      <div
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        className={`flex items-center border-b border-border ${isSelected ? "bg-accent/5" : ""} hover:bg-surface/50`}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div style={{ width: 40 }} className="flex justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleRow(virtualRow.index)}
                            className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                          />
                        </div>
                        {visibleColumns.map((col) => {
                          const ci = columns.findIndex((c) => c.name === col.name);
                          const cell = ci >= 0 ? row[ci] : undefined;
                          const isNull = cell === null || cell === undefined;
                          return (
                            <div
                              key={col.name}
                              className="px-3 py-2 font-heading text-xs truncate select-text"
                              style={{ width: 200, flexShrink: 0 }}
                              title={isNull ? "NULL" : String(cell)}
                            >
                              {isNull ? (
                                <span className="italic text-text-muted">NULL</span>
                              ) : (
                                String(cell)
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}