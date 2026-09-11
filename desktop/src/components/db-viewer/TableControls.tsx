import { useState, useRef, useEffect } from "react";
import {
  Plus, RefreshCw, Clock, Filter, ArrowUpDown, Download,
  Columns, Check, ChevronLeft, ChevronRight, X, Trash2,
  ChevronDown, FileJson, FileText, Terminal,
} from "lucide-react";
import { useDbViewerStore, type FilterRule, type SortRule } from "../../stores/dbViewerStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { Tooltip } from "../ui/Tooltip";
import { exportData } from "../../lib/exportData";
import type { ColumnInfo } from "../../lib/types";

const AUTO_REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
] as const;

const PAGE_SIZES = [50, 100, 200, 500] as const;

const EXPORT_FORMATS = [
  { label: "JSON", ext: "json" },
  { label: "CSV", ext: "csv" },
  { label: "SQL", ext: "sql" },
  { label: "Markdown", ext: "md" },
  { label: "Excel", ext: "xlsx" },
] as const;

// ─── helpers ────────────────────────────────────────────

/**
 * Format an execution duration using the most sensible unit:
 * ms below a second, seconds (1 decimal) up to a minute, minutes beyond.
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ─── sub-components ─────────────────────────────────────

function DropdownMenu({
  open,
  setOpen,
  align,
  wrapRef,
  children,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  align?: "left" | "right";
  /** When provided, outside-click detection uses this wrapper (which should
   * contain both the toggle button and the menu) so the button never fights
   * the outside-click handler. */
  wrapRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const container = wrapRef?.current ?? ref.current;
      if (container && !container.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen, wrapRef]);

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

/**
 * Debounced free-text input for filter values. The value is committed to the
 * rules (and thus triggers a server-side refetch) only after the user stops
 * typing for `DEBOUNCE_MS`. Without this, every keystroke fires a query and
 * the in-flight guard in `fetchData` silently drops intermediate fetches, so
 * the final filter value can end up not being applied.
 */
const FILTER_DEBOUNCE_MS = 400;

function DebouncedValueInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the draft in sync when the committed value changes externally
  // (e.g. a rule is replaced or removed while this input is mounted).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDraft(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onCommit(v), FILTER_DEBOUNCE_MS);
  };

  return (
    <input
      type="text"
      value={draft}
      onChange={handleChange}
      placeholder={placeholder}
      className="flex-1 rounded border border-border bg-surface text-xs px-1.5 py-1 text-text min-w-0"
    />
  );
}

