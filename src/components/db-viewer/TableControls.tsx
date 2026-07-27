import { useState, useRef, useEffect } from "react";
import {
  Plus, RefreshCw, Clock, Filter, ArrowUpDown, Download,
  Columns, Check, ChevronLeft, ChevronRight, X, Trash2,
} from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import type { ColumnInfo } from "../../lib/types";

const AUTO_REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
] as const;

const PAGE_SIZES = [50, 100, 200] as const;

const EXPORT_FORMATS = [
  { label: "JSON", ext: "json" },
  { label: "CSV", ext: "csv" },
  { label: "SQL", ext: "sql" },
  { label: "Markdown", ext: "md" },
] as const;

type FilterRule = {
  id: string;
  column: string;
  operator: "eq" | "neq" | "contains" | "starts" | "ends" | "gt" | "lt" | "null" | "notnull";
  value: string;
};

type SortRule = {
  id: string;
  column: string;
  order: "asc" | "desc";
};

// ─── helpers ────────────────────────────────────────────

function exportData(
  rows: unknown[][],
  columns: ColumnInfo[],
  format: string,
  tableName: string,
) {
  const headers = columns.map((c) => c.name);
  let content: string;
  let mime: string;

  switch (format) {
    case "json": {
      const jsonRows = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((c, i) => { obj[c.name] = row[i] ?? null; });
        return obj;
      });
      content = JSON.stringify(jsonRows, null, 2);
      mime = "application/json";
      break;
    }
    case "csv": {
      const csvRows = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];
      for (const row of rows) {
        csvRows.push(
          row.map((cell) => {
            const s = cell === null || cell === undefined ? "" : String(cell);
            return `"${s.replace(/"/g, '""')}"`;
          }).join(","),
        );
      }
      content = csvRows.join("\n");
      mime = "text/csv";
      break;
    }
    case "sql": {
      const lines = [`-- ${tableName}`];
      for (const row of rows) {
        const vals = row.map((cell) =>
          cell === null ? "NULL"
          : typeof cell === "number" ? String(cell)
          : `'${String(cell).replace(/'/g, "''")}'`,
        );
        lines.push(`INSERT INTO ${tableName} (${headers.join(", ")}) VALUES (${vals.join(", ")});`);
      }
      content = lines.join("\n");
      mime = "application/sql";
      break;
    }
    case "md": {
      const mdRows = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
      for (const row of rows) {
        mdRows.push(`| ${row.map((cell) => cell === null ? "*NULL*" : String(cell)).join(" | ")} |`);
      }
      content = mdRows.join("\n");
      mime = "text/markdown";
      break;
    }
    default:
      return;
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${tableName}.${format === "md" ? "md" : format}`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── sub-components ─────────────────────────────────────

function DropdownMenu({
  open,
  setOpen,
  align,
  children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute top-full mt-1 z-30 min-w-48 rounded-lg bg-surface border border-border shadow-lg py-1 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

function FilterModal({
  columns,
  rules,
  onChange,
  open,
  setOpen,
}: {
  columns: ColumnInfo[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen]);

  if (!open) return null;

  const addRule = () => {
    onChange([
      ...rules,
      { id: crypto.randomUUID(), column: columns[0]?.name ?? "", operator: "contains", value: "" },
    ]);
  };

  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const updateRule = (id: string, patch: Partial<FilterRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-30 w-96 rounded-lg bg-surface border border-border shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text">Column Filters</span>
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text">
          <X size={14} />
        </button>
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-1.5 mb-1.5">
          <select
            value={rule.column}
            onChange={(e) => updateRule(rule.id, { column: e.target.value })}
            className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0"
          >
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select
            value={rule.operator}
            onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterRule["operator"] })}
            className="w-24 rounded border border-border bg-surface text-xs px-1 py-1 text-text"
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="contains">contains</option>
            <option value="starts">starts with</option>
            <option value="ends">ends with</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
            <option value="null">is null</option>
            <option value="notnull">not null</option>
          </select>
          {rule.operator !== "null" && rule.operator !== "notnull" && (
            <input
              type="text"
              value={rule.value}
              onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              placeholder="value"
              className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0"
            />
          )}
          <button type="button" onClick={() => removeRule(rule.id)} className="text-text-muted hover:text-red-400 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="text-xs text-accent hover:underline mt-1"
      >
        + Add filter
      </button>
    </div>
  );
}

function SortModal({
  columns,
  rules,
  onChange,
  open,
  setOpen,
}: {
  columns: ColumnInfo[];
  rules: SortRule[];
  onChange: (rules: SortRule[]) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen]);

  if (!open) return null;

  const addRule = () => {
    onChange([
      ...rules,
      { id: crypto.randomUUID(), column: columns[0]?.name ?? "", order: "asc" },
    ]);
  };

  const removeRule = (id: string) => onChange(rules.filter((r) => r.id !== id));
  const updateRule = (id: string, patch: Partial<SortRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 z-30 w-72 rounded-lg bg-surface border border-border shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text">Sort Rules</span>
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text">
          <X size={14} />
        </button>
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-1.5 mb-1.5">
          <select
            value={rule.column}
            onChange={(e) => updateRule(rule.id, { column: e.target.value })}
            className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0"
          >
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select
            value={rule.order}
            onChange={(e) => updateRule(rule.id, { order: e.target.value as "asc" | "desc" })}
            className="w-20 rounded border border-border bg-surface text-xs px-1 py-1 text-text"
          >
            <option value="asc">ASC</option>
            <option value="desc">DESC</option>
          </select>
          <button type="button" onClick={() => removeRule(rule.id)} className="text-text-muted hover:text-red-400 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="text-xs text-accent hover:underline mt-1"
      >
        + Add sort
      </button>
    </div>
  );
}

// ─── main component ─────────────────────────────────────

interface TableControlsProps {
  connectionId: string;
  schema: string;
  table: string;
  columns: ColumnInfo[];
  rows: unknown[][];
  hiddenColumns: Set<string>;
  onToggleColumn: (col: string) => void;
  onRefresh: () => void;
  filterRules: FilterRule[];
  onFilterChange: (rules: FilterRule[]) => void;
  sortRules: SortRule[];
  onSortChange: (rules: SortRule[]) => void;
}

export function TableControls({
  connectionId: _connectionId,
  schema,
  table,
  columns,
  rows,
  hiddenColumns,
  onToggleColumn,
  onRefresh,
  filterRules,
  onFilterChange,
  sortRules,
  onSortChange,
}: TableControlsProps) {
  const tabs = useDbViewerStore((s) => s.tabs);
  const activeTabId = useDbViewerStore((s) => s.activeTabId);
  const setPage = useDbViewerStore((s) => s.setPage);
  const setPageSize = useDbViewerStore((s) => s.setPageSize);
  const openTab = useDbViewerStore((s) => s.openTab);
  const addChange = useDbViewerStore((s) => s.addChange);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // local state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(0);

  // auto-refresh timer
  useEffect(() => {
    if (autoRefresh === 0) return;
    const id = setInterval(onRefresh, autoRefresh);
    return () => clearInterval(id);
  }, [autoRefresh, onRefresh]);

  // pagination
  const totalRows = activeTab?.data?.total_rows ?? rows.length;
  const pageSize = activeTab?.pageSize ?? 50;
  const currentPage = activeTab?.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const clampedPage = Math.max(1, Math.min(currentPage, totalPages));
  const startRow = (clampedPage - 1) * pageSize + 1;
  const endRow = Math.min(clampedPage * pageSize, totalRows);

  const handlePrev = () => {
    if (clampedPage > 1 && activeTabId) setPage(activeTabId, clampedPage - 1);
  };
  const handleNext = () => {
    if (clampedPage < totalPages && activeTabId) setPage(activeTabId, clampedPage + 1);
  };

  const handlePageSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (activeTabId) setPageSize(activeTabId, Number(e.target.value));
  };

  const handleInsertRow = () => {
    const newData: Record<string, unknown> = {};
    columns.forEach((c) => { newData[c.name] = null; });
    addChange({
      type: "insert",
      schema,
      table,
      primaryKey: {},
      newData,
      description: `Insert row into ${table}`,
    });
    openTab(schema, table);
  };

  const handleExport = (format: string) => {
    exportData(rows, columns, format, table);
    setExportOpen(false);
  };

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 bg-surface/50 text-xs text-text-muted">
      {/* ── left side ──────────────────────────────── */}
      <div className="flex items-center gap-1">
        {/* Insert Row */}
        <button
          type="button"
          onClick={handleInsertRow}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors"
          aria-label="Insert row"
          title="Insert row"
        >
          <Plus size={14} />
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>

        {/* Auto-refresh */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => (v === 0 ? 5000 : 0))}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors ${
              autoRefresh > 0 ? "text-accent" : "hover:text-text"
            }`}
            aria-label="Auto-refresh"
            title={`Auto-refresh: ${autoRefresh > 0 ? `${autoRefresh / 1000}s` : "Off"}`}
          >
            <Clock size={14} />
            {autoRefresh > 0 && <span className="text-[10px] font-medium">{autoRefresh / 1000}s</span>}
          </button>
          <DropdownMenu open={autoRefresh > 0} setOpen={() => setAutoRefresh(0)}>
            {AUTO_REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAutoRefresh(opt.value)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-surface-raised transition-colors ${
                  autoRefresh === opt.value ? "text-accent" : "text-text"
                }`}
              >
                {autoRefresh === opt.value && <Check size={12} />}
                <span className={autoRefresh === opt.value ? "" : "ml-5"}>{opt.label}</span>
              </button>
            ))}
          </DropdownMenu>
        </div>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Filter */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors ${
              filterRules.length > 0 ? "text-accent" : "hover:text-text"
            }`}
            aria-label="Column filters"
            title="Column filters"
          >
            <Filter size={14} />
            <span>Filter</span>
            {filterRules.length > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                {filterRules.length}
              </span>
            )}
          </button>
          <FilterModal
            columns={columns}
            rules={filterRules}
            onChange={onFilterChange}
            open={filterOpen}
            setOpen={setFilterOpen}
          />
        </div>

        {/* Sort */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSortOpen((v) => !v)}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors ${
              sortRules.length > 0 ? "text-accent" : "hover:text-text"
            }`}
            aria-label="Sort rules"
            title="Sort rules"
          >
            <ArrowUpDown size={14} />
            <span>Sort</span>
            {sortRules.length > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                {sortRules.length}
              </span>
            )}
          </button>
          <SortModal
            columns={columns}
            rules={sortRules}
            onChange={onSortChange}
            open={sortOpen}
            setOpen={setSortOpen}
          />
        </div>

        {/* Export */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setExportOpen((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors"
            aria-label="Export"
            title="Export"
          >
            <Download size={14} />
            <span>Export</span>
          </button>
          <DropdownMenu open={exportOpen} setOpen={setExportOpen}>
            {EXPORT_FORMATS.map((fmt) => (
              <button
                key={fmt.ext}
                type="button"
                onClick={() => handleExport(fmt.ext)}
                className="w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors"
              >
                {fmt.label}
              </button>
            ))}
          </DropdownMenu>
        </div>
      </div>

      {/* ── spacer ──────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── right side ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Columns toggle */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setColumnMenuOpen((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors"
            aria-label="Toggle columns"
            title="Show/hide columns"
          >
            <Columns size={14} />
            <span>Columns</span>
          </button>
          <DropdownMenu open={columnMenuOpen} setOpen={setColumnMenuOpen} align="right">
            <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">Visible columns</div>
            <div className="max-h-64 overflow-y-auto">
              {columns.map((col) => (
                <button
                  key={col.name}
                  type="button"
                  onClick={() => onToggleColumn(col.name)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors"
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    hiddenColumns.has(col.name) ? "border-border bg-transparent" : "border-accent bg-accent"
                  }`}>
                    {!hiddenColumns.has(col.name) && <Check size={10} className="text-white" />}
                  </span>
                  <span className="truncate">{col.name}</span>
                </button>
              ))}
            </div>
          </DropdownMenu>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Row count */}
        <span className="tabular-nums">
          {startRow}-{endRow} of {totalRows}
        </span>

        {/* Page size */}
        <select
          value={pageSize}
          onChange={handlePageSizeChange}
          className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text outline-none focus:border-accent"
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        {/* Pagination */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handlePrev}
            disabled={clampedPage <= 1}
            className="rounded p-0.5 hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none transition-colors"
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="tabular-nums min-w-[3rem] text-center">
            {clampedPage}/{totalPages}
          </span>
          <button
            type="button"
            onClick={handleNext}
            disabled={clampedPage >= totalPages}
            className="rounded p-0.5 hover:bg-surface-raised disabled:opacity-30 disabled:pointer-events-none transition-colors"
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}