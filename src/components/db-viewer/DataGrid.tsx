import { useCallback, useState } from "react";
import { useDbViewerStore } from "../../stores/dbViewerStore";

// TODO: Replace this plain HTML table with @tanstack/react-virtual for large
// result sets so we can render millions of rows without DOM overhead.

type ColumnWidths = Record<string, number>;
type TabColumnWidths = Record<string, ColumnWidths>;

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 600;

export function DataGrid() {
  const tabs = useDbViewerStore((state) => state.tabs);
  const activeTabId = useDbViewerStore((state) => state.activeTabId);
  const [colWidths, setColWidths] = useState<TabColumnWidths>({});

  // ── helpers ────────────────────────────────────────────

  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;
  const widths = activeTabId ? (colWidths[activeTabId] ?? {}) : {};

  const getWidth = useCallback(
    (colName: string) => widths[colName] ?? DEFAULT_COL_WIDTH,
    [widths],
  );

  // ── resize handler ─────────────────────────────────────

  const startResize = useCallback(
    (colName: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = getWidth(colName);

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, startWidth + delta));
        setColWidths((prev) => ({
          ...prev,
          [activeTabId!]: { ...(prev[activeTabId!] ?? {}), [colName]: next },
        }));
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [activeTabId, getWidth],
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

  if (activeTab.loading) {
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

  // Columns from Rust are ColumnInfo objects (name, data_type, …).
  // Rows are Vec<Vec<serde_json::Value>> indexed positionally.
  const { columns, rows } = activeTab.data;

  return (
    <div className="flex-1 overflow-auto">
      <table className="table-fixed border-collapse text-left text-sm" style={{ minWidth: "100%" }}>
        <colgroup>
          {columns.map((col) => (
            <col key={col.name} style={{ width: getWidth(col.name) }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-10 bg-surface">
          <tr>
            {columns.map((col) => (
              <th
                key={col.name}
                scope="col"
                role="columnheader"
                className="group relative border-b border-border px-3 py-2 font-heading text-text-muted"
              >
                <div className="truncate">
                  <span className="text-text text-xs">{col.name}</span>
                  <span className="ml-1.5 text-[10px] text-text-muted/60">
                    {col.data_type}
                  </span>
                </div>
                {/* resize handle */}
                <div
                  className="absolute right-0 top-0 h-full w-[6px] cursor-col-resize select-none opacity-0 group-hover:opacity-100 hover:bg-accent/30 active:bg-accent/50 transition-opacity"
                  onMouseDown={(e) => startResize(col.name, e)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-border hover:bg-surface/50"
            >
              {row.map((cell, ci) => {
                const isNull = cell === null || cell === undefined;
                return (
                  <td key={columns[ci]?.name ?? ci} className="px-3 py-2">
                    <div className="truncate max-w-full" title={isNull ? "NULL" : String(cell)}>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}