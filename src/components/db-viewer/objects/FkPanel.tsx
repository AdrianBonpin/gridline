import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { X, Link, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import { buildObjectDdl } from "../../../lib/objectCrud";
import type { SchemaGraph } from "../../../lib/types";

// Panel selects: transparent, fill the available width (no surface bg like the grid).
const panelSelect =
    "w-full bg-transparent font-heading text-xs text-text outline-none placeholder:text-text-muted cursor-pointer";

export interface FkColumn {
    name: string;
    data_type: string;
}

export interface FkStagedPair {
    localCol: string;
    refType: string;
}

interface FkPair {
    localCol: string;
    refCol: string;
}

interface Props {
    connectionId: string;
    schema: string;
    table: string;
    column: string | null;
    /** Columns of the table being edited (from the form grid — works even when the table isn't created yet). */
    localColumns: FkColumn[];
    onClose: () => void;
    /** Called after staging: one entry per column pair (local column, referenced column's data type). */
    onStaged?: (pairs: FkStagedPair[]) => void;
}

const FK_ACTIONS = [
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];

function Section({
    label,
    children,
    flush = false,
}: {
    label: string;
    children: ReactNode;
    flush?: boolean;
}) {
    return (
        <div className="border-b border-border">
            <div className="border-b border-border px-4 py-2 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                {label}
            </div>
            <div className={flush ? "" : "px-2 py-2"}>{children}</div>
        </div>
    );
}

export function FkPanel({
    connectionId,
    schema,
    table,
    column,
    localColumns,
    onClose,
    onStaged,
}: Props) {
    const [graph, setGraph] = useState<SchemaGraph>({
        tables: [],
        relationships: [],
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [staging, setStaging] = useState(false);

    const [pairs, setPairs] = useState<FkPair[]>(() =>
        column
            ? [{ localCol: column, refCol: "" }]
            : [{ localCol: "", refCol: "" }],
    );
    const [refSchema, setRefSchema] = useState<string>(schema);
    const [refTable, setRefTable] = useState<string>("");
    const [onDelete, setOnDelete] = useState<string>("NO ACTION");
    const [onUpdate, setOnUpdate] = useState<string>("NO ACTION");

    useEffect(() => {
        let active = true;
        setLoading(true);
        cmd.getSchemaGraph(connectionId, undefined)
            .then((g) => {
                if (!active) return;
                setGraph(g);
                setLoading(false);
            })
            .catch((e) => {
                if (!active) return;
                setError(e instanceof Error ? e.message : String(e));
                setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [connectionId]);

    const localNames = useMemo(
        () => localColumns.map((c) => c.name),
        [localColumns],
    );

    const schemas = useMemo(
        () => Array.from(new Set(graph.tables.map((t) => t.schema))).sort(),
        [graph],
    );

    const tablesInSchema = useMemo(
        () =>
            graph.tables
                .filter((t) => t.schema === refSchema)
                .sort((a, b) => a.name.localeCompare(b.name)),
        [graph, refSchema],
    );

    const refTableInfo = useMemo(
        () => tablesInSchema.find((t) => t.name === refTable),
        [tablesInSchema, refTable],
    );

    const refColumns = useMemo(() => {
        if (!refTableInfo) return [];
        return [...refTableInfo.columns].sort((a, b) => {
            if (a.is_pk && !b.is_pk) return -1;
            if (!a.is_pk && b.is_pk) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [refTableInfo]);

    // Defaults: keep selections valid as the graph loads / inputs change.
    useEffect(() => {
        if (schemas.length > 0 && !schemas.includes(refSchema)) {
            setRefSchema(schemas[0] ?? "");
        }
    }, [schemas, refSchema]);

    useEffect(() => {
        if (
            tablesInSchema.length > 0 &&
            !tablesInSchema.some((t) => t.name === refTable)
        ) {
            setRefTable(tablesInSchema[0]?.name ?? "");
        } else if (tablesInSchema.length === 0) {
            setRefTable("");
        }
    }, [tablesInSchema, refTable]);

    useEffect(() => {
        if (localNames.length === 0) return;
        setPairs((prev) =>
            prev.map((p) =>
                localNames.includes(p.localCol)
                    ? p
                    : { ...p, localCol: localNames[0] ?? "" },
            ),
        );
    }, [localNames]);

    useEffect(() => {
        setPairs((prev) =>
            prev.map((p) =>
                p.refCol && refColumns.some((c) => c.name === p.refCol)
                    ? p
                    : { ...p, refCol: refColumns[0]?.name ?? "" },
            ),
        );
    }, [refColumns]);

    const setPair = (i: number, key: keyof FkPair, value: string) =>
        setPairs((prev) =>
            prev.map((p, j) => (j === i ? { ...p, [key]: value } : p)),
        );

    const addPair = () =>
        setPairs((prev) => [
            ...prev,
            {
                localCol: localNames[0] ?? "",
                refCol: refColumns[0]?.name ?? "",
            },
        ]);

    const removePair = (i: number) =>
        setPairs((prev) =>
            prev.length > 1 ? prev.filter((_, j) => j !== i) : prev,
        );

    const typeMappings = pairs
        .map((p) => ({
            localType:
                localColumns.find((c) => c.name === p.localCol)?.data_type ??
                "",
            refType:
                refTableInfo?.columns.find((c) => c.name === p.refCol)
                    ?.data_type ?? "",
        }))
        .filter((m) => m.localType !== "" || m.refType !== "");

    const tableLabel = table.trim() === "" ? "unnamed table" : table;

    const addFk = async () => {
        const cols = pairs.map((p) => p.localCol);
        const refCols = pairs.map((p) => p.refCol);
        if (
            cols.length === 0 ||
            cols.some((c) => c === "") ||
            refCols.some((c) => c === "")
        )
            return;
        setStaging(true);
        setError(null);
        try {
            const sqls = await buildObjectDdl(connectionId, "constraint", {
                schema,
                table,
                name: "",
                action: {
                    op: "foreign_key",
                    columns: cols,
                    ref_schema: refSchema,
                    ref_table: refTable,
                    ref_columns: refCols,
                    on_delete: onDelete,
                    on_update: onUpdate,
                },
            });
            const refTypes: Record<string, string> = {};
            for (const c of refTableInfo?.columns ?? [])
                refTypes[c.name] = c.data_type;
            sqls.forEach((sql, i) =>
                useDbViewerStore.getState().addChange({
                    type: "ddl",
                    sql,
                    description:
                        sqls.length > 1
                            ? `Add FK ${cols.join(", ")} → ${refSchema}.${refTable} (${i + 1}/${sqls.length})`
                            : `Add FK ${cols.join(", ")} → ${refSchema}.${refTable}`,
                }),
            );
            onStaged?.(
                pairs.map((p) => ({
                    localCol: p.localCol,
                    refType: refTypes[p.refCol] ?? "",
                })),
            );
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setStaging(false);
        }
    };

    return (
        <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            style={{ willChange: "transform" }}
            className="fixed top-0 right-0 h-full w-[420px] bg-canvas border-l border-border z-40 flex flex-col"
        >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2 text-text">
                    <Link size={14} />
                    <span className="text-sm font-semibold">Foreign key</span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="text-text-muted hover:text-text"
                >
                    <X size={16} />
                </button>
            </div>

            <div
                className="flex-1 overflow-auto"
                style={{ overscrollBehavior: "none" }}
            >
                {table.trim() === "" && (
                    <p className="border-b border-border px-4 py-2 text-xs text-amber-400">
                        Enter a table name in the form first — a foreign key
                        needs a named table.
                    </p>
                )}
                {loading && (
                    <p className="border-b border-border px-4 py-2 text-xs text-text-muted">
                        Loading schema graph…
                    </p>
                )}
                {!loading && graph.tables.length === 0 && (
                    <p className="border-b border-border px-4 py-2 text-xs text-text-muted">
                        No tables available for foreign key reference.
                    </p>
                )}

                {!loading && graph.tables.length > 0 && (
                    <>
                        <Section label="Select a Schema">
                            <select
                                aria-label="Schema"
                                value={refSchema}
                                onChange={(e) => setRefSchema(e.target.value)}
                                className={panelSelect}
                            >
                                {schemas.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </Section>

                        <Section label="Select a Table to reference to">
                            <select
                                aria-label="Table"
                                value={refTable}
                                onChange={(e) => setRefTable(e.target.value)}
                                className={panelSelect}
                            >
                                {tablesInSchema.map((t) => (
                                    <option key={t.name} value={t.name}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>
                        </Section>

                        {refSchema && refTable && (
                            <>
                                <Section
                                    flush
                                    label={`Select columns from ${schema}.${tableLabel} to reference to`}
                                >
                                    <div className="grid grid-cols-2 text-xs text-text-muted border-b border-border">
                                        <div className="border-r border-border px-4 py-1">
                                            <span className="truncate">
                                                {schema}.{tableLabel}
                                            </span>
                                        </div>
                                        <div className=" px-4 py-1">
                                            <span className="truncate">
                                                {refSchema}.{refTable || "—"}
                                            </span>
                                        </div>
                                    </div>
                                    {pairs.map((pair, i) => (
                                        <div
                                            key={i}
                                            className="grid grid-cols-2 items-center border-b border-border"
                                        >
                                            <div className="border-r border-border px-2 py-1">
                                                <select
                                                    aria-label={`Local column ${i + 1}`}
                                                    value={pair.localCol}
                                                    onChange={(e) =>
                                                        setPair(
                                                            i,
                                                            "localCol",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className={panelSelect}
                                                >
                                                    {localColumns.map((c) => (
                                                        <option
                                                            key={c.name}
                                                            value={c.name}
                                                        >
                                                            {c.name} (
                                                            {c.data_type})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1 px-2 py-1">
                                                <select
                                                    aria-label={`Referenced column ${i + 1}`}
                                                    value={pair.refCol}
                                                    onChange={(e) =>
                                                        setPair(
                                                            i,
                                                            "refCol",
                                                            e.target.value,
                                                        )
                                                    }
                                                    className={panelSelect}
                                                >
                                                    {refColumns.map((c) => (
                                                        <option
                                                            key={c.name}
                                                            value={c.name}
                                                        >
                                                            {c.name} (
                                                            {c.data_type})
                                                            {c.is_pk
                                                                ? " (PK)"
                                                                : ""}
                                                        </option>
                                                    ))}
                                                </select>
                                                {pairs.length > 1 && (
                                                    <button
                                                        type="button"
                                                        aria-label={`Remove pair ${i + 1}`}
                                                        onClick={() =>
                                                            removePair(i)
                                                        }
                                                        className="shrink-0 text-text-muted hover:text-red-400"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        type="button"
                                        aria-label="Add another column"
                                        onClick={addPair}
                                        className="text-xs text-accent hover:text-accent-hover px-4 py-2 cursor-pointer"
                                    >
                                        <Plus size={12} className="inline" />{" "}
                                        Add another column
                                    </button>
                                </Section>

                                {typeMappings.length > 0 && (
                                    <Section label="Types will be updated">
                                        <ul className="space-y-0.5">
                                            {typeMappings.map((m, i) => (
                                                <li
                                                    key={i}
                                                    className="px-2 font-mono text-xs text-text"
                                                >
                                                    <span className="text-text-muted mr-2">
                                                        {m.localType || "?"}
                                                    </span>
                                                    <span className="text-accent">
                                                        →
                                                    </span>{" "}
                                                    <span className="">
                                                        {m.refType || "?"}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </Section>
                                )}

                                <Section label="Action if referenced row is updated">
                                    <select
                                        aria-label="On update"
                                        value={onUpdate}
                                        onChange={(e) =>
                                            setOnUpdate(e.target.value)
                                        }
                                        className={panelSelect}
                                    >
                                        {FK_ACTIONS.map((a) => (
                                            <option key={a} value={a}>
                                                {a}
                                            </option>
                                        ))}
                                    </select>
                                </Section>

                                <Section label="Action if referenced row is removed">
                                    <select
                                        aria-label="On delete"
                                        value={onDelete}
                                        onChange={(e) =>
                                            setOnDelete(e.target.value)
                                        }
                                        className={panelSelect}
                                    >
                                        {FK_ACTIONS.map((a) => (
                                            <option key={a} value={a}>
                                                {a}
                                            </option>
                                        ))}
                                    </select>
                                </Section>
                            </>
                        )}
                    </>
                )}

                {error && (
                    <p className="border-b border-border px-4 py-2 text-xs text-red-400">
                        {error}
                    </p>
                )}
            </div>

            <div className="border-t border-border px-4 py-3 flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs font-medium text-text hover:text-text"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={addFk}
                    disabled={
                        staging ||
                        table.trim() === "" ||
                        pairs.length === 0 ||
                        pairs.some((p) => p.localCol === "" || p.refCol === "")
                    }
                    className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                    Add FK
                </button>
            </div>
        </motion.div>
    );
}
