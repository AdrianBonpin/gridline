import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Table2, Layers, Eye, Key, Type } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { TableOverflowMenu } from "./TableOverflowMenu";
import { abbreviateType } from "../../lib/utils";
import {
    columnCacheKey,
    metadataScopeKey,
    type MetadataScope,
} from "../../lib/tabIdentity";
import type { ColumnInfo } from "../../lib/types";
import * as cmd from "../../lib/commands";
import { fkLabel, fkTarget } from "../../lib/fkTarget";

export function TableTree({ searchQuery, dbType }: { searchQuery?: string; dbType?: string }) {
    const tables = useDbViewerStore((s) => s.tables);
    const currentSchema = useDbViewerStore((s) => s.currentSchema);
    const schemaTreeLoading = useDbViewerStore((s) => s.schemaTreeLoading);
    const openTab = useDbViewerStore((s) => s.openTab);
    const connectionId = useUiStore((s) => s.activeConnectionId);
    const currentDatabase = useDbViewerStore((s) => s.currentDatabase);
    const metadataRev = useDbViewerStore((s) => s.metadataRev);
    // Expanded-row columns belong to the connection + database they were read
    // from. The cache key carries that scope, so the same table name in another
    // database can never be answered with this one's columns.
    const scope: MetadataScope = useMemo(
        () => ({ connectionId, database: currentDatabase }),
        [connectionId, currentDatabase],
    );
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [columnCache, setColumnCache] = useState<
        Record<string, ColumnInfo[]>
    >({});
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    // Scope + metadata revision the cached columns were read under. A late
    // response from a superseded generation is dropped instead of cached.
    const scopeKey = metadataScopeKey(scope);
    const metadataGenerationRef = useRef(`${scopeKey}\u0000${metadataRev}`);
    const lastScopeRef = useRef(metadataGenerationRef.current);

    const loadColumns = useCallback(
        async (schema: string, tableName: string) => {
            const { connectionId: conn } = scopeRef.current;
            if (!conn) return;
            const key = columnCacheKey(scopeRef.current, schema, tableName);
            // A response that was requested before a database switch or a
            // metadata invalidation describes a superseded environment, so it
            // must never be written into the cache after the fact.
            const requestedIn = metadataGenerationRef.current;
            try {
                // Column metadata is a catalog read, not a row page: asking the
                // paginated table read for it would either truncate rows (a
                // tiny page) or be rejected as an out-of-range page size.
                const columns = await cmd.getTableColumns(conn, schema, tableName);
                if (metadataGenerationRef.current !== requestedIn) return;
                // Merge into the cache: a second expanded row keeps its own entry.
                setColumnCache((prev) => ({ ...prev, [key]: columns }));
            } catch {
                /* ignore, columns will remain unknowns */
            }
        },
        [],
    );

    // A database switch or a metadata invalidation (relevant DDL, rebuild,
    // reconnect) makes every cached column list unreachable: drop it and
    // re-introspect whatever is expanded right now.
    useEffect(() => {
        const current = `${scopeKey}\u0000${metadataRev}`;
        if (lastScopeRef.current === current) return;
        lastScopeRef.current = current;
        metadataGenerationRef.current = current;
        setColumnCache({});
        for (const rowKey of expanded) {
            const sep = rowKey.indexOf("\u0000");
            const schema = rowKey.slice(0, sep);
            const tableName = rowKey.slice(sep + 1);
            void loadColumns(schema, tableName);
        }
    }, [scopeKey, metadataRev, expanded, loadColumns]);

    const q = (searchQuery ?? "").toLowerCase().trim();

    const filteredTables = (
        currentSchema
            ? tables.filter((t) => t.schema === currentSchema)
            : tables
    ).filter((t) => !q || t.name.toLowerCase().includes(q));

    const rowKeyFor = (schema: string, table: string) => `${schema}\u0000${table}`;

    const toggle = async (schema: string, tableName: string) => {
        const rowKey = rowKeyFor(schema, tableName);
        const isExpanded = expanded.has(rowKey);
        setExpanded((prev) => {
            const next = new Set(prev);
            if (isExpanded) next.delete(rowKey);
            else next.add(rowKey);
            return next;
        });
        // Fetch columns if this origin has not introspected them yet
        const cacheKey = columnCacheKey(scope, schema, tableName);
        if (!isExpanded && !columnCache[cacheKey]) {
            void loadColumns(schema, tableName);
        }
    };

    const handleOpenTab = (
        schema: string,
        table: string,
        forceNew?: boolean,
    ) => {
        openTab(schema, table, forceNew);
        return "tab";
    };

    return (
        <div>
            {filteredTables.length === 0 && (
                <div className="px-3 py-2 text-sm text-text-muted">
                    {schemaTreeLoading ? "Loading…" : "No tables"}
                </div>
            )}
            {filteredTables.map((table) => {
                const rowKey = rowKeyFor(table.schema, table.name);
                const isExpanded = expanded.has(rowKey);
                const cols =
                    columnCache[columnCacheKey(scope, table.schema, table.name)] ??
                    table.columns ??
                    [];
                const isMatView = table.table_type === "MATERIALIZED VIEW";
                const isView = table.table_type === "VIEW";
                const TypeIcon = isMatView ? Layers : isView ? Eye : Table2;
                const typeLabel = isMatView
                    ? "Materialized View"
                    : isView
                      ? "View"
                      : null;
                return (
                    <div key={rowKey}>
                        <div
                            className="group flex items-center gap-1 px-3 py-1 hover:bg-surface-raised cursor-pointer"
                            onClick={() => openTab(table.schema, table.name)}
                            data-testid="table-tree-item"
                            data-table-name={table.name}
                        >
                            <button
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(table.schema, table.name);
                                }}
                                className="w-5 h-5 flex items-center justify-center text-text-muted hover:text-text cursor-pointer"
                            >
                                {isExpanded ? (
                                    <ChevronDown size={14} />
                                ) : (
                                    <ChevronRight size={14} />
                                )}
                            </button>
                            <TypeIcon size={14} className="text-text-muted" />
                            <span className="flex-1 text-left text-sm text-text group-hover:text-accent truncate">
                                {table.name}
                            </span>
                            {typeLabel && (
                                <span className="text-[10px] text-text-subtle shrink-0">
                                    {typeLabel}
                                </span>
                            )}
                            <div onClick={(e) => e.stopPropagation()}>
                                <TableOverflowMenu
                                    schema={table.schema}
                                    table={table.name}
                                    tableType={table.table_type}
                                    connectionId={connectionId ?? undefined}
                                    dbType={dbType}
                                    columns={cols}
                                    onOpenTab={handleOpenTab}
                                />
                            </div>
                        </div>
                        {isExpanded && (
                            <div className="pl-10 pr-3 py-1 space-y-1">
                                {cols.length === 0 && (
                                    <div className="text-xs text-text-muted">
                                        No columns
                                    </div>
                                )}
                                {cols.map((col) => (
                                    <div
                                        key={col.name}
                                        className="flex items-center gap-2 text-xs text-text-muted"
                                        title={
                                            col.is_fk && col.fk_ref
                                                ? `${col.data_type} → ${fkLabel(fkTarget(col))}`
                                                : col.data_type
                                        }
                                    >
                                        {col.is_pk ? (
                                            <Key
                                                size={12}
                                                className="text-accent shrink-0"
                                            />
                                        ) : col.is_fk ? (
                                            <Key
                                                size={12}
                                                className="text-amber-400 shrink-0"
                                            />
                                        ) : (
                                            <Type
                                                size={12}
                                                className="shrink-0"
                                            />
                                        )}
                                        <span className="truncate">
                                            {col.name}
                                        </span>
                                        <span
                                            className="text-text-subtle truncate"
                                            title={col.data_type}
                                        >
                                            {abbreviateType(col.data_type)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
