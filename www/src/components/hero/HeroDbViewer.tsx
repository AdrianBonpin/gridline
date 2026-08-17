import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowUpDown,
  Boxes,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Columns,
  Copy,
  Database,
  DatabaseBackup,
  Download,
  Eye,
  Filter,
  FunctionSquare,
  GitBranch,
  Home,
  Key,
  ListChecks,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Star,
  Table2,
  Tag,
  Terminal,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  abbreviateType,
  cannedQueryResult,
  defaultQuery,
  demoObjects,
  demoQueries,
  demoTables,
  objectTypeLabels,
  type DemoColumn,
  type DemoObjectItem,
  type DemoTable,
  type ObjectType,
} from "./demoData";

// ─── types ──────────────────────────────────────────────

type Tab = {
  id: string;
  kind: "table" | "query";
  table?: string;
  query?: string;
  data?: { columns: DemoColumn[]; rows: unknown[][] };
};

type CellPos = { row: number; col: number };

const ROW_HEIGHT = 36;
const COL_WIDTH = 190;

// ─── helpers ────────────────────────────────────────────

function getTable(name: string): DemoTable | undefined {
  return demoTables.find((t) => t.name === name);
}

function jsonPreviewLabel(value: unknown): string {
  if (Array.isArray(value)) return `[ ${value.length} item${value.length !== 1 ? "s" : ""} ]`;
  if (typeof value === "object" && value !== null)
    return `{ ${Object.keys(value).length} key${Object.keys(value).length !== 1 ? "s" : ""} }`;
  return "";
}

// ─── sidebar rail ───────────────────────────────────────

const NAV_ITEMS = [
  { id: "db-viewer", label: "Explorer", icon: Database },
  { id: "queries", label: "Queries", icon: Clock },
  { id: "schema-visualizer", label: "Schema Visualizer", icon: Share2 },
  { id: "objects", label: "Objects", icon: Boxes },
  { id: "tools", label: "Tools", icon: DatabaseBackup },
];

const BOTTOM_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "settings", label: "Settings", icon: Settings },
];

