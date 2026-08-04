import { useState } from "react";
import { ChevronRight, ChevronDown, Table2, Layers, Eye, Key, Type } from "lucide-react";
import { useDbViewerStore } from "../../stores/dbViewerStore";
import { useUiStore } from "../../stores/uiStore";
import { TableOverflowMenu } from "./TableOverflowMenu";
import { abbreviateType } from "../../lib/utils";
import type { ColumnInfo } from "../../lib/types";
import * as cmd from "../../lib/commands";

export function TableTree({ searchQuery }: { searchQuery?: string }) {
    const tables = useDbViewerStore((s) => s.tables);
    const currentSchema = useDbViewerStore((s) => s.currentSchema);
    const schemaTreeLoading = useDbViewerStore((s) => s.schemaTreeLoading);
    const openTab = useDbViewerStore((s) => s.openTab);
    const connectionId = useUiStore((s) => s.activeConnectionId);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [columnCache, setColumnCache] = useState<
        Record<string, ColumnInfo[]>
    >({});

    const q = (searchQuery ?? "").toLowerCase().trim();

    const filteredTables = (
        currentSchema
            ? tables.filter((t) => t.schema === currentSchema)
            : tables
    ).filter((t) => !q || t.name.toLowerCase().includes(q));

    const toggle = async (key: string, schema: string, tableName: string) => {
        const isExpanded = expanded.has(key);
        setExpanded((prev) => {
            const next = new Set(prev);
            if (isExpanded) next.delete(key);
            else next.add(key);
            return next;
        });
        // Fetch columns if not cached
        if (!isExpanded && !columnCache[key] && connectionId) {
            try {
                const result = await cmd.getTableData(
                    connectionId,
                    schema,
                    tableName,
                    1,
                    0,
                );
                setColumnCache((prev) => ({ ...prev, [key]: result.columns }));
            } catch {
                /* ignore, columns will remain unknowns */
            }
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
                const key = `${table.schema}.${table.name}`;
                const isExpanded = expanded.has(key);
                const cols = columnCache[key] ?? table.columns ?? [];
                const isMatView = table.table_type === "MATERIALIZED VIEW";
                const isView = table.table_type === "VIEW";
                const TypeIcon = isMatView ? Layers : isView ? Eye : Table2;
                const typeLabel = isMatView
                    ? "Materialized View"
                    : isView
                      ? "View"
                      : null;
                return (
                    <div key={key}>
                        <div
                            className="group flex items-center gap-1 px-3 py-1 hover:bg-surface-raised cursor-pointer"
                            onClick={() => openTab(table.schema, table.name)}
                        >
                            <button
                                aria-label={isExpanded ? "Collapse" : "Expand"}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(key, table.schema, table.name);
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
                                    connectionId={connectionId ?? undefined}
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
                                                ? `${col.data_type} → ${col.fk_ref[0]}.${col.fk_ref[1]}`
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
