import { X, Copy } from "lucide-react";
import type { ColumnInfo } from "../../lib/types";

interface Props {
  columns: ColumnInfo[];
  row: unknown[];
  onClose: () => void;
  onCopy: (value: string) => void;
}
function fmt(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}
export function RowDetailDrawer({ columns, row, onClose, onCopy }: Props) {
  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-canvas border-l border-border z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text">Row detail</span>
        <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text"><X size={16} /></button>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {columns.map((c, i) => {
          const v = row[i];
          const isJson = c.data_type === "json" || c.data_type === "jsonb";
          const text = fmt(v);
          return (
            <div key={c.name} className="border border-border rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text">{c.name}</span>
                <button onClick={() => onCopy(text)} aria-label={`Copy ${c.name}`} className="text-text-muted hover:text-text"><Copy size={12} /></button>
              </div>
              <pre className={`text-xs mt-1 whitespace-pre-wrap break-all ${isJson ? "font-mono text-accent/80" : "text-text-muted"}`}>{text}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}