function SidebarRail({
  currentView,
  onNavigate,
}: {
  currentView: string;
  onNavigate: (id: string) => void;
}) {
  const renderItem = (item: { id: string; label: string; icon: typeof Database }, isTools: boolean) => {
    const isActive = currentView === item.id;
    return (
      <button
        key={item.id}
        type="button"
        aria-label={item.label}
        title={item.label}
        onClick={() => onNavigate(item.id)}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
          isActive
            ? "text-[var(--accent)]"
            : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
        } ${isTools ? "opacity-50" : ""}`}
      >
        <item.icon size={16} />
      </button>
    );
  };

  return (
    <div className="w-14 shrink-0 bg-[var(--canvas)] border-r border-[var(--border)] flex flex-col items-center py-3 gap-2">
      <div className="flex flex-col gap-2 flex-1">
        {NAV_ITEMS.map((item) => renderItem(item, item.id === "tools"))}
      </div>
      <div className="flex flex-col gap-2">
        {BOTTOM_ITEMS.map((item) => renderItem(item, false))}
      </div>
    </div>
  );
}

// ─── table tree panel (header matches app DbViewerToolbar) ──

function TreePanel({
  searchQuery,
  onSearchChange,
  onOpenTable,
}: {
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onOpenTable: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const q = searchQuery.toLowerCase().trim();
  const filtered = demoTables.filter((t) => !q || t.name.toLowerCase().includes(q));

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSearch = () => {
    setSearchOpen((prev) => {
      const next = !prev;
      if (!next) onSearchChange("");
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 border-b border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-normal text-[var(--text-muted)]">Tables</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Edit Connection"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label="Refresh"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              aria-label="Create Table"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              aria-label="Search Tables"
              onClick={toggleSearch}
              className={`w-7 h-7 rounded-md flex items-center justify-center ${
                searchOpen
                  ? "text-[var(--accent)] bg-[var(--accent)]/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
              }`}
            >
              <Search size={14} />
            </button>
          </div>
        </div>
        {/* toggle search input */}
        <div
          className={`overflow-hidden transition-all duration-200 ease-out ${
            searchOpen ? "max-h-10 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter tables…"
              className="w-full bg-transparent border-0 border-b border-[var(--border)] pl-8 pr-7 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]/60 outline-none focus:border-[var(--accent)]/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange("")}
                className="absolute right-1 flex items-center justify-center w-5 h-5 rounded text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {/* schema row */}
        <div className="flex items-center gap-2 pb-3">
          <span className="text-xs text-[var(--text-muted)]">Schema</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text)]"
          >
            public
            <ChevronDown size={12} className="text-[var(--text-muted)]" />
          </button>
        </div>
      </div>

      {/* tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-[var(--text-muted)]">No tables</div>
        )}
        {filtered.map((table) => {
          const key = table.name;
          const isExpanded = expanded.has(key);
          const isView = table.table_type === "VIEW";
          const TypeIcon = isView ? Eye : Table2;
          return (
            <div key={key}>
              <div
                className="group flex items-center gap-1 px-3 py-1 hover:bg-[var(--surface-raised)] cursor-pointer"
                onClick={() => onOpenTable(table.name)}
              >
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(key);
                  }}
                  className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <TypeIcon size={14} className="text-[var(--text-muted)]" />
                <span className="flex-1 text-left text-sm text-[var(--text)] group-hover:text-[var(--accent)] truncate">
                  {table.name}
                </span>
                {isView && (
                  <span className="text-[10px] text-[var(--text-subtle)] shrink-0">View</span>
                )}
              </div>
              {isExpanded && (
                <div className="pl-10 pr-3 py-1 space-y-1">
                  {table.columns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-2 text-xs text-[var(--text-muted)]"
                      title={col.data_type}
                    >
                      {col.is_pk ? (
                        <Key size={12} className="text-[var(--accent)] shrink-0" />
                      ) : col.is_fk ? (
                        <Key size={12} className="text-amber-400 shrink-0" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="truncate">{col.name}</span>
                      <span className="text-[var(--text-subtle)] truncate">{abbreviateType(col.data_type)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── queries panel ──────────────────────────────────────

function QueriesPanel({
  onRestore,
}: {
  onRestore: (sql: string) => void;
}) {
  const [mode, setMode] = useState<"history" | "saved">("history");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");

  const items = demoQueries
    .filter((qi) => (mode === "history" ? true : qi.favorite))
    .filter((qi) => !search || qi.sql.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] shrink-0 w-64">
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-normal text-[var(--text-muted)]">Queries</span>
          <div className="flex items-center gap-1">
            {mode === "history" && (
              <button
                type="button"
                aria-label="Show favorites only"
                onClick={() => setMode((m) => (m === "history" ? "favorites" : "history"))}
                className={`w-7 h-7 rounded-md flex items-center justify-center ${
                  mode === "favorites"
                    ? "text-[var(--accent)] bg-[var(--accent)]/10"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
                }`}
              >
                <Star size={14} fill={mode === "favorites" ? "currentColor" : "none"} />
              </button>
            )}
            <button
              type="button"
              aria-label="Clear history"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              aria-label="Search queries"
              onClick={() => setSearchOpen((v) => !v)}
              className={`w-7 h-7 rounded-md flex items-center justify-center ${
                searchOpen
                  ? "text-[var(--accent)] bg-[var(--accent)]/10"
                  : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
              }`}
            >
              <Search size={14} />
            </button>
          </div>
        </div>
        <div
          className={`overflow-hidden transition-all duration-200 ease-out ${
            searchOpen ? "max-h-10 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="relative flex items-center">
            <Search size={12} className="absolute left-2.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter queries…"
              className="w-full bg-transparent border-0 border-b border-[var(--border)] pl-8 pr-7 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]/60 outline-none focus:border-[var(--accent)]/50"
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode("history")}
            className={`text-xs ${mode === "history" || mode === "favorites" ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            History
          </button>
          <span className="text-[var(--border)]">·</span>
          <button
            type="button"
            onClick={() => setMode("saved")}
            className={`text-xs ${mode === "saved" ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
          >
            Saved
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">No matching queries</div>
        )}
        {items.map((entry, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            onClick={() => onRestore(entry.sql)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target === e.currentTarget) onRestore(entry.sql);
            }}
            className="group flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-raised)] border-b border-[var(--border)]/50 transition-colors cursor-pointer"
          >
            <button
              type="button"
              aria-label={entry.favorite ? "Unfavorite" : "Favorite"}
              className={`shrink-0 mt-0.5 ${entry.favorite ? "text-amber-400" : "text-[var(--text-muted)] opacity-40 group-hover:opacity-80"}`}
            >
              <Star size={14} fill={entry.favorite ? "currentColor" : "none"} />
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--text)] font-mono truncate">{entry.sql}</div>
              <div className="flex items-center gap-2 mt-0.5 text-[10px] text-[var(--text-muted)]">
                <span>{entry.ms}ms</span>
                <span>{entry.rows} rows</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── objects panel + detail ─────────────────────────────

const OBJECT_TYPE_ICONS: Record<ObjectType, typeof FunctionSquare> = {
  functions: FunctionSquare,
  triggers: GitBranch,
  sequences: ListOrdered,
  enums: Tag,
  extensions: Puzzle,
};

function ObjectsPanel({
  type,
  onTypeChange,
  selected,
  onSelect,
}: {
  type: ObjectType;
  onTypeChange: (t: ObjectType) => void;
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const items = demoObjects[type];
  return (
    <div className="flex flex-col h-full border-r border-[var(--border)] shrink-0 w-64">
      <div className="px-3 pt-3 pb-2 border-b border-[var(--border)] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-normal text-[var(--text-muted)]">Objects</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Refresh"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              aria-label="Search objects"
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)]"
            >
              <Search size={14} />
            </button>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text)]"
        >
          {objectTypeLabels[type]}
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--text-muted)]">Schema</span>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text)]"
          >
            public
            <ChevronDown size={12} className="text-[var(--text-muted)]" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {items.map((obj) => {
          const Icon = OBJECT_TYPE_ICONS[type];
          const isSel = selected === obj.name;
          return (
            <div
              key={obj.name}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(obj.name)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm transition-colors ${
                isSel
                  ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "text-[var(--text)] hover:bg-[var(--surface-raised)]"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="flex-1 text-left truncate font-mono text-xs">{obj.name}</span>
              {obj.signature && <span className="text-[10px] text-[var(--text-subtle)] truncate">{obj.signature}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ObjectDetailView({ type, item }: { type: ObjectType; item: DemoObjectItem }) {
  return (
    <div className="overflow-y-auto">
      <div className="border-b border-[var(--border)] px-4 py-2">
        <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
          {type === "functions" ? "Signature" : type === "extensions" ? "Extension" : objectTypeLabels[type].replace(/s$/, "")}
        </span>
      </div>
      {item.detail.map((row) => (
        <div key={row.label} className="border-b border-[var(--border)] flex">
          <div className="border-r border-[var(--border)] px-4 py-2 flex items-center flex-2">
            <span className="text-xs text-[var(--text-muted)] w-28 shrink-0">{row.label}</span>
            <span
              className={`text-sm font-mono ${row.accent ? "text-[var(--accent)]" : "text-[var(--text)]"}`}
            >
              {row.value}
            </span>
          </div>
        </div>
      ))}
      {item.labels && item.labels.length > 0 && (
        <>
          <div className="border-b border-[var(--border)] px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Labels</span>
            <span className="text-[10px] text-[var(--text-subtle)]">{item.labels.length} total</span>
          </div>
          <div className="px-4 py-3">
            <ol className="space-y-1.5">
              {item.labels.map((label, i) => (
                <li key={label} className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-[var(--text-muted)]">#{i + 1}</span>
                  <span className="font-mono text-[var(--text)]">{label}</span>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
      {item.source && (
        <>
          <div className="border-b border-[var(--border)] px-4 py-2">
            <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Source</span>
          </div>
          <pre className="p-4 text-[11px] text-[var(--text)] font-mono whitespace-pre-wrap break-all leading-relaxed select-text">
            {item.source}
          </pre>
        </>
      )}
    </div>
  );
}

// ─── schema visualizer (SVG ER diagram) ─────────────────

const ER_TABLES = [
  { name: "users", x: 40, y: 20, cols: [["id", "int4", "pk"], ["name", "text"], ["email", "text"], ["role", "text"], ["created_at", "ts"], ["metadata", "jsonb"]] },
  { name: "orders", x: 380, y: 20, cols: [["id", "int4", "pk"], ["user_id", "int4", "fk:users.id"], ["total", "num"], ["status", "text"], ["created_at", "ts"]] },
  { name: "categories", x: 40, y: 280, cols: [["id", "int4", "pk"], ["name", "text"]] },
  { name: "products", x: 380, y: 280, cols: [["id", "int4", "pk"], ["name", "text"], ["price", "num"], ["stock", "int4"], ["category_id", "int4", "fk:categories.id"]] },
  { name: "audit_log", x: 720, y: 20, cols: [["id", "int4", "pk"], ["action", "text"], ["details", "jsonb"], ["created_at", "ts"]] },
] as const;

const BOX_W = 160;
const HEADER_H = 26;
const ROW_H = 20;

type ErTable = { name: string; x: number; y: number; cols: readonly (readonly [string, string, string])[] };

function erTableHeight(t: ErTable): number {
  return HEADER_H + t.cols.length * ROW_H;
}

function erColumnY(t: ErTable, colIdx: number): number {
  return t.y + HEADER_H + colIdx * ROW_H + ROW_H / 2;
}

function erTable(t: ErTable) {
  const h = erTableHeight(t);
  return (
    <g key={t.name}>
      <rect x={t.x} y={t.y} width={BOX_W} height={h} rx={8} fill="var(--surface)" stroke="var(--border)" />
      <path d={`M ${t.x} ${t.y + HEADER_H} h ${BOX_W}`} stroke="var(--border)" />
      <text x={t.x + 8} y={t.y + HEADER_H - 8} fontSize={11} fontWeight={600} fill="var(--text)" fontFamily="var(--font-sans)">
        {t.name}
      </text>
      {t.cols.map(([cname, ctype, flag], i) => {
        const cy = erColumnY(t, i) + 3;
        const isPk = flag === "pk";
        const isFk = typeof flag === "string" && flag.startsWith("fk");
        return (
          <g key={cname}>
            {isPk ? (
              <text x={t.x + 8} y={cy} fontSize={10} fill="var(--accent)" fontFamily="var(--font-sans)">🔑</text>
            ) : (
              <circle cx={t.x + 12} cy={cy - 3} r={2} fill={isFk ? "#fbbf24" : "var(--border)"} />
            )}
            <text x={t.x + (isPk ? 26 : 18)} y={cy} fontSize={10} fill={isFk ? "var(--accent)" : "var(--text)"} fontFamily="var(--font-sans)">
              {cname}
            </text>
            <text x={t.x + BOX_W - 8} y={cy} fontSize={9} fill="var(--text-subtle)" textAnchor="end" fontFamily="var(--font-sans)">
              {ctype}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function SchemaViz() {
  const users = ER_TABLES[0];
  const orders = ER_TABLES[1];
  const categories = ER_TABLES[2];
  const products = ER_TABLES[3];
  const edges: [number, number, number, number][] = [
    // users.id (row 0) → orders.user_id (row 1)
    [users.x + BOX_W, erColumnY(users, 0), orders.x, erColumnY(orders, 1)],
    // categories.id (row 0) → products.category_id (row 4)
    [categories.x + BOX_W, erColumnY(categories, 0), products.x, erColumnY(products, 4)],
  ];
  const W = 960;
  const H = 480;
  // Build an orthogonal (right-angle) connector: horizontal → vertical → horizontal.
  const orthogonal = (x1: number, y1: number, x2: number, y2: number) => {
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  };
  return (
    <div className="h-full overflow-auto flex items-center justify-center">
      <div className="p-6 w-full">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-[var(--text-muted)]">public · 5 tables, 2 relationships</span>
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-subtle)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} /> PK</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> FK</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: "var(--border)" }} /> column</span>
          </div>
        </div>
        <div className="border border-[var(--border)] rounded-lg bg-[var(--canvas)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
            {edges.map(([x1, y1, x2, y2], i) => (
              <g key={i}>
                <path
                  d={orthogonal(x1, y1, x2, y2)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                <circle cx={x1} cy={y1} r={3} fill="var(--accent)" />
                <circle cx={x2} cy={y2} r={3} fill="var(--accent)" />
              </g>
            ))}
            {ER_TABLES.map((t) => erTable(t))}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─── tab bar (with drag reorder) ────────────────────────

function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewQuery,
  onReorder,
}: {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewQuery: () => void;
  onReorder: (from: number, to: number) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const from = tabs.findIndex((t) => t.id === draggingId);
    const to = tabs.findIndex((t) => t.id === targetId);
    if (from >= 0 && to >= 0) onReorder(from, to);
    setDraggingId(null);
    setOverId(null);
  };

  return (
    <div className="flex h-9 items-stretch border-b border-[var(--border)]">
      <div className="flex flex-1 min-w-0 items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const Icon = tab.kind === "query" ? Terminal : Table2;
          const isDragging = draggingId === tab.id;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              draggable
              onDragStart={() => setDraggingId(tab.id)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverId(tab.id);
              }}
              onDrop={() => handleDrop(tab.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setOverId(null);
              }}
              onClick={() => onSelect(tab.id)}
              className={`group flex shrink-0 items-center gap-2 border-r border-[var(--border)] px-3 text-sm transition-colors cursor-pointer select-none ${
                isActive ? "bg-[var(--canvas)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              } ${isDragging ? "opacity-50" : ""} ${overId === tab.id && !isDragging ? "border-l-2 border-l-[var(--accent)]" : ""}`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{tab.table ?? "Query"}</span>
              <button
                type="button"
                aria-label={`Close ${tab.table ?? "query"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="rounded p-0.5 opacity-60 transition-opacity hover:bg-[var(--surface-raised)] hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 border-l border-[var(--border)] px-2">
        <button
          type="button"
          onClick={onNewQuery}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
        >
          <Play size={12} className="fill-current" />
          Query
        </button>
        <button
          type="button"
          aria-label="Changes queue"
          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-muted)]"
        >
          <ListChecks size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── data grid ──────────────────────────────────────────

function DataGrid({
  columns,
  rows,
  selectedRows,
  onToggleRow,
  activeCell,
  onCellClick,
  onJsonClick,
}: {
  columns: DemoColumn[];
  rows: unknown[][];
  selectedRows: Set<number>;
  onToggleRow: (i: number) => void;
  activeCell: CellPos | null;
  onCellClick: (pos: CellPos) => void;
  onJsonClick: (value: unknown, anchor: DOMRect) => void;
}) {
  const totalWidth = 40 + columns.length * COL_WIDTH;
  const allSelected = rows.length > 0 && selectedRows.size === rows.length;

  return (
    <div className="overflow-auto h-full outline-none" role="grid">
      <div className="sticky top-0 z-10">
        <div className="flex items-center border-b border-[var(--border)] bg-[var(--canvas)]" style={{ width: totalWidth }}>
          <div
            style={{ width: 40, minWidth: 40 }}
            className="px-2 py-2 flex items-center justify-center border-r border-[var(--border)] self-stretch"
          >
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => {
                if (allSelected) {
                  rows.forEach((_, i) => selectedRows.has(i) && onToggleRow(i));
                } else {
                  rows.forEach((_, i) => !selectedRows.has(i) && onToggleRow(i));
                }
              }}
              className="w-3.5 h-3.5 rounded border-[var(--border)] cursor-pointer accent-[var(--accent)]"
            />
          </div>
          {columns.map((col) => (
            <div
              key={col.name}
              className="relative px-3 py-2 text-[var(--text-muted)] border-r border-[var(--border)] self-stretch"
              style={{ width: COL_WIDTH, flexShrink: 0 }}
            >
              <div className="truncate flex items-center gap-1">
                {col.is_pk && <Key size={10} className="text-[var(--accent)] shrink-0" />}
                {col.is_fk && <Key size={10} className="text-amber-400 shrink-0" />}
                <span className="text-[var(--text)] text-xs">{col.name}</span>
                <span className="text-[10px] text-[var(--text-muted)]/50 shrink-0">{abbreviateType(col.data_type)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">No rows in result set</div>
      ) : (
        <div style={{ width: "100%" }}>
          {rows.map((row, rowIndex) => {
            const isSelected = selectedRows.has(rowIndex);
            return (
              <div
                key={rowIndex}
                className={`flex items-center border-b border-[var(--border)] ${
                  isSelected ? "bg-[var(--accent)]/5" : ""
                } hover:bg-[var(--surface)]/50`}
                style={{ minWidth: totalWidth, height: ROW_HEIGHT }}
              >
                <div
                  style={{ width: 40, minWidth: 40 }}
                  className="flex items-center justify-center border-r border-[var(--border)] self-stretch"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleRow(rowIndex)}
                    className="w-3.5 h-3.5 rounded border-[var(--border)] cursor-pointer accent-[var(--accent)]"
                  />
                </div>
                {columns.map((col, colIndex) => {
                  const cell = row[colIndex];
                  const isNull = cell === null || cell === undefined;
                  const isJson = !isNull && (col.data_type === "jsonb" || col.data_type === "json");
                  const isFk = col.is_fk && col.fk_ref && !isNull;
                  const isActive = activeCell?.row === rowIndex && activeCell?.col === colIndex;
                  return (
                    <div
                      key={col.name}
                      className={`relative px-3 py-2 text-xs truncate select-text border-r border-[var(--border)] self-stretch ${
                        isFk
                          ? "cursor-pointer underline decoration-dotted underline-offset-2 hover:text-[var(--accent)]"
                          : ""
                      } ${isJson ? "cursor-pointer text-[var(--accent)]/80 hover:text-[var(--accent)]" : ""} ${
                        isActive ? "bg-[var(--accent)]/10 ring-1 ring-inset ring-[var(--accent)]" : ""
                      }`}
                      style={{ width: COL_WIDTH, flexShrink: 0 }}
                      title={isNull ? "NULL" : String(cell)}
                      onClick={(e) => {
                        onCellClick({ row: rowIndex, col: colIndex });
                        if (isJson) {
                          onJsonClick(cell, (e.currentTarget as HTMLElement).getBoundingClientRect());
                        }
                      }}
                    >
                      {isNull ? (
                        <span className="italic text-[var(--text-muted)]">NULL</span>
                      ) : isJson ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Braces size={10} className="shrink-0" />
                          {jsonPreviewLabel(cell)}
                        </span>
                      ) : isFk ? (
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <ArrowUpRight size={11} className="shrink-0 text-[var(--text-muted)]" />
                          <span className="truncate">{String(cell)}</span>
                        </span>
                      ) : (
                        String(cell)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── table controls toolbar ────────────────────────────

function TableControls({
  table,
  rowCount,
  selectedCount,
}: {
  table: string;
  rowCount: number;
  selectedCount: number;
}) {
  return (
    <div className="relative flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Insert row" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <Plus size={14} />
        </button>
        <button type="button" aria-label="Refresh" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <RefreshCw size={14} />
        </button>
        <button type="button" aria-label="Auto-refresh" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <Clock size={14} />
        </button>
        <div className="w-px h-4 bg-[var(--border)] mx-1" />
        <button type="button" aria-label="Column filters" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <Filter size={14} />
        </button>
        <button type="button" aria-label="Sort rules" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <ArrowUpDown size={14} />
        </button>
        <button type="button" aria-label="Export" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <Download size={14} />
        </button>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        {selectedCount > 0 && (
          <span className="text-[var(--accent)] font-medium tabular-nums">{selectedCount} selected</span>
        )}
        <button type="button" aria-label="Toggle columns" className="flex items-center rounded px-1.5 py-0.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
          <Columns size={14} />
        </button>
        <div className="w-px h-4 bg-[var(--border)]" />
        <span className="tabular-nums">1-{rowCount} of {rowCount}</span>
        <span className="text-[var(--text-subtle)]">· {table}</span>
      </div>
    </div>
  );
}

// ─── query toolbar ─────────────────────────────────────

function QueryToolbar({
  running,
  onRun,
}: {
  running: boolean;
  onRun: () => void;
}) {
  return (
    <div className="relative flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1 font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
      >
        <Play size={14} className="fill-current" />
        {running ? "Running…" : "Run Query"}
      </button>
      <button type="button" aria-label="Auto format query" className="flex items-center rounded px-2 py-1.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
        <Wand2 size={14} />
      </button>
      <button type="button" aria-label="Save query" className="flex items-center rounded px-2 py-1.5 hover:bg-[var(--surface-raised)] hover:text-[var(--text)]">
        <Save size={14} />
      </button>
      <div className="ml-auto">
        <span className="rounded-md border border-[var(--border)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          PostgreSQL
        </span>
      </div>
    </div>
  );
}

// ─── fake SQL editor ───────────────────────────────────

function SqlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-transparent">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder="Enter your SQL query…"
        className="w-full h-full resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-[var(--text)] placeholder:text-[var(--text-muted)]/50 outline-none"
      />
    </div>
  );
}

// ─── JSON popover (matches app JsonCellPopover, anchored within the window) ──

function JsonPopover({
  value,
  anchor,
  containerRef,
  onClose,
}: {
  value: unknown;
  anchor: DOMRect;
  containerRef: { current: HTMLDivElement | null };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"formatted" | "raw">("formatted");
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on Escape and outside click
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    const id = setTimeout(() => document.addEventListener("mousedown", onClick), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [onClose]);

  // Anchor position relative to the mockup window, clamped within it.
  const containerRect = containerRef.current?.getBoundingClientRect();
  if (!containerRect) return null;
  const cellLeft = anchor.left - containerRect.left;
  const cellTop = anchor.top - containerRect.top;
  const cellBottom = anchor.bottom - containerRect.top;

  const popoverWidth = 420;
  const popoverMaxHeight = 360;
  const gap = 8;
  const pad = 8;
  let left = cellLeft;
  let top = cellBottom + gap;
  if (left + popoverWidth > containerRect.width - pad) {
    const leftOfCell = cellLeft - popoverWidth - gap;
    left = leftOfCell >= pad ? leftOfCell : Math.max(pad, containerRect.width - popoverWidth - pad);
  }
  if (top + popoverMaxHeight > containerRect.height - pad) {
    top = cellTop - popoverMaxHeight - gap;
    if (top < pad) top = pad;
  }

  const rawText = typeof value === "string" ? value : JSON.stringify(value);
  const formattedText = JSON.stringify(value, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tab === "formatted" ? formattedText : rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-[var(--popover-bg)] border border-[var(--popover-border)] rounded-lg shadow-xl overflow-hidden"
      style={{ left, top, width: popoverWidth, maxHeight: popoverMaxHeight }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--popover-border)] bg-[var(--popover-bg)]/80">
        <div className="flex items-center gap-1.5 min-w-0">
          <Braces size={12} className="text-[var(--accent)] shrink-0" />
          <span className="text-xs font-semibold text-[var(--text)]">JSON</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="flex rounded bg-[var(--surface-raised)] border border-[var(--popover-border)] overflow-hidden mr-1">
            <button
              onClick={() => setTab("formatted")}
              className={`px-2 py-0.5 text-[11px] transition-colors ${
                tab === "formatted" ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Formatted
            </button>
            <button
              onClick={() => setTab("raw")}
              className={`px-2 py-0.5 text-[11px] transition-colors ${
                tab === "raw" ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              Raw
            </button>
          </div>
          <button onClick={handleCopy} title="Copy to clipboard" className="p-0.5 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)]">
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
          <button onClick={onClose} className="p-0.5 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)]">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="overflow-auto p-3" style={{ maxHeight: popoverMaxHeight - 41 }}>
        <pre className="text-[11px] text-[var(--text)] font-mono whitespace-pre-wrap break-all leading-relaxed select-text">
          {tab === "formatted" ? formattedText : rawText}
        </pre>
      </div>
    </div>
  );
}

// ─── main component ─────────────────────────────────────

export default function HeroDbViewer() {
  const [currentView, setCurrentView] = useState("db-viewer");
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "t-users", kind: "table", table: "users", data: getTable("users") },
    { id: "q-1", kind: "query", query: defaultQuery },
  ]);
  const [activeTabId, setActiveTabId] = useState("t-users");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [activeCell, setActiveCell] = useState<CellPos | null>(null);
  const [jsonPopover, setJsonPopover] = useState<{ value: unknown; anchor: DOMRect } | null>(null);
  const [running, setRunning] = useState(false);
  const [objectType, setObjectType] = useState<ObjectType>("functions");
  const [selectedObject, setSelectedObject] = useState<string | null>(demoObjects.functions[0].name);
  const runTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const openTable = (name: string) => {
    const existing = tabs.find((t) => t.kind === "table" && t.table === name);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const id = `t-${name}-${Date.now()}`;
    setTabs((prev) => [...prev, { id, kind: "table", table: name, data: getTable(name) }]);
    setActiveTabId(id);
    setSelectedRows(new Set());
    setActiveCell(null);
  };

  const openQuery = () => {
    const id = `q-${Date.now()}`;
    setTabs((prev) => [...prev, { id, kind: "query", query: defaultQuery }]);
    setActiveTabId(id);
    setSelectedRows(new Set());
    setActiveCell(null);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabId === id) {
        const last = next[next.length - 1];
        setActiveTabId(last ? last.id : "");
      }
      return next;
    });
  };

  const reorderTab = (from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleRestoreSql = (sql: string) => {
    const existingQuery = tabs.find((t) => t.kind === "query");
    if (existingQuery) {
      setTabs((prev) =>
        prev.map((t) => (t.id === existingQuery.id ? { ...t, query: sql } : t)),
      );
      setActiveTabId(existingQuery.id);
    } else {
      const id = `q-${Date.now()}`;
      setTabs((prev) => [...prev, { id, kind: "query", query: sql }]);
      setActiveTabId(id);
    }
  };

  const handleRun = () => {
    if (running) return;
    setRunning(true);
    if (runTimer.current) clearTimeout(runTimer.current);
    runTimer.current = setTimeout(() => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId && t.kind === "query" ? { ...t, data: cannedQueryResult } : t,
        ),
      );
      setRunning(false);
      setSelectedRows(new Set());
      setActiveCell(null);
    }, 700);
  };

  const handleNavigate = (id: string) => {
    if (id === "tools") setCurrentView("tools");
    else if (id === "home" || id === "settings") setCurrentView("db-viewer");
    else setCurrentView(id);
  };

  const columns = activeTab?.data?.columns ?? [];
  const rows = activeTab?.data?.rows ?? [];

  const renderTabsWorkspace = () => {
    if (!activeTab) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
          <Table2 size={32} />
          <span>Select a table from the tree, or open a new query tab.</span>
        </div>
      );
    }
    if (activeTab.kind === "query") {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <QueryToolbar running={running} onRun={handleRun} />
          <SqlEditor
            value={activeTab.query ?? ""}
            onChange={(v) =>
              setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, query: v } : t)))
            }
          />
          {activeTab.data ? (
            <>
              <div className="relative shrink-0">
                <div className="h-1 bg-[var(--border)]/20" />
              </div>
              <div className="flex flex-col min-h-0 shrink-0" style={{ height: 200 }}>
                <TableControls table="query" rowCount={rows.length} selectedCount={selectedRows.size} />
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                  <DataGrid
                    columns={columns}
                    rows={rows}
                    selectedRows={selectedRows}
                    onToggleRow={(i) =>
                      setSelectedRows((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    activeCell={activeCell}
                    onCellClick={setActiveCell}
                    onJsonClick={(value, anchor) => setJsonPopover({ value, anchor })}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-subtle)]">
              {running ? "Running query…" : "Press Run Query to see a sample result."}
            </div>
          )}
        </div>
      );
    }
    // table tab
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <TableControls table={activeTab.table ?? ""} rowCount={rows.length} selectedCount={selectedRows.size} />
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <DataGrid
            columns={columns}
            rows={rows}
            selectedRows={selectedRows}
            onToggleRow={(i) =>
              setSelectedRows((prev) => {
                const next = new Set(prev);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })
            }
            activeCell={activeCell}
            onCellClick={setActiveCell}
            onJsonClick={(value, anchor) => setJsonPopover({ value, anchor })}
          />
        </div>
      </div>
    );
  };

  const renderMain = () => {
    switch (currentView) {
      case "tools":
        return (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
            <DatabaseBackup size={32} />
            <span className="text-sm">Backup, restore, and sync aren&apos;t part of this demo.</span>
            <span className="text-xs text-[var(--text-subtle)]">Try the Explorer, Queries, or Objects views instead.</span>
          </div>
        );
      case "queries":
        return (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <QueriesPanel onRestore={handleRestoreSql} />
            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSelect={setActiveTabId}
                onClose={closeTab}
                onNewQuery={openQuery}
                onReorder={reorderTab}
              />
              {renderTabsWorkspace()}
            </div>
          </div>
        );
      case "objects": {
        const item = demoObjects[objectType].find((o) => o.name === selectedObject) ?? demoObjects[objectType][0];
        return (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <ObjectsPanel
              type={objectType}
              onTypeChange={setObjectType}
              selected={item?.name ?? null}
              onSelect={setSelectedObject}
            />
            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
              <div className="flex h-9 items-stretch border-b border-[var(--border)] px-3">
                <div className="flex items-center gap-2 text-sm">
                  {(() => {
                    const Icon = OBJECT_TYPE_ICONS[objectType];
                    return <Icon size={14} className="text-[var(--text-muted)]" />;
                  })()}
                  <span className="font-mono text-[var(--text)]">{item?.name}</span>
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {item ? <ObjectDetailView type={objectType} item={item} /> : <div className="p-4 text-sm text-[var(--text-muted)]">No object selected</div>}
              </div>
            </div>
          </div>
        );
      }
      case "schema-visualizer":
        return (
          <div className="flex-1 min-h-0 overflow-hidden">
            <SchemaViz />
          </div>
        );
      default:
        return (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="border-r border-[var(--border)] flex flex-col shrink-0 w-64">
              <TreePanel searchQuery={searchQuery} onSearchChange={setSearchQuery} onOpenTable={openTable} />
            </div>
            <div className="flex-1 w-0 flex flex-col min-w-0 overflow-hidden">
              <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                onSelect={setActiveTabId}
                onClose={closeTab}
                onNewQuery={openQuery}
                onReorder={reorderTab}
              />
              {renderTabsWorkspace()}
            </div>
          </div>
        );
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full bg-[var(--canvas)] border border-[var(--border)] rounded-xl overflow-hidden flex text-left relative"
    >
      <SidebarRail currentView={currentView} onNavigate={handleNavigate} />
      <div className="flex-1 flex flex-col min-h-0">{renderMain()}</div>
      {jsonPopover && (
        <JsonPopover
          value={jsonPopover.value}
          anchor={jsonPopover.anchor}
          containerRef={containerRef}
          onClose={() => setJsonPopover(null)}
        />
      )}
    </div>
  );
}
