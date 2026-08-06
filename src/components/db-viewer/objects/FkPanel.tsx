import { useEffect, useMemo, useState } from "react";
import { X, Link } from "lucide-react";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import { buildObjectDdl } from "../../../lib/objectCrud";
import type { SchemaGraph } from "../../../lib/types";
import { FormRow, controlClass } from "./formRow";

interface Props {
  connectionId: string;
  schema: string;
  table: string;
  column: string | null;
  onClose: () => void;
  onStaged?: () => void;
}

const FK_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

export function FkPanel({ connectionId, schema, table, column, onClose, onStaged }: Props) {
  const [graph, setGraph] = useState<SchemaGraph>({ tables: [], relationships: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);

  const [localColumn, setLocalColumn] = useState<string>(column ?? "");
  const [refSchema, setRefSchema] = useState<string>(schema);
  const [refTable, setRefTable] = useState<string>("");
  const [refColumn, setRefColumn] = useState<string>("");
  const [onDelete, setOnDelete] = useState<string>("NO ACTION");
  const [onUpdate, setOnUpdate] = useState<string>("NO ACTION");
  const [deferrable, setDeferrable] = useState(false);
  const [initiallyDeferred, setInitiallyDeferred] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    cmd
      .getSchemaGraph(connectionId, undefined)
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

  const currentTable = useMemo(
    () => graph.tables.find((t) => t.schema === schema && t.name === table),
    [graph, schema, table],
  );

  const currentColumns = useMemo(
    () => currentTable?.columns.map((c) => c.name) ?? [],
    [currentTable],
  );

  const schemas = useMemo(
    () => Array.from(new Set(graph.tables.map((t) => t.schema))).sort(),
    [graph],
  );

  const tablesInSchema = useMemo(
    () => graph.tables.filter((t) => t.schema === refSchema).sort((a, b) => a.name.localeCompare(b.name)),
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

  // Defaults: when graph loads or inputs change, keep selections valid.
  useEffect(() => {
    if (schemas.length > 0 && !schemas.includes(refSchema)) {
      setRefSchema(schemas[0] ?? "");
    }
  }, [schemas, refSchema]);

  useEffect(() => {
    if (tablesInSchema.length > 0 && !tablesInSchema.some((t) => t.name === refTable)) {
      setRefTable(tablesInSchema[0]?.name ?? "");
    } else if (tablesInSchema.length === 0) {
      setRefTable("");
    }
  }, [tablesInSchema, refTable]);

  useEffect(() => {
    if (currentColumns.length > 0 && !currentColumns.includes(localColumn)) {
      setLocalColumn(currentColumns[0] ?? "");
    }
  }, [currentColumns, localColumn]);

  useEffect(() => {
    const firstPk = refColumns.find((c) => c.is_pk)?.name ?? refColumns[0]?.name ?? "";
    setRefColumn(firstPk);
  }, [refColumns]);

  const addFk = async () => {
    if (!localColumn || !refTable || !refColumn) return;
    setStaging(true);
    setError(null);
    try {
      const sqls = await buildObjectDdl(connectionId, "constraint", {
        schema,
        table,
        name: "",
        action: {
          op: "foreign_key",
          columns: [localColumn],
          ref_schema: refSchema,
          ref_table: refTable,
          ref_columns: [refColumn],
          on_delete: onDelete,
          on_update: onUpdate,
          deferrable,
          initially_deferred: deferrable && initiallyDeferred,
        },
      });
      sqls.forEach((sql, i) =>
        useDbViewerStore.getState().addChange({
          type: "ddl",
          sql,
          description:
            sqls.length > 1
              ? `Add FK ${localColumn} → ${refSchema}.${refTable} (${refColumn}) (${i + 1}/${sqls.length})`
              : `Add FK ${localColumn} → ${refSchema}.${refTable} (${refColumn})`,
        }),
      );
      onStaged?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStaging(false);
    }
  };

  return (
    <div className="fixed top-0 right-0 h-full w-[420px] bg-canvas border-l border-border z-40 flex flex-col">
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

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {loading && (
          <p className="text-xs text-text-muted">Loading schema graph…</p>
        )}
        {!loading && graph.tables.length === 0 && (
          <p className="text-xs text-text-muted">No tables available for foreign key reference.</p>
        )}

        {!loading && graph.tables.length > 0 && (
          <>
            <FormRow label="Column">
              <select
                aria-label="Column"
                value={localColumn}
                onChange={(e) => setLocalColumn(e.target.value)}
                className={controlClass}
              >
                {currentColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Schema">
              <select
                aria-label="Schema"
                value={refSchema}
                onChange={(e) => setRefSchema(e.target.value)}
                className={controlClass}
              >
                {schemas.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Table">
              <select
                aria-label="Table"
                value={refTable}
                onChange={(e) => setRefTable(e.target.value)}
                className={controlClass}
              >
                {tablesInSchema.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Column (referenced)">
              <select
                aria-label="Column (referenced)"
                value={refColumn}
                onChange={(e) => setRefColumn(e.target.value)}
                className={controlClass}
              >
                {refColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} {c.is_pk ? "(PK)" : ""}
                  </option>
                ))}
              </select>
            </FormRow>

            {refSchema && refTable && refColumn && (
              <p className="text-xs text-text-muted px-3">
                references {refSchema}.{refTable} ({refColumn})
              </p>
            )}

            <FormRow label="On delete">
              <select
                aria-label="On delete"
                value={onDelete}
                onChange={(e) => setOnDelete(e.target.value)}
                className={controlClass}
              >
                {FK_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="On update">
              <select
                aria-label="On update"
                value={onUpdate}
                onChange={(e) => setOnUpdate(e.target.value)}
                className={controlClass}
              >
                {FK_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </FormRow>

            <FormRow label="Deferrable">
              <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="DEFERRABLE"
                  checked={deferrable}
                  onChange={(e) => {
                    setDeferrable(e.target.checked);
                    if (!e.target.checked) setInitiallyDeferred(false);
                  }}
                  className="rounded border-border bg-surface text-accent focus:ring-accent"
                />
                <span>DEFERRABLE</span>
              </label>
            </FormRow>

            <FormRow label="Initially deferred">
              <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="INITIALLY DEFERRED"
                  checked={initiallyDeferred}
                  disabled={!deferrable}
                  onChange={(e) => setInitiallyDeferred(e.target.checked)}
                  className="rounded border-border bg-surface text-accent focus:ring-accent disabled:opacity-50"
                />
                <span className={deferrable ? "" : "text-text-muted"}>INITIALLY DEFERRED</span>
              </label>
            </FormRow>
          </>
        )}

        {error && <p className="text-xs text-red-400 px-3">{error}</p>}
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
          disabled={staging || !localColumn || !refTable || !refColumn}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Add FK
        </button>
      </div>
    </div>
  );
}