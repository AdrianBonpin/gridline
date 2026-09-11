import { Table2 } from "lucide-react";
import type { HypertableInfo } from "../../lib/types";

function humanBytes(bytes: number | null): string {
  if (bytes === null) return "unknown size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function HypertableDetail({
  item,
  onOpenTable,
}: {
  item: HypertableInfo;
  onOpenTable: (schema: string, table: string) => void;
}) {
  return (
    <div className="mt-1 space-y-2">
      <div className="text-sm text-text">{item.name}</div>
      <div className="flex flex-wrap gap-2 text-xs text-text-muted">
        <span className="rounded bg-surface-raised px-2 py-1">{item.num_dimensions} dimensions</span>
        <span className="rounded bg-surface-raised px-2 py-1">
          {item.compression_enabled ? "compression enabled" : "compression disabled"}
        </span>
        <span className="rounded bg-surface-raised px-2 py-1">{item.num_chunks} chunks</span>
        <span className="rounded bg-surface-raised px-2 py-1">{humanBytes(item.total_size_bytes)}</span>
      </div>
      <button
        type="button"
        onClick={() => onOpenTable(item.schema, item.name)}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
      >
        <Table2 size={13} /> View table
      </button>
      <p className="text-xs text-text-subtle">
        Note: Copy DDL exports the table as plain SQL plus its create_hypertable call. A
        full-fidelity restore needs TimescaleDB pre/post-restore hooks, which Gridline does
        not run.
      </p>
    </div>
  );
}
