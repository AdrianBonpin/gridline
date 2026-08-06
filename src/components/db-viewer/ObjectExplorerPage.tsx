import { useEffect, useState, useMemo, useCallback, useRef, cloneElement } from "react";
import { ChevronRight, Plus, Search, X, RefreshCw } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { SelectDropdown } from "../ui/SelectDropdown";
import { DependencyDialog } from "./DependencyDialog";
import { ObjectContextMenu, ObjectFormFields } from "./objects/ObjectContextMenu";
import { ObjectCrudDialog } from "./objects/ObjectCrudDialog";
import {
    ObjectDetail,
    OBJECT_ICONS,
    TYPE_LABELS,
    SINGULAR_LABELS,
    type AnyObject,
} from "./objects/ObjectDetail";
import { initialCrudParams, type DdlParams, type ObjectKind } from "../../lib/objectCrud";
import * as cmd from "../../lib/commands";
import type { ObjectType, DependencyInfo } from "../../lib/types";



interface ObjectExplorerPageProps {
    connectionId: string;
    sidebarMode?: boolean;
}

const OBJECT_TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as ObjectType[]).map(
    (t) => ({ value: t, label: TYPE_LABELS[t] }),
);

/** Natural plural for empty-state copy, derived from SINGULAR_LABELS with known irregulars mapped explicitly. */
function emptyPlural(type: ObjectType): string {
    const singular = SINGULAR_LABELS[type];
    const irregulars: Record<string, string> = {
        index: "indexes",
        constraint: "constraints",
    };
    return irregulars[singular] ?? `${singular}s`;
}

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
    if (
        "argument_types" in item &&
        Array.isArray(item.argument_types) &&
        item.argument_types.length > 0
    ) {
        return `${name}(${item.argument_types.join(", ")})`;
    }
    return name;
}

function schemaOf(item: AnyObject): string {
    return item.schema;
}

function objectName(item: AnyObject): string {
    return item.name;
}

function typeToDdlType(type: ObjectType): string {
    const map: Record<ObjectType, string> = {
        functions: "function",
        procedures: "procedure",
        triggers: "trigger",
        sequences: "sequence",
        enums: "enum",
        extensions: "extension",
        indexes: "index",
        constraints: "constraint",
    };
    return map[type];
}