function FilterModal({
  columns,
  rules,
  onChange,
  open,
  setOpen,
  wrapRef,
}: {
  columns: ColumnInfo[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Close on outside click, but treat the toggle button (which lives inside
  // the same wrapper) as part of the modal so it never fights the toggle.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen, wrapRef]);

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
    <div className="absolute top-full left-0 mt-1 z-30 w-96 rounded-lg bg-surface border border-border shadow-lg p-3">
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
            <DebouncedValueInput
              value={rule.value}
              onCommit={(v) => updateRule(rule.id, { value: v })}
              placeholder="value"
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
  wrapRef,
}: {
  columns: ColumnInfo[];
  rules: SortRule[];
  onChange: (rules: SortRule[]) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Close on outside click, but treat the toggle button (which lives inside
  // the same wrapper) as part of the modal so it never fights the toggle.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open, setOpen, wrapRef]);

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
    <div className="absolute top-full left-0 mt-1 z-30 w-72 rounded-lg bg-surface border border-border shadow-lg p-3">
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
  const wrapRef = useRef<HTMLDivElement>(null);
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
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-accent hover:bg-surface-raised transition-colors cursor-pointer"
      >
        <span className="text-xs font-medium">Actions</span>
        <ChevronDown size={12} />
      </button>
      <DropdownMenu open={open} setOpen={setOpen} align="right" wrapRef={wrapRef}>
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
  /** Hide data-modifying affordances (e.g. for materialized views). */
  isMatview?: boolean;
  /** "table" = full table toolbar; "query" = export/refresh/columns + timing */
  variant?: "table" | "query";
  /** Open the full-result streamed export dialog. */
  onExportToFile?: () => void;
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
  isMatview = false,
  variant = "table",
  onExportToFile,
}: TableControlsProps) {
  const isQuery = variant === "query";
  const notify = useNotificationStore((s) => s.notify);
  const tabs = useDbViewerStore((s) => s.tabs);
  const activeTabId = useDbViewerStore((s) => s.activeTabId);
  const setPage = useDbViewerStore((s) => s.setPage);
  const setPageSize = useDbViewerStore((s) => s.setPageSize);
  const openTab = useDbViewerStore((s) => s.openTab);
  const addChange = useDbViewerStore((s) => s.addChange);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isRefreshing = activeTab?.loading ?? false;

  // local state
  const [filterOpen, setFilterOpen] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef<HTMLDivElement>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const columnMenuWrapRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportWrapRef = useRef<HTMLDivElement>(null);
  const [autoRefresh, setAutoRefresh] = useState(defaultRefreshRate);
  const [autoRefreshOpen, setAutoRefreshOpen] = useState(false);
  const autoRefreshWrapRef = useRef<HTMLDivElement>(null);

  // Auto-refresh: a self-restarting timer that only counts down while the tab
  // is idle. Fires a refresh, waits for it to complete (loading → false),
  // then starts a fresh countdown. Also resets whenever the active tab changes
  // so a freshly opened/reopened tab is not immediately refetched.
  useEffect(() => {
    if (autoRefresh === 0) return;
    // While a refresh is in flight, wait for it to finish before counting down
    if (isRefreshing) return;
    const id = setTimeout(onRefresh, autoRefresh);
    return () => clearTimeout(id);
  }, [autoRefresh, onRefresh, isRefreshing, activeTabId]);

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
    // Build the insert template from editable columns only. PK / generated /
    // identity columns are omitted so their defaults (serial, identity,
    // generated) apply on commit — an explicit NULL would bypass them and
    // fail with a NOT NULL violation.
    const newData: Record<string, unknown> = {};
    columns.forEach((c) => {
      if (c.editable && !c.is_pk && !c.is_generated) newData[c.name] = null;
    });
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
    const label =
      EXPORT_FORMATS.find((f) => f.ext === format)?.label ?? format.toUpperCase();
    try {
      exportData(rows, columns, format, table);
      notify(
        `Exported ${rows.length} row${rows.length === 1 ? "" : "s"} as ${label}`,
        "success",
      );
    } catch (e) {
      notify(
        `Export failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
    setExportOpen(false);
  };

  const executionTimeMs = activeTab?.data?.execution_time_ms ?? null;

  const refreshControl = (
    <Tooltip
      content={
        isRefreshing
          ? isQuery
            ? "Running…"
            : "Refreshing…"
          : isQuery
            ? "Re-trigger query"
            : "Refresh"
      }
      side="bottom"
    >
      <button
        type="button"
        onClick={onRefresh}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-raised hover:text-text transition-colors cursor-pointer"
        aria-label={isQuery ? "Re-run query" : "Refresh table"}
      >
        <RefreshCw
          size={14}
          className={isRefreshing ? "animate-spin text-accent" : ""}
        />
      </button>
    </Tooltip>
  );

  const exportControl = (
    <div className="relative" ref={exportWrapRef}>
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
      <DropdownMenu open={exportOpen} setOpen={setExportOpen} wrapRef={exportWrapRef}>
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
        {onExportToFile && (
          <>
            <div className="my-1 h-px bg-border" />
            <button
              type="button"
              onClick={() => {
                setExportOpen(false);
                onExportToFile();
              }}
              className="w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
            >
              Export all rows to file…
            </button>
          </>
        )}
      </DropdownMenu>
    </div>
  );

  const columnsControl = (
    <div className="relative" ref={columnMenuWrapRef}>
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
      <DropdownMenu
        open={columnMenuOpen}
        setOpen={setColumnMenuOpen}
        align={isQuery ? "left" : "right"}
        wrapRef={columnMenuWrapRef}
      >
        <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">
          Visible columns
        </div>
        <div className="max-h-64 overflow-y-auto">
          {columns.map((col) => (
            <button
              key={col.name}
              type="button"
              onClick={() => onToggleColumn(col.name)}
              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text hover:bg-surface-raised transition-colors cursor-pointer"
            >
              <span
                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  hiddenColumns.has(col.name)
                    ? "border-border bg-transparent"
                    : "border-accent bg-accent"
                }`}
              >
                {!hiddenColumns.has(col.name) && (
                  <Check size={10} className="text-white" />
                )}
              </span>
              <span className="truncate">{col.name}</span>
            </button>
          ))}
        </div>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="relative flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
      {/* refresh pulse: absolutely positioned so it never causes layout shifts */}
      {isRefreshing && (
        <div
          data-testid="refresh-pulse"
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none animate-toolbar-pulse bg-accent"
        />
      )}
      {/* ── left side ──────────────────────────────── */}
      <div className="flex items-center gap-1">
        {isQuery ? (
          <>
            {exportControl}
            {refreshControl}
            <div className="w-px h-4 bg-border mx-1" />
            {columnsControl}
          </>
        ) : (
          <>
            {!isMatview && (
              <>
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
              </>
            )}

            {refreshControl}

            {/* Auto-refresh */}
            <div className="relative" ref={autoRefreshWrapRef}>
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
              <DropdownMenu open={autoRefreshOpen} setOpen={setAutoRefreshOpen} wrapRef={autoRefreshWrapRef}>
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
            <div className="relative" ref={filterWrapRef}>
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
                wrapRef={filterWrapRef}
              />
            </div>

            {/* Sort */}
            <div className="relative" ref={sortWrapRef}>
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
                wrapRef={sortWrapRef}
              />
            </div>

            {exportControl}
          </>
        )}
      </div>

      {/* ── spacer ──────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── right side ─────────────────────────────── */}
      <div className="flex items-center gap-2">
        {isQuery && executionTimeMs != null && (
          <>
            <span
              className="flex items-center gap-1.5 tabular-nums"
              aria-label="Execution time"
            >
              <Clock size={12} className="text-text-muted" />
              {formatDuration(executionTimeMs)}
            </span>
            <div className="w-px h-4 bg-border" />
          </>
        )}
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

        {!isQuery && columnsControl}

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