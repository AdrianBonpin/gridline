import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Key, X, ExternalLink, Loader2 } from "lucide-react";
import * as cmd from "../../lib/commands";
import type { QueryResult } from "../../lib/types";
import { abbreviateType } from "../../lib/utils";
import { useDbViewerStore } from "../../stores/dbViewerStore";

interface FkPreviewPopoverProps {
  connectionId: string;
  schema: string;
  table: string;
  column: string;
  value: string;
  anchorRect: DOMRect | null;
  onClose: () => void;
}

export function FkPreviewPopover({
  connectionId,
  schema,
  table,
  column,
  value,
  anchorRect,
  onClose,
}: FkPreviewPopoverProps) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const openTab = useDbViewerStore((s) => s.openTab);
  const setColumnFilter = useDbViewerStore((s) => s.setColumnFilter);

  const handleOpen = () => {
    openTab(schema, table);
    // Find the newly created tab and apply the column filter
    const newTab = useDbViewerStore.getState().tabs.find(
      (t) => t.schema === schema && t.table === table,
    );
    if (newTab) {
      setColumnFilter(newTab.id, column, value);
    }
    onClose();
  };

  // Fetch the referenced row
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    cmd
      .getFkPreview(connectionId, schema, table, column, value)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table, column, value]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately from the same click that opened it
    const id = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  // Compute position to keep popover within viewport
  const popoverWidth = 360;
  const popoverMaxHeight = 320;
  const gap = 8;
  let left = anchorRect.left;
  let top = anchorRect.bottom + gap;

  // Flip horizontally if off-screen
  if (left + popoverWidth > window.innerWidth - 16) {
    left = Math.max(16, window.innerWidth - popoverWidth - 16);
  }
  // Flip vertically if not enough space below
  if (top + popoverMaxHeight > window.innerHeight - 16) {
    top = anchorRect.top - popoverMaxHeight - gap;
    if (top < 16) top = 16;
  }

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-50 bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
      style={{
        left,
        top,
        width: popoverWidth,
        maxHeight: popoverMaxHeight,
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface/80">
        <div className="flex items-center gap-1.5 min-w-0">
          <Key size={12} className="text-amber-400 shrink-0" />
          <span className="text-xs font-heading text-text truncate">
            {schema}.{table}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpen}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded hover:bg-accent/10 text-accent transition-colors cursor-pointer"
            title="Open table in new tab"
          >
            <ExternalLink size={11} />
            <span>Open</span>
          </button>
          <button
            onClick={onClose}
            className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto" style={{ maxHeight: popoverMaxHeight - 41 }}>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            Loading...
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center py-4 text-xs text-red-500 px-3">
            {error}
          </div>
        )}
        {data && data.rows.length === 0 && !loading && (
          <div className="flex items-center justify-center py-4 text-xs text-text-muted">
            No matching row found
          </div>
        )}
        {data && data.rows.length > 0 && (
          <table className="w-full text-xs">
            <tbody>
              {data.columns.map((col, ci) => {
                const cell = data.rows[0][ci];
                const isNull = cell === null || cell === undefined;
                return (
                  <tr
                    key={col.name}
                    className="border-b border-border last:border-0 hover:bg-surface/30"
                  >
                    <td className="px-3 py-1.5 text-text-muted font-heading whitespace-nowrap w-1/3">
                      <div className="flex items-center gap-1">
                        {col.is_pk && <Key size={9} className="text-accent shrink-0" />}
                        {col.is_fk && <Key size={9} className="text-amber-400 shrink-0" />}
                        <span className="truncate">{col.name}</span>
                        <span
                          className="text-[10px] text-text-muted/50 shrink-0"
                          title={col.data_type}
                        >
                          {abbreviateType(col.data_type)}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-text">
                      {isNull ? (
                        <span className="italic text-text-muted">NULL</span>
                      ) : (
                        <span className="break-all">{String(cell)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>,
    document.body,
  );
}