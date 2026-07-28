import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
    ChevronRight,
    FunctionSquare,
    GitBranch,
    ListOrdered,
    Tag,
    Puzzle,
    Search,
    X,
    RefreshCw,
} from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import * as cmd from "../../lib/commands";
import type {
    FunctionInfo,
    TriggerInfo,
    SequenceInfo,
    EnumInfo,
    ExtensionInfo,
} from "../../lib/types";

export type ObjectType =
    | "functions"
    | "triggers"
    | "sequences"
    | "enums"
    | "extensions";

interface ObjectExplorerPageProps {
    type: ObjectType;
    connectionId: string;
}

const TYPE_LABELS: Record<ObjectType, string> = {
    functions: "Functions",
    triggers: "Triggers",
    sequences: "Sequences",
    enums: "Enums",
    extensions: "Extensions",
};

const SINGULAR_LABELS: Record<ObjectType, string> = {
    functions: "function",
    triggers: "trigger",
    sequences: "sequence",
    enums: "enum",
    extensions: "extension",
};

const ICONS: Record<ObjectType, React.ReactNode> = {
    functions: (
        <FunctionSquare size={14} className="text-text-muted shrink-0" />
    ),
    triggers: (
        <GitBranch size={14} className="text-text-muted shrink-0" />
    ),
    sequences: (
        <ListOrdered size={14} className="text-text-muted shrink-0" />
    ),
    enums: <Tag size={14} className="text-text-muted shrink-0" />,
    extensions: <Puzzle size={14} className="text-text-muted shrink-0" />,
};

type AnyObject =
    | FunctionInfo
    | TriggerInfo
    | SequenceInfo
    | EnumInfo
    | ExtensionInfo;

/** Build a unique key per item. Functions use their signature to disambiguate overloads. */
function itemKey(item: AnyObject): string {
    const name = (item as any).name as string;
    if ("argument_types" in item && Array.isArray(item.argument_types)) {
        return `${name}(${item.argument_types.join(",")})`;
    }
    return name;
}

/** Display name for the tree list. Functions show their argument signature. */
function itemLabel(item: AnyObject): string {
    const name = (item as any).name as string;
    if ("argument_types" in item && Array.isArray(item.argument_types) && item.argument_types.length > 0) {
        return `${name}(${item.argument_types.join(", ")})`;
    }
    return name;
}

function SourceCode({ source }: { source: string }) {
    const [expanded, setExpanded] = useState(false);
    const maxLen = 800;
    const truncated = source.length > maxLen && !expanded;
    const display = truncated ? source.slice(0, maxLen) : source;

    return (
        <div>
            <pre className="text-xs text-text leading-relaxed bg-surface-raised rounded-lg p-4 overflow-x-auto whitespace-pre font-mono border border-border">
                {display}
                {truncated && (
                    <span className="text-text-subtle">...</span>
                )}
            </pre>
            {source.length > maxLen && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs text-accent hover:underline mt-2"
                >
                    {expanded ? "Show less" : "Show full source"}
                </button>
            )}
        </div>
    );
}

