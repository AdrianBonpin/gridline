import {
    RefreshCw,
    Plus,
    Search,
    Pencil,
    Check,
    AlertCircle,
    X,
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { SelectDropdown } from "../ui/SelectDropdown";
import { Tooltip } from "../ui/Tooltip";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import * as cmd from "../../lib/commands";
import { SchemaMenu } from "./SchemaMenu";

export function DbViewerToolbar({
    databases,
    currentDatabase,
    setCurrentDatabase,
    schemas,
    currentSchema,
    setCurrentSchema,
    onEdit,
    connectionId,
    searchQuery,
    onSearchChange,
}: {
    databases: string[];
    currentDatabase: string | null;
    setCurrentDatabase: (db: string | null) => void;
    schemas: string[];
    currentSchema: string | null;
    setCurrentSchema: (schema: string | null) => void;
    onEdit?: () => void;
    connectionId?: string;
    searchQuery: string;
    onSearchChange: (q: string) => void;
}) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [result, setResult] = useState<"idle" | "success" | "error">("idle");
    const resultTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const searchContainerRef = useRef<HTMLDivElement>(null);
    const populate = useDbViewerStore((s) => s.populate);
    const schemaTreeLoading = useDbViewerStore((s) => s.schemaTreeLoading);

    // Focus input when search opens
    useEffect(() => {
        if (searchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [searchOpen]);

    // Auto-hide on blur when empty
    const handleSearchBlur = useCallback(() => {
        // Small delay to allow clicks on clear button / search icon
        setTimeout(() => {
            if (!searchQuery.trim()) {
                setSearchOpen(false);
            }
        }, 150);
    }, [searchQuery]);

    const toggleSearch = useCallback(() => {
        setSearchOpen((prev) => {
            const next = !prev;
            if (!next) onSearchChange(""); // clear when closing
            return next;
        });
    }, [onSearchChange]);

    // Cleanup result timer on unmount
    useEffect(() => {
        return () => {
            if (resultTimer.current) clearTimeout(resultTimer.current);
        };
    }, []);

    const handleRefresh = useCallback(async () => {
        if (!connectionId || refreshing) return;
        setRefreshing(true);
        setResult("idle");
        try {
            const dbs = await cmd.getDatabases(connectionId);
            const scs = await cmd.getSchemas(connectionId);
            const tbls = await cmd.getTables(connectionId);
            populate(dbs, scs, tbls);
            setResult("success");
        } catch {
            setResult("error");
        } finally {
            setRefreshing(false);
            resultTimer.current = setTimeout(() => setResult("idle"), 1500);
        }
    }, [connectionId, refreshing, populate]);

    const hasBelow =
      searchOpen || databases.length > 1 || schemas.length > 1 || schemaTreeLoading;

    return (
        <div
            className={`px-3 pt-3 border-b border-border space-y-2 ${hasBelow ? "pb-3" : ""}`}
        >
            <div className="flex items-center justify-between">
                <span className="text-sm font-normal text-text-muted">Tables</span>
                <div className="flex items-center gap-1">
                    {onEdit && (
                        <Tooltip content="Edit Connection" side="bottom">
                            <button
                                aria-label="Edit Connection"
                                onClick={onEdit}
                                className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer"
                            >
                                <Pencil size={14} />
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip
                        content={
                            result === "success"
                                ? "Refreshed"
                                : result === "error"
                                  ? "Refresh failed"
                                  : "Refresh Database"
                        }
                        side="bottom"
                    >
                        <button
                            aria-label="Refresh"
                            onClick={handleRefresh}
                            disabled={refreshing}
                            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer disabled:opacity-50"
                        >
                            {refreshing ? (
                                <RefreshCw size={14} className="animate-spin" />
                            ) : result === "success" ? (
                                <Check size={14} className="text-emerald-400" />
                            ) : result === "error" ? (
                                <AlertCircle
                                    size={14}
                                    className="text-red-400"
                                />
                            ) : (
                                <RefreshCw size={14} />
                            )}
                        </button>
                    </Tooltip>
                    <Tooltip content="Create Table" side="bottom">
                        <button
                            aria-label="Create Table"
                            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-raised cursor-pointer opacity-50"
                        >
                            <Plus size={14} />
                        </button>
                    </Tooltip>
                    <Tooltip content="Search Tables" side="bottom">
                        <button
                            aria-label="Search Tables"
                            onClick={toggleSearch}
                            className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${searchOpen ? "text-accent bg-accent/10" : "text-text-muted hover:text-text hover:bg-surface-raised"}`}
                        >
                            <Search size={14} />
                        </button>
                    </Tooltip>
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
                        onChange={(e) => onSearchChange(e.target.value)}
                        onBlur={handleSearchBlur}
                        placeholder="Filter tables…"
                        className="w-full bg-transparent border-0 border-b border-border pl-8 pr-7 py-1.5 text-xs text-text placeholder:text-text-muted/60 outline-none focus:border-accent/50 transition-colors"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => onSearchChange("")}
                            className="absolute right-1 flex items-center justify-center w-5 h-5 rounded text-text-muted hover:text-text cursor-pointer"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>
            {(databases.length > 1 || schemas.length > 1 || schemaTreeLoading) && (
                <div className="flex items-center gap-2">
                    {databases.length > 1 && (
                        <SelectDropdown
                            value={currentDatabase ?? ""}
                            onChange={setCurrentDatabase}
                            options={databases.map((d) => ({
                                value: d,
                                label: d,
                            }))}
                            placeholder="Select database"
                            aria-label="Select database"
                            variant="ghost"
                        />
                    )}
                    {databases.length > 1 && (schemas.length > 1 || schemaTreeLoading) && (
                        <span className="text-border">|</span>
                    )}
                    {(schemas.length > 1 || schemaTreeLoading) && (
                        <SelectDropdown
                            value={schemaTreeLoading ? "" : (currentSchema ?? "")}
                            onChange={schemaTreeLoading ? () => {} : setCurrentSchema}
                            options={
                                schemaTreeLoading
                                    ? [{ value: "", label: "Loading…" }]
                                    : schemas.map((s) => ({ value: s, label: s }))
                            }
                            placeholder={schemaTreeLoading ? "Loading…" : "Select schema"}
                            aria-label="Select schema"
                            variant="ghost"
                            disabled={schemaTreeLoading}
                        />
                    )}
                    <SchemaMenu
                        connectionId={connectionId ?? ""}
                        schema={currentSchema ?? undefined}
                        onRefresh={handleRefresh}
                    />
                </div>
            )}
        </div>
    );
}
