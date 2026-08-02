import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Key, Braces } from "lucide-react";
import type { ColumnInfo } from "../../lib/types";
import { abbreviateType } from "../../lib/utils";
import { FkPreviewPopover } from "../db-viewer/FkPreviewPopover";
import { JsonCellPopover, jsonPreview } from "../db-viewer/JsonCellPopover";
import { CellEditor, type FkOption } from "./CellEditor";
import { CellContextMenu } from "./CellContextMenu";
import { cellToUpdateChange, isCellEditable } from "./gridEditability";
import { nextCell, type CellPos } from "./keyboardNav";

interface VirtualDataGridProps {
  connectionId: string;
  schema: string;
  table?: string;
  rows: unknown[][];
  columns: ColumnInfo[];
  hiddenColumns: Set<string>;
  selectedRows: Set<number>;
  onToggleRow: (rowIndex: number) => void;
  onToggleAll: () => void;
  dbType?: string;
  tabType?: "table" | "query";
  onStageEdit?: (payload: {
    type: "update";
    schema: string;
    table: string;
    primaryKey: Record<string, unknown>;
    oldData: Record<string, unknown>;
    newData: Record<string, unknown>;
  }) => void;
  onOpenRowDetail?: (rowIndex: number) => void;
  getLocator?: (row: unknown[]) => Record<string, unknown>;
  readOnly?: boolean;
  /** When set, renders a pending-edit indicator on the staged cell at (row, col). */
  pendingCell?: { row: number; col: number } | null;
  /** Enum labels keyed by column NAME → renders a <select> in the CellEditor. */
  enumValues?: Record<string, string[]>;
  /** Foreign-key reference rows keyed by column NAME → renders a searchable dropdown in the CellEditor. */
  fkOptions?: Record<string, FkOption[]>;
}

const ROW_HEIGHT = 36;
const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 800;