function renderDetail(type: ObjectType, item: AnyObject) {
    switch (type) {
        case "functions": {
            const f = item as FunctionInfo;
            return (
                <div className="space-y-4">
                    {/* Metadata card */}
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                        <div className="px-4 py-2 border-b border-border">
                            <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                Signature
                            </h4>
                        </div>
                        <div className="divide-y divide-border">
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Returns</span>
                                <span className="text-sm text-accent font-mono">{f.return_type || "void"}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Language</span>
                                <span className="text-sm text-text">{f.language}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Kind</span>
                                <span className="text-sm text-text">{f.kind === "f" ? "Function" : "Procedure"}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Schema</span>
                                <span className="text-sm text-text font-mono">{f.schema}</span>
                            </div>
                        </div>
                    </div>

                    {/* Arguments */}
                    {f.argument_names.length > 0 && (
                        <div className="rounded-lg border border-border bg-surface overflow-hidden">
                            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                                <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Arguments
                                </h4>
                                <span className="text-[10px] text-text-subtle">
                                    {f.argument_names.length} total
                                </span>
                            </div>
                            <div className="divide-y divide-border">
                                {f.argument_names.map((name, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center px-4 py-2.5"
                                    >
                                        <div className="w-24 shrink-0">
                                            <span className="text-xs text-text-muted">
                                                {f.argument_modes?.[i] &&
                                                    f.argument_modes[i] !==
                                                        "IN" && (
                                                        <span className="text-amber-400 font-medium mr-1">
                                                            {
                                                                f.argument_modes[
                                                                    i
                                                                ]
                                                            }
                                                        </span>
                                                    )}
                                                #{i + 1}
                                            </span>
                                        </div>
                                        <span className="text-sm text-accent font-mono">
                                            {name}
                                        </span>
                                        <span className="mx-2 text-border">
                                            :
                                        </span>
                                        <span className="text-sm text-text-muted font-mono">
                                            {f.argument_types?.[i] ||
                                                "unknown"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Source */}
                    {f.source && (
                        <div className="rounded-lg border border-border bg-surface overflow-hidden">
                            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                                <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Source
                                </h4>
                                <span className="text-[10px] text-text-subtle">
                                    {f.language}
                                </span>
                            </div>
                            <div className="p-4">
                                <SourceCode source={f.source} />
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        case "triggers": {
            const t = item as TriggerInfo;
            return (
                <div className="space-y-4">
                    {/* Metadata */}
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                        <div className="px-4 py-2 border-b border-border">
                            <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                Details
                            </h4>
                        </div>
                        <div className="divide-y divide-border">
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Table</span>
                                <span className="text-sm text-text font-mono">{t.table_schema}.{t.table_name}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Event</span>
                                <span className="text-sm text-text">{t.event_manipulation}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Timing</span>
                                <span className="text-sm text-text">{t.action_timing} {t.action_orientation}</span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Status</span>
                                <span className={`text-sm ${t.enabled === "O" ? "text-emerald-400" : "text-red-400"}`}>
                                    {t.enabled === "O" ? "Enabled" : t.enabled === "D" ? "Disabled" : t.enabled}
                                </span>
                            </div>
                            <div className="flex items-center px-4 py-2.5">
                                <span className="text-xs text-text-muted w-24 shrink-0">Schema</span>
                                <span className="text-sm text-text font-mono">{t.schema}</span>
                            </div>
                        </div>
                    </div>

                    {/* Definition */}
                    {t.action_statement && (
                        <div className="rounded-lg border border-border bg-surface overflow-hidden">
                            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                                <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                    Definition
                                </h4>
                                <span className="text-[10px] text-text-subtle">SQL</span>
                            </div>
                            <div className="p-4">
                                <SourceCode source={t.action_statement} />
                            </div>
                        </div>
                    )}
                </div>
            );
        }
        case "sequences": {
            const s = item as SequenceInfo;
            return (
                <div className="rounded-lg border border-border bg-surface overflow-hidden">
                    <div className="px-4 py-2 border-b border-border">
                        <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Sequence Values
                        </h4>
                    </div>
                    <div className="divide-y divide-border">
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-28 shrink-0">Current Value</span>
                            <span className="text-sm text-accent font-mono">{s.current_value}</span>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-28 shrink-0">Increment</span>
                            <span className="text-sm text-text font-mono">{s.increment}</span>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-28 shrink-0">Start</span>
                            <span className="text-sm text-text font-mono">{s.start_value}</span>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-28 shrink-0">Min / Max</span>
                            <span className="text-sm text-text font-mono">{s.min_value} / {s.max_value}</span>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-28 shrink-0">Cycle</span>
                            <span className={`text-sm ${s.cycle ? "text-amber-400" : "text-text-muted"}`}>
                                {s.cycle ? "Yes" : "No"}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }
        case "enums": {
            const e = item as EnumInfo;
            return (
                <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                        <div className="px-4 py-2 border-b border-border">
                            <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                Details
                            </h4>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-24 shrink-0">Schema</span>
                            <span className="text-sm text-text font-mono">{e.schema}</span>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border bg-surface overflow-hidden">
                        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                            <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                                Values
                            </h4>
                            <span className="text-[10px] text-text-subtle">{e.labels.length} labels</span>
                        </div>
                        <div className="p-4">
                            <div className="flex flex-wrap gap-2">
                                {e.labels.map((label) => (
                                    <span
                                        key={label}
                                        className="inline-flex items-center px-3 py-1.5 text-xs rounded-md bg-accent/10 text-accent border border-accent/20 font-mono"
                                    >
                                        {label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        case "extensions": {
            const e = item as ExtensionInfo;
            return (
                <div className="rounded-lg border border-border bg-surface overflow-hidden">
                    <div className="px-4 py-2 border-b border-border">
                        <h4 className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                            Extension
                        </h4>
                    </div>
                    <div className="divide-y divide-border">
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-24 shrink-0">Version</span>
                            <span className="text-sm text-text font-mono">{e.version}</span>
                        </div>
                        <div className="flex items-center px-4 py-2.5">
                            <span className="text-xs text-text-muted w-24 shrink-0">Schema</span>
                            <span className="text-sm text-text font-mono">{e.schema}</span>
                        </div>
                        {e.comment && (
                            <div className="px-4 py-2.5">
                                <span className="text-xs text-text-muted block mb-1">Comment</span>
                                <p className="text-sm text-text leading-relaxed">{e.comment}</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
    }
}

export function ObjectExplorerPage({
    type,
    connectionId,
}: ObjectExplorerPageProps) {
    const [panelWidth, setPanelWidth] = useState(280);
    const panelResizeRef = useRef<{ startX: number; startW: number } | null>(null);

    const onPanelResizeStart = useCallback((e: React.MouseEvent) => {
        panelResizeRef.current = { startX: e.clientX, startW: panelWidth };
        const onMove = (ev: MouseEvent) => {
            if (!panelResizeRef.current) return;
            const delta = ev.clientX - panelResizeRef.current.startX;
            const next = Math.max(180, Math.min(500, panelResizeRef.current.startW + delta));
            setPanelWidth(next);
        };
        const onUp = () => {
            panelResizeRef.current = null;
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }, [panelWidth]);

    const databases = useDbViewerStore((s) => s.databases);
    const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
    const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
    const schemas = useDbViewerStore((s) => s.schemas);
    const currentSchema = useDbViewerStore((s) => s.currentSchema);
    const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);

    // Use store for persistence, but allow re-fetching when schema changes
    const [items, setItems] = useState<AnyObject[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedItem, setSelectedItem] = useState<AnyObject | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);

    // Track last-fetched-schema so we know when to re-fetch
    const lastSchemaRef = useRef<string | undefined>(undefined);

    // Fetch on mount and when schema changes
    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let result: AnyObject[];
            if (type === "extensions") {
                result = await cmd.getExtensions(connectionId);
            } else if (type === "functions") {
                result = await cmd.getFunctions(
                    connectionId,
                    currentSchema ?? undefined,
                );
            } else if (type === "triggers") {
                result = await cmd.getTriggers(
                    connectionId,
                    currentSchema ?? undefined,
                );
            } else if (type === "sequences") {
                result = await cmd.getSequences(
                    connectionId,
                    currentSchema ?? undefined,
                );
            } else if (type === "enums") {
                result = await cmd.getEnums(
                    connectionId,
                    currentSchema ?? undefined,
                );
            } else {
                result = [];
            }
            setItems(result);
            setSelectedItem(null);
            lastSchemaRef.current = currentSchema ?? undefined;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setItems(null);
        } finally {
            setLoading(false);
        }
    }, [type, connectionId, currentSchema]);

    useEffect(() => {
        // Only re-fetch if schema actually changed (or first load)
        if (lastSchemaRef.current !== (currentSchema ?? undefined)) {
            fetch();
        }
    }, [currentSchema, fetch]);

    // Search toggle handling
    useEffect(() => {
        if (searchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [searchOpen]);

    const handleSearchBlur = useCallback(() => {
        setTimeout(() => {
            if (!searchQuery.trim()) {
                setSearchOpen(false);
            }
        }, 150);
    }, [searchQuery]);

    const toggleSearch = useCallback(() => {
        setSearchOpen((prev) => {
            const next = !prev;
            if (!next) setSearchQuery("");
            return next;
        });
    }, []);

    const q = searchQuery.toLowerCase().trim();
    const filtered = useMemo(() => {
        if (!items) return [];
        if (!q) return items;
        return items.filter((item) => {
            const label = itemLabel(item).toLowerCase();
            return label.includes(q);
        });
    }, [items, q]);

    const icon = ICONS[type];
    const label = TYPE_LABELS[type];
    const singular = SINGULAR_LABELS[type];

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left panel: toolbar + object list */}
            <div
                className="border-r border-border flex flex-col shrink-0"
                style={{ width: panelWidth }}
            >
                <div className="p-3 border-b border-border space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-text">
                            {label}
                        </span>
                        <div className="flex items-center gap-1">
                            <button
                                aria-label="Refresh"
                                onClick={fetch}
                                disabled={loading}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer disabled:opacity-50"
                            >
                                <RefreshCw
                                    size={14}
                                    className={loading ? "animate-spin" : ""}
                                />
                            </button>
                            <button
                                aria-label={`Search ${label}`}
                                onClick={toggleSearch}
                                className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${searchOpen ? "text-accent bg-accent/10" : "text-text-muted hover:text-text hover:bg-surface-raised"}`}
                            >
                                <Search size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Search input */}
                    <div
                        ref={searchContainerRef}
                        className={`overflow-hidden transition-all duration-200 ease-out ${searchOpen ? "max-h-10 opacity-100" : "max-h-0 opacity-0"}`}
                    >
                        <div className="relative flex items-center">
                            <Search
                                size={12}
                                className="absolute left-2.5 text-text-muted pointer-events-none"
                            />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) =>
                                    setSearchQuery(e.target.value)
                                }
                                onBlur={handleSearchBlur}
                                placeholder={`Filter ${label.toLowerCase()}…`}
                                className="w-full bg-transparent border-0 border-b border-border pl-8 pr-7 py-1.5 text-xs text-text placeholder:text-text-muted/60 outline-none focus:border-accent/50 transition-colors"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    className="absolute right-1 flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text cursor-pointer"
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Database/Schema dropdowns */}
                    {(databases.length > 1 || schemas.length > 1) && (
                        <div className="flex items-center gap-2">
                            {databases.length > 1 && (
                                <SelectDropdown
                                    value={currentDatabase ?? ""}
                                    onChange={(v) =>
                                        setCurrentDatabase(v || null)
                                    }
                                    options={databases.map((d) => ({
                                        value: d,
                                        label: d,
                                    }))}
                                    placeholder="Select database"
                                    aria-label="Select database"
                                    variant="ghost"
                                />
                            )}
                            {databases.length > 1 && schemas.length > 1 && (
                                <span className="text-border">|</span>
                            )}
                            {schemas.length > 1 && (
                                <SelectDropdown
                                    value={currentSchema ?? ""}
                                    onChange={(v) =>
                                        setCurrentSchema(v || null)
                                    }
                                    options={schemas.map((s) => ({
                                        value: s,
                                        label: s,
                                    }))}
                                    placeholder="Select schema"
                                    aria-label="Select schema"
                                    variant="ghost"
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Object list */}
                <div
                    className="flex-1 overflow-y-auto"
                    style={{ overscrollBehavior: "none" }}
                >
                    {loading && (
                        <div className="flex items-center justify-center py-8 text-sm text-text-muted">
                            <RefreshCw
                                size={14}
                                className="animate-spin mr-2"
                            />
                            Loading {label.toLowerCase()}...
                        </div>
                    )}

                    {error && (
                        <div className="px-3 py-2 text-sm text-red-400">
                            {error}
                        </div>
                    )}

                    {!loading &&
                        !error &&
                        filtered.length === 0 && (
                            <div className="px-3 py-2 text-sm text-text-muted">
                                {items === null
                                    ? `No ${label.toLowerCase()} found`
                                    : searchQuery
                                      ? `No ${label.toLowerCase()} matching "${searchQuery}"`
                                      : `No ${label.toLowerCase()} found in ${currentSchema || "current schema"}`}
                            </div>
                        )}

                    {!loading &&
                        filtered.map((item) => {
                            const name = itemLabel(item);
                            const key = itemKey(item);
                            const isSelected =
                                selectedItem !== null &&
                                itemKey(selectedItem) === itemKey(item);

                            return (
                                <div
                                    key={key}
                                    onClick={() => setSelectedItem(item)}
                                    className={`group flex items-center gap-1 px-3 py-1 cursor-pointer transition-colors ${
                                        isSelected
                                            ? "bg-accent/10 text-accent"
                                            : "text-text hover:bg-surface-raised"
                                    }`}
                                >
                                    {icon}
                                    <span className="flex-1 text-sm truncate">
                                        {name}
                                    </span>
                                    <ChevronRight
                                        size={14}
                                        className={`text-text-muted shrink-0 transition-transform ${
                                            isSelected ? "rotate-90" : ""
                                        }`}
                                    />
                                </div>
                            );
                        })}
                </div>
            </div>

            {/* Panel resize handle */}
            <div
                className="w-1 cursor-col-resize bg-border/20 hover:bg-accent/30 active:bg-accent/50 shrink-0 border-r border-border"
                onMouseDown={onPanelResizeStart}
                onDoubleClick={() => setPanelWidth(280)}
            />

            {/* Right panel: detail view */}
            <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
                {selectedItem ? (
                    <div className="p-6">
                        {/* Header */}
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                                {icon}
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-text font-mono">
                                    {itemLabel(selectedItem)}
                                </h2>
                                <p className="text-xs text-text-muted capitalize">
                                    {singular}
                                    {"schema" in selectedItem
                                        ? ` · ${(selectedItem as any).schema}`
                                        : ""}
                                </p>
                            </div>
                        </div>

                        {/* Detail content */}
                        <div className="max-w-2xl">
                            {renderDetail(type, selectedItem)}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-text-muted">
                        <div className="text-center space-y-2">
                            <div className="w-12 h-12 mx-auto rounded-full bg-surface flex items-center justify-center">
                                {icon}
                            </div>
                            <p className="text-sm">
                                Select a {singular} to view details
                            </p>
                            <p className="text-xs text-text-subtle">
                                {filtered.length} {label.toLowerCase()}{" "}
                                available
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}