export function ObjectExplorerPage({
    connectionId,
    sidebarMode = false,
}: ObjectExplorerPageProps) {
    const selectedObjectType = useDbViewerStore((s) => s.selectedObjectType);
    const [type, setType] = useState<ObjectType>(selectedObjectType ?? "functions");
    const [panelWidth, setPanelWidth] = useState(280);
    const panelResizeRef = useRef<{ startX: number; startW: number } | null>(
        null,
    );

    const onPanelResizeStart = useCallback(
        (e: React.MouseEvent) => {
            panelResizeRef.current = { startX: e.clientX, startW: panelWidth };
            const onMove = (ev: MouseEvent) => {
                if (!panelResizeRef.current) return;
                const delta = ev.clientX - panelResizeRef.current.startX;
                const next = Math.max(
                    180,
                    Math.min(500, panelResizeRef.current.startW + delta),
                );
                setPanelWidth(next);
            };
            const onUp = () => {
                panelResizeRef.current = null;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
            };
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [panelWidth],
    );

    const databases = useDbViewerStore((s) => s.databases);
    const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
    const setCurrentDatabase = useDbViewerStore((s) => s.setCurrentDatabase);
    const schemas = useDbViewerStore((s) => s.schemas);
    const currentSchema = useDbViewerStore((s) => s.currentSchema);
    const setCurrentSchema = useDbViewerStore((s) => s.setCurrentSchema);
    const changesQueue = useDbViewerStore((s) => s.changesQueue);
    const openObjectTab = useDbViewerStore((s) => s.openObjectTab);
    const refreshTree = useDbViewerStore((s) => s.refreshTree);

    // Use store for persistence, but allow re-fetching when schema changes
    const [items, setItems] = useState<AnyObject[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedItem, setSelectedItem] = useState<AnyObject | null>(null);
    const [openKey, setOpenKey] = useState<string | null>(null);
    const [depOpen, setDepOpen] = useState(false);
    const [depDeps, setDepDeps] = useState<DependencyInfo[]>([]);
    const [crudOpen, setCrudOpen] = useState(false);
    const [crudParams, setCrudParams] = useState<DdlParams>({});
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);

    // Track last-fetched-schema so we know when to re-fetch
    const lastSchemaRef = useRef<string | undefined>(undefined);
    // Track the last committed ddl change so a commit triggers exactly one
    // refetch (no duplicate refetches across re-renders).
    const lastCommittedDdlRef = useRef<string>("");

    // Fetch on mount and when schema changes
    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            let result: AnyObject[];
            if (type === "extensions") {
                result = await cmd.getExtensions(connectionId);
            } else if (type === "functions") {
                result = (await cmd.getFunctions(
                    connectionId,
                    currentSchema ?? undefined,
                )).filter((f) => f.kind === "f");
            } else if (type === "procedures") {
                result = (await cmd.getFunctions(
                    connectionId,
                    currentSchema ?? undefined,
                )).filter((f) => f.kind === "p");
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
            } else if (type === "indexes") {
                result = await cmd.getIndexes(
                    connectionId,
                    currentSchema ?? undefined,
                );
            } else if (type === "constraints") {
                result = await cmd.getConstraints(
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

    // After a commit containing ddl items succeeds, refetch the current
    // object-type list + refresh the schema tree so newly created/dropped
    // objects show up without a manual refresh.
    useEffect(() => {
        const committedDdl = changesQueue.filter(
            (c) => c.type === "ddl" && c.status === "committed",
        );
        const lastCommitted = committedDdl[committedDdl.length - 1];
        if (lastCommitted && lastCommitted.id !== lastCommittedDdlRef.current) {
            lastCommittedDdlRef.current = lastCommitted.id;
            fetch();
            void refreshTree(connectionId, currentSchema ?? undefined);
        }
    }, [changesQueue, connectionId, currentSchema, fetch, refreshTree]);

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

    const icon = OBJECT_ICONS[type];
    const label = TYPE_LABELS[type];
    const singular = SINGULAR_LABELS[type];

    // Header create button: open the CRUD dialog prefilled with create state for the current type.
    const openCreate = useCallback(() => {
        const kind = typeToDdlType(type) as ObjectKind;
        setCrudParams(
            initialCrudParams(kind, { schema: currentSchema ?? "public", name: "" }, "create"),
        );
        setCrudOpen(true);
    }, [type, currentSchema]);

    // Switching object type: reset selection/search, clear the stale list so
    // the loading state renders (no flash of the previous type's objects), and
    // reset the last-fetched-schema marker so the fetch effect re-runs.
    const handleTypeChange = useCallback((next: ObjectType) => {
        setType(next);
        setSearchQuery("");
        setSelectedItem(null);
        setOpenKey(null);
        setItems(null);
        setLoading(true);
        lastSchemaRef.current = undefined;
    }, []);

    // Consume any object-type preselection from the Cmd+K palette.
    useEffect(() => {
        if (selectedObjectType && selectedObjectType !== type) {
            handleTypeChange(selectedObjectType);
        }
        if (selectedObjectType) {
            useDbViewerStore.getState().setSelectedObjectType(null);
        }
    }, [selectedObjectType, type, handleTypeChange]);

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left panel: toolbar + object list */}
            <div
                className={
                    sidebarMode
                        ? "flex flex-col flex-1 min-h-0 overflow-hidden"
                        : "border-r border-border flex flex-col shrink-0"
                }
                style={sidebarMode ? undefined : { width: panelWidth }}
            >
                <div className="p-3 border-b border-border space-y-2">
                    <div className="flex items-center justify-between">
                        <SelectDropdown
                            value={type}
                            onChange={(v) => handleTypeChange(v as ObjectType)}
                            options={OBJECT_TYPE_OPTIONS}
                            variant="ghost"
                            aria-label="Object type"
                        />
                        <div className="flex items-center gap-1">
                            <button
                                aria-label={`Create ${singular}`}
                                onClick={openCreate}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
                            >
                                <Plus size={14} />
                            </button>
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
                                onChange={(e) => setSearchQuery(e.target.value)}
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

                    {!loading && !error && filtered.length === 0 && (
                        <div className="px-3 py-2 text-sm text-text-muted">
                            {searchQuery
                                ? `No ${emptyPlural(type)} matching "${searchQuery}"`
                                : `No ${emptyPlural(type)} found`}
                        </div>
                    )}

                    {!loading &&
                        filtered.map((item) => {
                            const name = itemLabel(item);
                            const key = itemKey(item);
                            const isSelected =
                                selectedItem !== null &&
                                itemKey(selectedItem) === itemKey(item);

                            const handleCopyDdl = async () => {
                                setOpenKey(null);
                                const ddl = await cmd.getObjectDdl(
                                    connectionId,
                                    schemaOf(item),
                                    typeToDdlType(type),
                                    objectName(item),
                                );
                                try {
                                    await navigator.clipboard?.writeText(ddl);
                                } catch {
                                    // Ignore clipboard errors.
                                }
                            };

                            const handleViewDependencies = async () => {
                                setOpenKey(null);
                                const deps = await cmd.getObjectDependencies(
                                    connectionId,
                                    schemaOf(item),
                                    typeToDdlType(type),
                                    objectName(item),
                                );
                                setDepDeps(deps);
                                setDepOpen(true);
                            };

                            return (
                                <div
                                    key={key}
                                    onClick={() =>
                                        sidebarMode
                                            ? openObjectTab(
                                                  type,
                                                  item.schema,
                                                  item.name,
                                                  item,
                                              )
                                            : setSelectedItem(item)
                                    }
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setOpenKey(key);
                                    }}
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
                                    <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="relative shrink-0"
                                    >
                                        <ObjectContextMenu
                                            connectionId={connectionId}
                                            objectType={
                                                typeToDdlType(type) as ObjectKind
                                            }
                                            item={item}
                                            onRefresh={fetch}
                                            open={openKey === key}
                                            onOpenChange={(o) =>
                                                setOpenKey(o ? key : null)
                                            }
                                            extraItems={[
                                                {
                                                    id: "copy-ddl",
                                                    label: "Copy DDL",
                                                    onClick: handleCopyDdl,
                                                },
                                                {
                                                    id: "dependencies",
                                                    label: "Dependencies",
                                                    onClick:
                                                        handleViewDependencies,
                                                },
                                            ]}
                                        />
                                    </div>
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

            {!sidebarMode && (
                <>
                    {/* Panel resize handle */}
                    <div
                        className="w-1 cursor-col-resize bg-border/20 hover:bg-accent/30 active:bg-accent/50 shrink-0 border-r border-border"
                        onMouseDown={onPanelResizeStart}
                        onDoubleClick={() => setPanelWidth(280)}
                    />

                    {/* Right panel: detail view */}
                    <div className="flex-1 w-0 flex flex-col min-w-0 overflow-y-auto overflow-x-hidden">
                        {selectedItem ? (
                            <>
                                {/* Header */}
                                <div className="px-4 py-2 flex flex-row items-center justify-between border-b border-border">
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

                                {/* Detail content */}
                                <div style={{ overflowX: "auto", width: "100%" }}>
                                    <ObjectDetail
                                        connectionId={connectionId}
                                        type={type}
                                        item={selectedItem}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="flex items-center justify-center h-full text-text-muted">
                                <div className="text-center space-y-2">
                                    <div className="flex justify-center">
                                        {cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 20 })}
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
                </>
            )}

            <DependencyDialog
                open={depOpen}
                deps={depDeps}
                onProceed={() => setDepOpen(false)}
                onCancel={() => setDepOpen(false)}
            />

            <ObjectCrudDialog
                open={crudOpen}
                connectionId={connectionId}
                kind={typeToDdlType(type) as ObjectKind}
                title={`Create ${typeToDdlType(type)}`}
                params={crudParams}
                description={`Create ${typeToDdlType(type)}`}
                onClose={() => setCrudOpen(false)}
            >
                <ObjectFormFields
                    connectionId={connectionId}
                    kind={typeToDdlType(type) as ObjectKind}
                    params={crudParams}
                    onChange={setCrudParams}
                />
            </ObjectCrudDialog>
        </div>
    );
}
