import { useState, useRef, useEffect } from "react";
import {
  Plus, RefreshCw, Clock, Filter, ArrowUpDown, Download,
  Columns, Check, ChevronLeft, ChevronRight, X, Trash2,
  ChevronDown, FileJson, FileText, Terminal,
} from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { Tooltip } from "../ui/Tooltip";
import type { ColumnInfo } from "../../lib/types";

const AUTO_REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
] as const;

const PAGE_SIZES = [100, 500, 1000, 2000] as const;

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
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text cursor-pointer">
          <X size={14} />
        </button>
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-1.5 mb-1.5">
          <select
            value={rule.column}
            onChange={(e) => updateRule(rule.id, { column: e.target.value })}
            className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0 cursor-pointer"
          >
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select
            value={rule.operator}
            onChange={(e) => updateRule(rule.id, { operator: e.target.value as FilterRule["operator"] })}
            className="w-24 rounded border border-border bg-surface text-xs px-1 py-1 text-text cursor-pointer"
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
          <button type="button" onClick={() => removeRule(rule.id)} className="text-text-muted hover:text-red-400 shrink-0 cursor-pointer">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="text-xs text-accent hover:underline mt-1 cursor-pointer"
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
        <button type="button" onClick={() => setOpen(false)} className="text-text-muted hover:text-text cursor-pointer">
          <X size={14} />
        </button>
      </div>
      {rules.map((rule) => (
        <div key={rule.id} className="flex items-center gap-1.5 mb-1.5">
          <select
            value={rule.column}
            onChange={(e) => updateRule(rule.id, { column: e.target.value })}
            className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0 cursor-pointer"
          >
            {columns.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <select
            value={rule.order}
            onChange={(e) => updateRule(rule.id, { order: e.target.value as "asc" | "desc" })}
            className="w-20 rounded border border-border bg-surface text-xs px-1 py-1 text-text cursor-pointer"
          >
            <option value="asc">ASC</option>
            <option value="desc">DESC</option>
          </select>
          <button type="button" onClick={() => removeRule(rule.id)} className="text-text-muted hover:text-red-400 shrink-0 cursor-pointer">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRule}
        className="text-xs text-accent hover:underline mt-1 cursor-pointer"
      >
        + Add sort
      </button>
    </div>
  );
}

// ─── bulk actions dropdown ──────────────────────────────

function BulkActionsDropdown({
  columns,
  selectedRows,
  schema,
  table,
  onClearSelection,
}: {
  columns: ColumnInfo[];
  selectedRows: unknown[][];
  schema: string;
  table: string;
  onClearSelection: () => void;
}) {
  const [open, setOpen] = useState(false);
  const addChange = useDbViewerStore((s) => s.addChange);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setOpen(false);
  };

  const handleCopyJSON = () => {
    const json = selectedRows.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => { obj[c.name] = row[i] ?? null; });
      return obj;
    });
    copyToClipboard(JSON.stringify(json, null, 2));
  };

  const handleCopyCSV = () => {
    const headers = columns.map((c) => c.name);
    const csvRows = [headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(",")];
    for (const row of selectedRows) {
      csvRows.push(
        row.map((cell) => {
          const s = cell === null || cell === undefined ? "" : String(cell);
          return `"${s.replace(/"/g, '""')}"`;
        }).join(","),
      );
    }
    copyToClipboard(csvRows.join("\n"));
  };

  const handleCopySQL = () => {
    const headers = columns.map((c) => c.name);
    const lines: string[] = [];
    for (const row of selectedRows) {
      const vals = row.map((cell) =>
        cell === null ? "NULL"
        : typeof cell === "number" ? String(cell)
        : `'${String(cell).replace(/'/g, "''")}'`,
      );
      lines.push(`INSERT INTO ${schema}.${table} (${headers.join(", ")}) VALUES (${vals.join(", ")});`);
    }
    copyToClipboard(lines.join("\n"));
  };

  const handleDeleteSelected = () => {
    const pkCol = columns.find((c) => c.is_pk);
    for (const row of selectedRows) {
      const pk: Record<string, unknown> = {};
      if (pkCol) {
        const ci = columns.findIndex((c) => c.name === pkCol.name);
        if (ci >= 0) pk[pkCol.name] = row[ci] ?? null;
      }
      addChange({
        type: "delete",
        schema,
        table,
        primaryKey: pk,
        oldData: Object.fromEntries(columns.map((c, i) => [c.name, row[i] ?? null])),
        description: `Delete row from ${table}`,
      });
    }
    setOpen(false);
    onClearSelection();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-surface-raised transition-colors cursor-pointer"
      >
        <span className="text-xs font-medium">Actions</span>
        <ChevronDown size={12} />
      </button>
      <DropdownMenu open={open} setOpen={setOpen} align="right">
        <button
          type="button"
          onClick={handleCopyJSON}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <FileJson size={13} className="text-text-muted" />
          Copy as JSON
        </button>
        <button
          type="button"
          onClick={handleCopyCSV}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <FileText size={13} className="text-text-muted" />
          Copy as CSV
        </button>
        <button
          type="button"
          onClick={handleCopySQL}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <Terminal size={13} className="text-text-muted" />
          Copy as SQL INSERT
        </button>
        <div className="border-t border-border my-1" />
        <button
          type="button"
          onClick={handleDeleteSelected}
          className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-red-400 hover:bg-surface-raised transition-colors cursor-pointer"
        >
          <Trash2 size={13} />
          Delete selected rows
        </button>
      </DropdownMenu>
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
  selectedCount: number;
  selectedRows: unknown[][];
  onClearSelection: () => void;
  defaultRefreshRate?: number;
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
  selectedCount,
  selectedRows,
  onClearSelection,
  defaultRefreshRate = 0,
}: TableControlsProps) {
  const tabs = useDbViewerStore((s) => s.tabs);
  const activeTabId = useDbViewerStore((s) => s.activeTabId);
  const setPage = useDbViewerStore((s) => s.setPage);
  const setPageSize = useDbViewerStore((s) => s.setPageSize);
  const openTab = useDbViewerStore((s) => s.openTab);
  const addChange = useDbViewerStore((s) => s.addChange);
  const changesQueue = useDbViewerStore((s) => s.changesQueue);
  const cancelChange = useDbViewerStore((s) => s.cancelChange);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // local state
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(defaultRefreshRate);
  const [autoRefreshOpen, setAutoRefreshOpen] = useState(false);

  // auto-refresh timer
  useEffect(() => {
    if (autoRefresh === 0) return;
    const id = setInterval(onRefresh, autoRefresh);
    return () => clearInterval(id);
  }, [autoRefresh, onRefresh]);

  // pagination
  const totalRows = activeTab?.data?.total_rows ?? rows.length;
  const pageSize = activeTab?.pageSize ?? 500;
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
        <Tooltip content="Insert row" side="bottom">
          <button
            type="button"
            onClick={handleInsertRow}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
            aria-label="Insert row"
          >
            <Plus size={14} />
          </button>
        </Tooltip>

        {/* Refresh */}
        <Tooltip content="Refresh" side="bottom">
          <button
            type="button"
            onClick={onRefresh}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
            aria-label="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </Tooltip>

        {/* Auto-refresh */}
        <div className="relative">
          <Tooltip content={`Auto-refresh: ${autoRefresh > 0 ? `${autoRefresh / 1000}s` : "Off"}`} side="bottom">
            <button
              type="button"
              onClick={() => setAutoRefreshOpen((v) => !v)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors cursor-pointer ${
                autoRefresh > 0 ? "text-accent" : "hover:text-text"
              }`}
              aria-label="Auto-refresh"
            >
              <Clock size={14} />
              {autoRefresh > 0 && <span className="text-[10px] font-medium">{autoRefresh / 1000}s</span>}
            </button>
          </Tooltip>
          <DropdownMenu open={autoRefreshOpen} setOpen={setAutoRefreshOpen}>
            {AUTO_REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setAutoRefresh(opt.value); setAutoRefreshOpen(false); }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-surface-raised transition-colors cursor-pointer ${
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
          <Tooltip content="Column filters" side="bottom">
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors cursor-pointer ${
                filterRules.length > 0 ? "text-accent" : "hover:text-text"
              }`}
              aria-label="Column filters"
            >
              <Filter size={14} />
              {filterRules.length > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                  {filterRules.length}
                </span>
              )}
            </button>
          </Tooltip>
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
          <Tooltip content="Sort rules" side="bottom">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised transition-colors cursor-pointer ${
                sortRules.length > 0 ? "text-accent" : "hover:text-text"
              }`}
              aria-label="Sort rules"
            >
              <ArrowUpDown size={14} />
              {sortRules.length > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-accent text-white text-[10px] font-bold">
                  {sortRules.length}
                </span>
              )}
            </button>
          </Tooltip>
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
          <Tooltip content="Export" side="bottom">
            <button
              type="button"
              onClick={() => setExportOpen((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
              aria-label="Export"
            >
              <Download size={14} />
            </button>
          </Tooltip>
          <DropdownMenu open={exportOpen} setOpen={setExportOpen}>
            {EXPORT_FORMATS.map((fmt) => (
              <button
                key={fmt.ext}
                type="button"
                onClick={() => handleExport(fmt.ext)}
                className="w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
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
        {/* Action queue button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setQueueOpen((v) => !v)}
            className={`relative flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors cursor-pointer ${
              changesQueue.some((c) => c.status === "pending")
                ? "text-amber-400 hover:bg-surface-raised"
                : "text-text-muted hover:text-text hover:bg-surface-raised"
            }`}
            aria-label="Action queue"
          >
            <span className="text-xs font-medium">Queue</span>
            {changesQueue.filter((c) => c.status === "pending").length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[16px] h-4 rounded-full bg-amber-500 text-[10px] font-bold text-white px-1">
                {changesQueue.filter((c) => c.status === "pending").length}
              </span>
            )}
          </button>
          <DropdownMenu open={queueOpen} setOpen={setQueueOpen} align="right">
            <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">
              Changes Queue ({changesQueue.filter((c) => c.status === "pending").length} pending)
            </div>
            <div className="max-h-64 overflow-y-auto">
              {changesQueue.length === 0 && (
                <div className="px-3 py-2 text-xs text-text-muted">No changes queued</div>
              )}
              {changesQueue.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs ${
                    item.status === "pending" ? "text-text" : "text-text-muted/50"
                  }`}
                >
                  <span className="truncate flex-1">
                    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                      item.status === "pending" ? "bg-amber-500"
                      : item.status === "committed" ? "bg-emerald-500"
                      : "bg-red-500"
                    }`} />
                    {item.type.toUpperCase()} {item.table}
                    {item.description && <span className="ml-1 text-text-muted/50">— {item.description}</span>}
                  </span>
                  {item.status === "pending" && (
                    <button
                      type="button"
                      onClick={() => cancelChange(item.id)}
                      className="text-text-muted hover:text-red-400 ml-2 shrink-0 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </DropdownMenu>
        </div>
        {/* Selected count + bulk actions */}
        {selectedCount > 0 && (
          <>
            <span className="text-accent font-medium tabular-nums">
              {selectedCount} selected
            </span>
            <BulkActionsDropdown
              columns={columns}
              selectedRows={selectedRows}
              schema={schema}
              table={table}
              onClearSelection={onClearSelection}
            />
            <button
              type="button"
              onClick={onClearSelection}
              className="text-text-muted hover:text-text transition-colors cursor-pointer"
              aria-label="Clear selection"
            >
              <X size={14} />
            </button>
            <div className="w-px h-4 bg-border" />
          </>
        )}

        {/* Columns toggle */}
        <div className="relative">
          <Tooltip content="Show/hide columns" side="bottom">
            <button
              type="button"
              onClick={() => setColumnMenuOpen((v) => !v)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
              aria-label="Toggle columns"
            >
              <Columns size={14} />
            </button>
          </Tooltip>
          <DropdownMenu open={columnMenuOpen} setOpen={setColumnMenuOpen} align="right">
            <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">Visible columns</div>
            <div className="max-h-64 overflow-y-auto">
              {columns.map((col) => (
                <button
                  key={col.name}
                  type="button"
                  onClick={() => onToggleColumn(col.name)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
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