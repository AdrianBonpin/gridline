import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Key, Braces } from "lucide-react";
import type { ColumnInfo } from "../../lib/types";
import { abbreviateType } from "../../lib/utils";
import { FkPreviewPopover } from "../db-viewer/FkPreviewPopover";
import { JsonCellPopover, jsonPreview } from "../db-viewer/JsonCellPopover";

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
const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 800;

export function VirtualDataGrid({
  connectionId,
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
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Indeterminate state for partial selection
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedRows.size > 0 && selectedRows.size < rows.length;
    }
  }, [selectedRows.size, rows.length]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  // ── column widths ─────────────────────────────────────

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const getWidth = useCallback(
    (colName: string) => colWidths[colName] ?? DEFAULT_COL_WIDTH,
    [colWidths],
  );

  // Total width for horizontal scroll support
  const totalWidth = 40 + visibleColumns.reduce((sum, c) => sum + getWidth(c.name), 0);

  const resizeRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (colName: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { col: colName, startX: e.clientX, startWidth: getWidth(colName) };

      const onMove = (ev: MouseEvent) => {
        const current = resizeRef.current;
        if (!current) return;
        const delta = ev.clientX - current.startX;
        const next = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, current.startWidth + delta));
        setColWidths((prev) => ({ ...prev, [current.col]: next }));
      };

      const onUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [getWidth],
  );

  const resetWidth = useCallback((colName: string) => {
    setColWidths((prev) => {
      const next = { ...prev };
      delete next[colName];
      return next;
    });
  }, []);

  // ── FK preview popover state ──────────────────────────

  const [fkPreview, setFkPreview] = useState<{
    connectionId: string;
    schema: string;
    table: string;
    column: string;
    value: string;
    anchorRect: DOMRect | null;
  } | null>(null);

  const handleFkClick = useCallback(
    (col: ColumnInfo, cellValue: unknown, e: React.MouseEvent) => {
      if (!col.is_fk || !col.fk_ref || cellValue === null || cellValue === undefined) return;
      const [refTable] = col.fk_ref;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setFkPreview({
        connectionId,
        schema: "",
        table: refTable,
        column: col.fk_ref[1],
        value: String(cellValue),
        anchorRect: rect,
      });
    },
    [connectionId],
  );

  // ── JSON popover state ────────────────────────────────

  const [jsonPopover, setJsonPopover] = useState<{
    value: unknown;
    anchorRect: DOMRect | null;
  } | null>(null);

  // ── cell renderer (shared between header sizing and body) ──

  const renderCell = useCallback(
    (col: ColumnInfo, row: unknown[], _rowIndex: number) => {
      const ci = columns.findIndex((c) => c.name === col.name);
      const cell = ci >= 0 ? row[ci] : undefined;
      const isNull = cell === null || cell === undefined;
      const isFk = col.is_fk && col.fk_ref && !isNull;
      const isJson = !isNull && (col.data_type === "jsonb" || col.data_type === "json");
      const jp = isJson ? jsonPreview(cell) : { label: "", isJson: false };

      const handleJsonClick = (e: React.MouseEvent) => {
        if (isJson) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setJsonPopover({ value: cell, anchorRect: rect });
        }
      };

      return (
        <div
          key={col.name}
          className={`px-3 py-2 font-heading text-xs truncate select-text border-r border-border self-stretch ${
            isFk ? "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-accent" : ""
          } ${isJson ? "cursor-pointer text-accent/80 hover:text-accent" : ""}`}
          role={isFk || isJson ? "button" : undefined}
          tabIndex={isFk || isJson ? 0 : undefined}
          onKeyDown={
            isFk || isJson
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (isFk) handleFkClick(col, cell, e as any);
                    else if (isJson) {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setJsonPopover({ value: cell, anchorRect: rect });
                    }
                  }
                }
              : undefined
          }
          style={{ width: getWidth(col.name), flexShrink: 0 }}
          title={
            isNull
              ? "NULL"
              : isFk
                ? `FK → ${col.fk_ref![0]}.${col.fk_ref![1]}: ${String(cell)}`
                : isJson
                  ? "Click to view JSON"
                  : String(cell)
          }
          onClick={
            isFk
              ? (e) => handleFkClick(col, cell, e)
              : isJson
                ? handleJsonClick
                : undefined
          }
        >
          {isNull ? (
            <span className="italic text-text-muted">NULL</span>
          ) : isJson ? (
            <span className="inline-flex items-center gap-0.5">
              <Braces size={10} className="shrink-0" />
              {jp.label}
            </span>
          ) : (
            String(cell)
          )}
        </div>
      );
    },
    [columns, getWidth, handleFkClick],
  );

  return (
    <div ref={parentRef} className="overflow-auto h-full" style={{ overscrollBehavior: "none" }}>
      {/* ── sticky header ── */}
      <div className="sticky top-0 z-10 bg-canvas">
        <div className="flex items-center border-b border-border" style={{ minWidth: totalWidth }}>
          <div style={{ width: 40, minWidth: 40 }} className="px-2 py-2 flex items-center justify-center border-r border-border self-stretch">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={onToggleAll}
              className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
            />
          </div>
          {visibleColumns.map((col) => (
            <div
              key={col.name}
              className="group relative px-3 py-2 font-heading text-text-muted border-r border-border last:border-r-0 self-stretch"
              style={{ width: getWidth(col.name), flexShrink: 0 }}
            >
              <div className="truncate flex items-center gap-1">
                {col.is_pk && <Key size={10} className="text-accent shrink-0" />}
                {col.is_fk && <Key size={10} className="text-amber-400 shrink-0" />}
                <span className="text-text text-xs">{col.name}</span>
                <span className="text-[10px] text-text-muted/50 shrink-0" title={col.data_type}>
                  {abbreviateType(col.data_type)}
                </span>
              </div>
              <div
                className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize select-none bg-transparent hover:bg-accent/30 active:bg-accent/50"
                onMouseDown={(e) => startResize(col.name, e)}
                onDoubleClick={() => resetWidth(col.name)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── virtual body ── */}
      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-text-muted">
          No rows in result set
        </div>
      ) : (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
            width: "100%",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isSelected = selectedRows.has(virtualRow.index);
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                className={`flex items-center border-b border-border ${
                  isSelected ? "bg-accent/5" : ""
                } hover:bg-surface/50`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  minWidth: totalWidth,
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div style={{ width: 40, minWidth: 40 }} className="flex items-center justify-center border-r border-border self-stretch">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleRow(virtualRow.index)}
                    className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                  />
                </div>
                {visibleColumns.map((col) => renderCell(col, row, virtualRow.index))}
              </div>
            );
          })}
        </div>
      )}

      {/* FK preview popover */}
      {fkPreview && (
        <FkPreviewPopover
          connectionId={fkPreview.connectionId}
          schema={fkPreview.schema}
          table={fkPreview.table}
          column={fkPreview.column}
          value={fkPreview.value}
          anchorRect={fkPreview.anchorRect}
          onClose={() => setFkPreview(null)}
        />
      )}
      {/* JSON cell popover */}
      {jsonPopover && (
        <JsonCellPopover
          value={jsonPopover.value}
          anchorRect={jsonPopover.anchorRect}
          onClose={() => setJsonPopover(null)}
        />
      )}
    </div>
  );
}