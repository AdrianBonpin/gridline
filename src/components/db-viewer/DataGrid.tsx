import { useCallback, useEffect, useRef, useState } from "react";
import { Key } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { abbreviateType } from "../../lib/utils";

// TODO: Replace this plain HTML table with @tanstack/react-virtual for large
// result sets so we can render millions of rows without DOM overhead.

type ColumnWidths = Record<string, number>;
type TabColumnWidths = Record<string, ColumnWidths>;

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 800;
const CHECKBOX_COL_WIDTH = 40;

interface DataGridProps {
  rows: unknown[][];
  hiddenColumns?: Set<string>;
  selectedRows: Set<number>;
  onSelectionChange: (selected: Set<number>) => void;
}

export function DataGrid({ rows, hiddenColumns, selectedRows, onSelectionChange }: DataGridProps) {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const openTab = useDbViewerStore((state) => state.openTab);
  const setColumnFilter = useDbViewerStore((state) => state.setColumnFilter);
  const [colWidths, setColWidths] = useState<TabColumnWidths>({});

  // ── helpers ────────────────────────────────────────────

  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
  const widths = activeTabId ? (colWidths[activeTabId] ?? {}) : {};

  const getWidth = useCallback(
    (colName: string) => widths[colName] ?? DEFAULT_COL_WIDTH,
    [widths],
  );

  // ── selection logic ────────────────────────────────────

  const allSelected = rows.length > 0 && selectedRows.size === rows.length;
  const someSelected = selectedRows.size > 0 && selectedRows.size < rows.length;
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(rows.map((_, i) => i)));
    }
  };

  const toggleRow = (rowIndex: number) => {
    const next = new Set(selectedRows);
    if (next.has(rowIndex)) next.delete(rowIndex);
    else next.add(rowIndex);
    onSelectionChange(next);
  };

  // ── resize handler (ref-based to avoid stale closures) ─

  const resizeRef = useRef<{ col: string; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (colName: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { col: colName, startX: e.clientX, startWidth: getWidth(colName) };

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const delta = ev.clientX - resizeRef.current.startX;
        const next = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, resizeRef.current.startWidth + delta));
        setColWidths((prev) => ({
          ...prev,
          [activeTabId!]: { ...(prev[activeTabId!] ?? {}), [resizeRef.current!.col]: next },
        }));
      };

      const onUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [activeTabId, getWidth],
  );

  // ── FK row-click handler ───────────────────────────────

  const handleFkClick = useCallback(
    (col: { name: string; is_fk: boolean; fk_ref: [string, string] | null }, cellValue: unknown) => {
      if (!col.is_fk || !col.fk_ref || cellValue === null || cellValue === undefined) return;
      const [refTable, refColumn] = col.fk_ref;
      const schema = activeTab?.schema ?? "public";
      openTab(schema, refTable);
      const newTab = useDbViewerStore.getState().tabs.find(
        (t) => t.schema === schema && t.table === refTable,
      );
      if (newTab) {
        setColumnFilter(newTab.id, refColumn, String(cellValue));
      }
    },
    [activeTab, openTab, setColumnFilter],
  );

  // ── empty / loading / error states ─────────────────────

  if (!activeTabId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a table to view data
      </div>
    );
  }

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a table to view data
      </div>
    );
  }

  if (activeTab.loading && !activeTab.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading...
      </div>
    );
  }

  if (activeTab.error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-red-500">
        {activeTab.error}
      </div>
    );
  }

  if (!activeTab.data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading table data...
      </div>
    );
  }

  const { columns } = activeTab.data;

  // Filter visible columns
  const visibleColumns = hiddenColumns
    ? columns.filter((c) => !hiddenColumns.has(c.name))
    : columns;

  // Apply FK column filter if active
  const filteredRows = (() => {
    let result = rows;
    if (activeTab.columnFilter) {
      const { column, value } = activeTab.columnFilter;
      const colIdx = columns.findIndex((c) => c.name === column);
      if (colIdx >= 0) {
        const needle = value.toLowerCase();
        result = result.filter((row) => {
          const cell = row[colIdx];
          return cell !== null && cell !== undefined && String(cell).toLowerCase().includes(needle);
        });
      }
    }
    return result;
  })();

  return (
    <div
      className="flex-1 overflow-auto min-w-0 relative"
      style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "auto" }}
    >
      {/* Loading indicator bar when refreshing with existing data */}
      {activeTab.loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent z-20 animate-pulse" />
      )}
      <table
        className="border-collapse text-left text-sm"
        style={{ tableLayout: "fixed", width: "100%" }}
      >
        <colgroup>
          {/* Checkbox column */}
          <col style={{ width: CHECKBOX_COL_WIDTH, minWidth: CHECKBOX_COL_WIDTH }} />
          {visibleColumns.map((col) => (
            <col key={col.name} style={{ width: getWidth(col.name) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {/* Header checkbox */}
            <th
              scope="col"
              className="border-b border-r border-border px-0 py-2 w-[40px]"
            >
              <div className="flex items-center justify-center">
                <input
                  ref={checkboxRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                />
              </div>
            </th>
            {visibleColumns.map((col) => (
              <th
                key={col.name}
                scope="col"
                role="columnheader"
                className="group relative border-b border-r border-border px-3 py-2 font-heading text-text-muted last:border-r-0"
                style={{ width: getWidth(col.name), maxWidth: getWidth(col.name) }}
              >
                <div className="truncate flex items-center gap-1">
                  {col.is_pk && <Key size={10} className="text-accent shrink-0" />}
                  {col.is_fk && <Key size={10} className="text-amber-400 shrink-0" />}
                  <span className="text-text text-xs">{col.name}</span>
                  <span className="ml-1 text-[10px] text-text-muted/60" title={col.data_type}>
                    {abbreviateType(col.data_type)}
                  </span>
                </div>
                {/* resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize select-none bg-transparent hover:bg-accent/30 active:bg-accent/50"
                  onMouseDown={(e) => startResize(col.name, e)}
                  onDoubleClick={() => {
                    setColWidths((prev) => ({
                      ...prev,
                      [activeTabId!]: { ...(prev[activeTabId!] ?? {}), [col.name]: DEFAULT_COL_WIDTH },
                    }));
                  }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredRows.map((row, rowIndex) => {
            const isSelected = selectedRows.has(rowIndex);
            return (
              <tr
                key={rowIndex}
                className={`border-b border-border hover:bg-surface/50 ${isSelected ? "bg-accent/5" : ""}`}
              >
                {/* Row checkbox */}
                <td className="border-r border-border px-0 py-2" style={{ overflow: "hidden" }}>
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(rowIndex)}
                      className="w-3.5 h-3.5 rounded border-border cursor-pointer accent-accent"
                    />
                  </div>
                </td>
                {visibleColumns.map((col) => {
                  const ci = columns.findIndex((c) => c.name === col.name);
                  const cell = ci >= 0 ? row[ci] : undefined;
                  const isNull = cell === null || cell === undefined;
                  const isFk = col.is_fk && col.fk_ref && !isNull;

                  return (
                    <td key={col.name} className="border-r border-border px-3 py-2 last:border-r-0 font-heading text-xs" style={{ overflow: "hidden" }}>
                      <div
                        className={`truncate max-w-full ${isFk ? "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-accent" : ""}`}
                        title={isNull ? "NULL" : isFk ? `FK → ${col!.fk_ref![0]}.${col!.fk_ref![1]}: ${String(cell)}` : String(cell)}
                        onClick={isFk ? () => handleFkClick(col!, cell) : undefined}
                        role={isFk ? "button" : undefined}
                        tabIndex={isFk ? 0 : undefined}
                        onKeyDown={isFk ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleFkClick(col!, cell); } } : undefined}
                      >
                        {isNull ? (
                          <span className="italic text-text-muted">NULL</span>
                        ) : (
                          String(cell)
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}