export function VirtualDataGrid({
  connectionId,
  schema,
  table = "",
  rows,
  columns,
  hiddenColumns,
  selectedRows,
  onToggleRow,
  onToggleAll,
  dbType = "postgresql",
  tabType = "table",
  onStageEdit,
  onOpenRowDetail,
  getLocator,
  readOnly = false,
  pendingCell = null,
  enumValues,
  fkOptions,
}: VirtualDataGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.name));
  const hasColumns = columns.length > 0;
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

  // ── focus / editing / context menu / row detail state ──

  const [activeCell, setActiveCell] = useState<CellPos | null>(null);
  const [editingCell, setEditingCell] = useState<CellPos | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ pos: DOMRect; row: number; col: number } | null>(null);

  // Reset transient focus state when the data shape changes.
  useEffect(() => {
    setActiveCell(null);
    setEditingCell(null);
    setCtxMenu(null);
  }, [rows.length, columns.length, hiddenColumns.size]);

  // Document-level Escape: cancels in-cell editing even when the editor input
  // has lost focus, and closes the context menu when open.
  useEffect(() => {
    const editing = editingCell != null;
    const menuOpen = ctxMenu != null;
    if (!editing && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing) {
        setEditingCell(null);
        setActiveCell(null);
      }
      if (menuOpen) setCtxMenu(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingCell != null, ctxMenu != null]);

  // ── column widths ─────────────────────────────────────

  const [colWidths, setColWidths] = useState<Record<string, number>>({});

  const getWidth = useCallback(
    (colName: string) => colWidths[colName] ?? DEFAULT_COL_WIDTH,
    [colWidths],
  );

  // Total width for horizontal scroll support
  const totalWidth =
    (hasColumns ? 40 : 0) +
    visibleColumns.reduce((sum, c) => sum + getWidth(c.name), 0);

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
        schema,
        table: refTable,
        column: col.fk_ref[1],
        value: String(cellValue),
        anchorRect: rect,
      });
    },
    [connectionId, schema],
  );

  // ── JSON popover state ────────────────────────────────

  const [jsonPopover, setJsonPopover] = useState<{
    value: unknown;
    anchorRect: DOMRect | null;
  } | null>(null);

  // ── keyboard navigation ───────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingCell) return;
      if (!activeCell) return;

      const keyLabel = e.key === "Tab" ? (e.shiftKey ? "Shift+Tab" : "Tab") : e.key;

      if (keyLabel.startsWith("Arrow") || keyLabel === "Tab" || keyLabel === "Shift+Tab") {
        e.preventDefault();
        const next = nextCell(activeCell, keyLabel, rows.length, visibleColumns.length);
        setActiveCell(next);
        virtualizer.scrollToIndex(next.row);
        return;
      }

      if (e.key === "Enter") {
        const col = visibleColumns[activeCell.col];
        if (col && isCellEditable(col, tabType, dbType, readOnly)) {
          e.preventDefault();
          setEditingCell(activeCell);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setActiveCell(null);
        return;
      }

      if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const col = visibleColumns[activeCell.col];
        if (!col) return;
        const ci = columns.findIndex((c) => c.name === col.name);
        const value = rows[activeCell.row]?.[ci];
        navigator.clipboard.writeText(String(value));
      }
    },
    [activeCell, columns, dbType, editingCell, rows, tabType, visibleColumns, virtualizer],
  );

  // ── cell renderer (shared between header sizing and body) ──

  const renderCell = useCallback(
    (col: ColumnInfo, row: unknown[], rowIndex: number, colIndex: number) => {
      const ci = columns.findIndex((c) => c.name === col.name);
      const cell = ci >= 0 ? row[ci] : undefined;
      const isNull = cell === null || cell === undefined;
      const isFk = col.is_fk && col.fk_ref && !isNull;
      const isJson = !isNull && (col.data_type === "jsonb" || col.data_type === "json");
      const jp = isJson ? jsonPreview(cell) : { label: "", isJson: false };
      const editable = isCellEditable(col, tabType, dbType, readOnly);
      const isActive = activeCell?.row === rowIndex && activeCell?.col === colIndex;
      const isEditing = editingCell?.row === rowIndex && editingCell?.col === colIndex;
      const isPending = pendingCell?.row === rowIndex && pendingCell?.col === colIndex;

      const handleJsonClick = (e: React.MouseEvent) => {
        if (isJson) {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setJsonPopover({ value: cell, anchorRect: rect });
        }
      };

      const commitEdit = (committed: string | null) => {
        if (committed !== (isNull ? null : cell)) {
          const locator = getLocator?.(row) ?? {};
          onStageEdit?.(
            cellToUpdateChange({
              schema,
              table,
              primaryKey: locator,
              oldData: { [col.name]: cell },
              newData: { [col.name]: committed },
            }) as {
              type: "update";
              schema: string;
              table: string;
              primaryKey: Record<string, unknown>;
              oldData: Record<string, unknown>;
              newData: Record<string, unknown>;
            },
          );
        }
        setEditingCell(null);
      };

      return (
        <div
          key={col.name}
          className={`relative px-3 py-2 font-heading text-xs truncate select-text border-r border-border self-stretch ${
            isFk ? "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-accent" : ""
          } ${isJson ? "cursor-pointer text-accent/80 hover:text-accent" : ""} ${
            isActive ? "bg-accent/10 ring-1 ring-inset ring-accent outline-none" : ""
          }`}
          role={isFk || isJson ? "button" : undefined}
          tabIndex={isFk || isJson ? 0 : -1}
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
          onClick={(e) => {
            setActiveCell({ row: rowIndex, col: colIndex });
            if (isFk) handleFkClick(col, cell, e);
            else if (isJson) handleJsonClick(e);
          }}
          onDoubleClick={() => {
            if (editable) setEditingCell({ row: rowIndex, col: colIndex });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCtxMenu({ pos: rect, row: rowIndex, col: colIndex });
            setActiveCell({ row: rowIndex, col: colIndex });
          }}
        >
          {isEditing ? (
            <div className="absolute inset-0 z-20" onClick={(e) => e.stopPropagation()}>
              <CellEditor
                initialValue={isNull ? "" : String(cell)}
                dataType={col.data_type}
                nullable={col.is_nullable}
                enumValues={enumValues?.[col.name]}
                fkOptions={fkOptions?.[col.name]}
                onCommit={commitEdit}
                onCancel={() => setEditingCell(null)}
              />
            </div>
          ) : isNull ? (
            <span className="italic text-text-muted">NULL</span>
          ) : isJson ? (
            <span className="inline-flex items-center gap-0.5">
              <Braces size={10} className="shrink-0" />
              {jp.label}
            </span>
          ) : (
            String(cell)
          )}
          {isPending && (
            <span
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400"
              data-testid="pending-edit-dot"
            />
          )}
        </div>
      );
    },
    [activeCell, columns, dbType, editingCell, enumValues, fkOptions, getLocator, handleFkClick, onStageEdit, schema, table, tabType, getWidth, pendingCell],
  );

  // ── context menu helpers ──────────────────────────────

  const ctxCol = ctxMenu ? visibleColumns[ctxMenu.col] : null;
  const copyCellValue = useCallback(
    async (row: number, col: number) => {
      const column = visibleColumns[col];
      if (!column) return;
      const ci = columns.findIndex((c) => c.name === column.name);
      const value = rows[row]?.[ci];
      await navigator.clipboard.writeText(String(value));
    },
    [columns, rows, visibleColumns],
  );

  const stageNull = useCallback(
    (row: number, col: number) => {
      const column = visibleColumns[col];
      if (!column || !isCellEditable(column, tabType, dbType, readOnly)) return;
      const ci = columns.findIndex((c) => c.name === column.name);
      const value = rows[row]?.[ci];
      if (value === null || value === undefined) return;
      const locator = getLocator?.(rows[row]) ?? {};
      onStageEdit?.(
        cellToUpdateChange({
          schema,
          table,
          primaryKey: locator,
          oldData: { [column.name]: value },
          newData: { [column.name]: null },
        }) as {
          type: "update";
          schema: string;
          table: string;
          primaryKey: Record<string, unknown>;
          oldData: Record<string, unknown>;
          newData: Record<string, unknown>;
        },
      );
    },
    [columns, dbType, getLocator, onStageEdit, readOnly, rows, schema, table, tabType, visibleColumns],
  );

  return (
    <div
      ref={parentRef}
      className="overflow-auto h-full outline-none"
      style={{ overscrollBehavior: "none" }}
      tabIndex={-1}
      role="grid"
      onKeyDown={handleKeyDown}
    >
      {/* ── sticky header (hidden when no columns/table open) ── */}
      {hasColumns && (
        <div className="sticky top-0 z-10">
          <div className="flex items-center border-b border-border bg-canvas" style={{ width: totalWidth }}>
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
                className="group relative px-3 py-2 font-heading text-text-muted border-r border-border self-stretch"
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
      )}

      {/* ── virtual body (hidden when no columns/table open) ── */}
      {!hasColumns ? null : rows.length === 0 ? (
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
                {hasColumns && (
                  <div
                    style={{ width: 40, minWidth: 40 }}
                    className="flex items-center justify-center border-r border-border self-stretch"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleRow(virtualRow.index)}
                      className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                    />
                  </div>
                )}
                {visibleColumns.map((col, i) => renderCell(col, row, virtualRow.index, i))}
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
      {/* Cell context menu */}
      {ctxMenu && ctxCol && (
        <>
          {/* Click-outside-to-close backdrop (below the z-50 menu) */}
          <div
            className="fixed inset-0 z-40"
            data-testid="ctx-backdrop"
            onClick={() => setCtxMenu(null)}
          />
          <CellContextMenu
            anchorRect={ctxMenu.pos}
            editable={isCellEditable(ctxCol, tabType, dbType, readOnly)}
            isJson={ctxCol.data_type === "jsonb" || ctxCol.data_type === "json"}
            isFk={ctxCol.is_fk && ctxCol.fk_ref != null}
            nullable={ctxCol.is_nullable}
            onCopy={() => {
              void copyCellValue(ctxMenu.row, ctxMenu.col);
              setCtxMenu(null);
            }}
            onCopyJson={() => {
              void copyCellValue(ctxMenu.row, ctxMenu.col);
              setCtxMenu(null);
            }}
            onViewRow={() => {
              onOpenRowDetail?.(ctxMenu.row);
              setCtxMenu(null);
            }}
            onSelectRow={() => {
              onToggleRow(ctxMenu.row);
              setCtxMenu(null);
            }}
            onEdit={() => {
              setActiveCell({ row: ctxMenu.row, col: ctxMenu.col });
              setEditingCell({ row: ctxMenu.row, col: ctxMenu.col });
              setCtxMenu(null);
            }}
            onSetNull={() => {
              stageNull(ctxMenu.row, ctxMenu.col);
              setCtxMenu(null);
            }}
            onOpenFk={() => {
              if (ctxCol?.is_fk && ctxCol.fk_ref) {
                // Resolve the column index into `rows` (ctxMenu.col indexes visibleColumns,
                // which can differ when columns are hidden).
                const ci = columns.findIndex((c) => c.name === ctxCol.name);
                const cellValue = rows[ctxMenu.row]?.[ci];
                if (cellValue !== null && cellValue !== undefined) {
                  setFkPreview({
                    connectionId,
                    schema,
                    table: ctxCol.fk_ref[0],
                    column: ctxCol.fk_ref[1],
                    value: String(cellValue),
                    anchorRect: ctxMenu.pos,
                  });
                }
              }
              setCtxMenu(null);
            }}
            onClose={() => setCtxMenu(null)}
          />
        </>
      )}
    </div>
  );
}