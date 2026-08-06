import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVertical, Link, Plus, Settings2, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDbViewerStore, type ViewerTab } from "../../../stores/dbViewerStore";
import { useConnectionStore } from "../../../stores/connectionStore";
import * as cmd from "../../../lib/commands";
import type { ColumnInfo, ConstraintInfo, TablespaceInfo } from "../../../lib/types";
import { getCapabilities } from "../../../lib/dbCapabilities";
import { FkPanel, type FkDefinition } from "./FkPanel";
import { FormRow, FormSectionHeader, inputClass, controlClass } from "./formRow";
import { DataTypeIcon } from "../../ui/DataTypeIcon";

const PG_TYPES = [
  "int",
  "int8",
  "int2",
  "serial",
  "bigserial",
  "smallserial",
  "text",
  "varchar",
  "char",
  "bool",
  "numeric",
  "real",
  "float8",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "interval",
  "uuid",
  "json",
  "jsonb",
  "bytea",
  "inet",
  "cidr",
  "macaddr",
  "money",
];

interface TableFormColumn {
  rowId: string;
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  params?: string;
  auto_increment?: boolean;
  unique?: boolean;
  /** transient: true when a FK was just assigned to this column */
  fk?: boolean;
}

interface SqlColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  unique?: boolean;
}

interface TableFormAction {
  op: "create" | "edit";
  columns: TableFormColumn[];
  old_columns?: TableFormColumn[];
  tablespace?: string | null;
  rls?: "disable" | "enable" | "force" | null;
}

interface TableFormParams {
  schema: string;
  name: string;
  action: TableFormAction;
}

function toSqlColumn(c: TableFormColumn, mode: "create" | "edit"): SqlColumn {
  let type = c.type;
  const base = c.type.trim().toLowerCase();
  if (mode === "create" && c.auto_increment) {
    if (base === "integer" || base === "int" || base === "int4") type = "serial";
    else if (base === "bigint" || base === "int8") type = "bigserial";
    else if (base === "smallint" || base === "int2") type = "smallserial";
  }
  if (c.params && c.params.trim()) {
    type = `${type}(${c.params.trim()})`;
  }
  return {
    name: c.name,
    type,
    nullable: c.nullable,
    default: c.default,
    is_pk: c.is_pk,
    unique: c.unique ?? undefined,
  };
}

function sameColumns(a: TableFormColumn[], b: TableFormColumn[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (c, i) =>
      c.name === b[i]?.name &&
      c.type.trim().toLowerCase() === b[i]?.type.trim().toLowerCase(),
  );
}

function namesInOrder(cols: TableFormColumn[]): string {
  return cols.map((c) => c.name).join(",");
}

function sameColumnNames(a: TableFormColumn[], b: TableFormColumn[]): boolean {
  const sa = new Set(a.map((c) => c.name));
  const sb = new Set(b.map((c) => c.name));
  return sa.size === sb.size && [...sa].every((n) => sb.has(n));
}

let rowSeq = 0;
function emptyColumn(): TableFormColumn {
  rowSeq += 1;
  return {
    rowId: `col-${rowSeq}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    type: "text",
    nullable: true,
    default: null,
    is_pk: false,
    params: "",
    auto_increment: false,
    unique: false,
  };
}

// Y-axis-only drag (like the tab bar): zero out the X component of the transform.
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

// serial types only exist for the integer family (short + long forms).
function supportsAutoIncrement(type: string): boolean {
  const t = type.trim().toLowerCase();
  return (
    t === "integer" || t === "int" || t === "int4" ||
    t === "bigint" || t === "int8" ||
    t === "smallint" || t === "int2"
  );
}

// Cell-local input styles for the columns grid — no horizontal padding so the
// cell's px-3 supplies it (matches the data-grid cell look).
const cellInput =
  "min-w-0 flex-1 bg-transparent font-heading text-xs text-text outline-none placeholder:text-text-muted";
const cellMono =
  "min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none placeholder:text-text-muted";

function buildTablePayload(
  params: TableFormParams,
  op: "create" | "edit" | "rebuild",
  foreignKeys: FkDefinition[] = [],
): Record<string, unknown> {
  const action = params.action;
  const sqlColumns = action.columns.map((c) => toSqlColumn(c, action.op));
  return {
    ...params,
    action: {
      ...action,
      op,
      columns: sqlColumns,
      // CREATE TABLE embeds FKs inline (single staged change); edit uses separate ALTERs.
      ...(op === "create" ? { foreign_keys: foreignKeys } : {}),
    },
  } as unknown as Record<string, unknown>;
}

export function TableForm({ connectionId, tab }: { connectionId: string; tab: ViewerTab }) {
  const liveTab = useDbViewerStore(
    (s) => s.tabs.find((t) => t.id === tab.id && t.tabType === "objectForm") ?? tab,
  );
  const form = liveTab.form;
  if (!form) return null;

  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.db_type,
  );
  const capabilities = getCapabilities(dbType ?? "postgresql");
  const schemas = useDbViewerStore((s) => s.schemas);

  if (!capabilities.tableManagement) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-text-muted">
          Table management is not supported for this database type.
        </p>
      </div>
    );
  }

  const params = (form.params as unknown) as TableFormParams;
  const action = params.action;
  const mode = form.mode;

  const isRebuild =
    mode === "edit" &&
    action.old_columns !== undefined &&
    sameColumnNames(action.columns, action.old_columns) &&
    namesInOrder(action.columns) !== namesInOrder(action.old_columns);

  const [view, setView] = useState<"visual" | "sql">("visual");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);

  const [fkPanel, setFkPanel] = useState<{ open: boolean; column: string | null } | null>(null);
  const [fkColumns, setFkColumns] = useState<Set<string>>(new Set());
  const [createFks, setCreateFks] = useState<FkDefinition[]>([]);

  const op = isRebuild ? "rebuild" : action.op;

  const setParams = (next: TableFormParams) => {
    useDbViewerStore.getState().updateFormTabParams(tab.id, next as unknown as Record<string, unknown>);
  };

  // Rebuild readiness check
  useEffect(() => {
    if (!isRebuild) {
      setRefusal(null);
      return;
    }
    let active = true;
    cmd
      .getTableRebuildReadiness(connectionId, params.schema, params.name)
      .then((r) => {
        if (active) setRefusal(r.ok ? null : r.reasons.join("; "));
      })
      .catch(() => {
        if (active) setRefusal(null);
      });
    return () => {
      active = false;
    };
  }, [isRebuild, connectionId, params.schema, params.name]);

  // Edit mode: mark columns that participate in FKs (from the constraint list).
  useEffect(() => {
    if (mode !== "edit") {
      setFkColumns(new Set());
      return;
    }
    let active = true;
    cmd
      .getConstraints(connectionId, params.schema)
      .then((cs) => {
        if (!active) return;
        const names = new Set<string>();
        for (const c of cs.filter((x) => x.table === params.name)) {
          const m = /FOREIGN KEY\s*\(([^)]+)\)/i.exec(c.definition ?? "");
          if (m) m[1].split(",").forEach((n) => names.add(n.trim()));
        }
        setFkColumns(names);
      })
      .catch(() => {
        if (active) setFkColumns(new Set());
      });
    return () => {
      active = false;
    };
  }, [mode, connectionId, params.schema, params.name]);

  // SQL preview
  useEffect(() => {
    let active = true;
    setError(null);
    const promise = isRebuild
      ? cmd.buildRebuildScript(connectionId, params.schema, params.name, action.columns)
      : cmd.buildObjectDdl(connectionId, "table", buildTablePayload(params, op, createFks));
    promise
      .then((sqls: string[] | string) => {
        if (active) setPreview(Array.isArray(sqls) ? sqls.join("\n;\n") : (sqls as string));
      })
      .catch((e: unknown) => {
        if (active) {
          setPreview("");
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [params, action, op, isRebuild, connectionId, params.schema, params.name, createFks]);

  const patchColumns = (cols: TableFormColumn[]) =>
    setParams({ ...params, action: { ...action, columns: cols } });

  const addColumn = () => {
    const next = [...action.columns, emptyColumn()];
    // The first column auto-starts as the PK.
    if (next.length === 1) next[0].is_pk = true;
    patchColumns(next);
  };

  const removeColumn = (i: number) => patchColumns(action.columns.filter((_, j) => j !== i));

  const setCell = (i: number, key: keyof TableFormColumn, value: unknown) => {
    const next = [...action.columns];
    next[i] = { ...next[i], [key]: value } as TableFormColumn;
    patchColumns(next);
  };

  const applyFkTypes = (pairs: { localCol: string; refType: string }[]) => {
    const next = action.columns.map((c) => {
      const p = pairs.find((x) => x.localCol === c.name);
      return p ? { ...c, type: p.refType || c.type, fk: true } : c;
    });
    patchColumns(next);
  };

  const handleFkStaged = (result: { pairs: { localCol: string; refType: string }[]; fk?: FkDefinition }) => {
    applyFkTypes(result.pairs);
    if (mode === "create" && result.fk) {
      setCreateFks((prev) => [...prev, result.fk as FkDefinition]);
    }
  };

  const stage = async () => {
    setStaging(true);
    setError(null);
    try {
      if (isRebuild) {
        if (refusal) return;
        const sql = await cmd.buildRebuildScript(
          connectionId,
          params.schema,
          params.name,
          action.columns,
        );
        useDbViewerStore.getState().addChange({
          type: "rebuild_table",
          sql,
          description: `Rebuild table ${params.schema}.${params.name}`,
        });
        useDbViewerStore.getState().closeTab(tab.id);
        return;
      }

      if (mode === "edit" && action.old_columns !== undefined) {
        const live = await cmd.getTableColumns(connectionId, params.schema, params.name);
        const liveCols: TableFormColumn[] = live.map((c: ColumnInfo, i) => ({
          rowId: `live-${i}`,
          name: c.name,
          type: c.data_type,
          nullable: c.is_nullable,
          default: c.default_value,
          is_pk: c.is_pk,
        }));
        if (!sameColumns(liveCols, action.old_columns)) {
          setError("Table changed since you opened it — re-open to see current state");
          return;
        }
      }

      const sqls = await cmd.buildObjectDdl(connectionId, "table", buildTablePayload(params, op, createFks));
      sqls.forEach((sql, i) =>
        useDbViewerStore.getState().addChange({
          type: "ddl",
          sql,
          description:
            sqls.length > 1
              ? `${form.description} (${i + 1}/${sqls.length})`
              : form.description,
        }),
      );
      useDbViewerStore.getState().closeTab(tab.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStaging(false);
    }
  };

  const cols = useMemo(
    () => (action.columns ?? []).map((c, i) => ({ ...c, rowId: c.rowId ?? `col-${i}` })),
    [action.columns],
  );

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = cols.findIndex((c) => c.rowId === active.id);
    const to = cols.findIndex((c) => c.rowId === over.id);
    if (from === -1 || to === -1) return;
    patchColumns(arrayMove(cols, from, to));
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {mode} table{isRebuild ? " (rebuild)" : ""}
        </span>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              aria-label="Visual"
              onClick={() => setView("visual")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "visual"
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              Visual
            </button>
            <button
              type="button"
              aria-label="SQL"
              onClick={() => setView("sql")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "sql"
                  ? "bg-surface-raised text-text"
                  : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              SQL
            </button>
          </div>

          <button
            type="button"
            onClick={stage}
            disabled={!!error || !!refusal || staging || cols.length === 0}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Stage
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: "none" }}>
        {refusal && (
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs text-amber-400">
              Cannot reorder: {refusal}. Use the Query tab with pg_dump for these tables.
            </p>
          </div>
        )}

        {view === "visual" ? (
          <>
            {mode === "create" && (
              <FormRow label="Schema">
                {schemas && schemas.length > 0 ? (
                  <select
                    aria-label="Schema"
                    value={params.schema}
                    onChange={(e) => setParams({ ...params, schema: e.target.value })}
                    className={controlClass}
                  >
                    {params.schema !== "" && !schemas.includes(params.schema) && (
                      <option value={params.schema}>{params.schema}</option>
                    )}
                    {schemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={inputClass}
                    value={params.schema}
                    onChange={(e) => setParams({ ...params, schema: e.target.value })}
                  />
                )}
              </FormRow>
            )}

            {mode === "create" && (
              <FormRow label="Name">
                <input
                  className={inputClass}
                  placeholder="Table name"
                  value={params.name}
                  onChange={(e) => setParams({ ...params, name: e.target.value })}
                />
              </FormRow>
            )}

            <FormSectionHeader label="Columns" count={cols.length} />
            <div className="overflow-x-auto" style={{ overscrollBehavior: "none" }}>
              <div className="border-b border-border flex items-stretch w-full min-w-[760px]">
                <div className="w-8 shrink-0 border-r border-border px-3 py-1.5 flex items-center justify-center" />
                <div className="w-8 shrink-0 border-r border-border px-3 py-1.5 flex items-center text-[11px] font-semibold text-text-muted uppercase tracking-wider">#</div>
                <div className="flex-1 min-w-48 border-r border-border px-3 py-1.5 flex items-center text-[11px] font-semibold text-text-muted uppercase tracking-wider">Name</div>
                <div className="flex-1 min-w-40 border-r border-border px-3 py-1.5 flex items-center text-[11px] font-semibold text-text-muted uppercase tracking-wider">Type</div>
                <div className="w-24 shrink-0 border-r border-border px-3 py-1.5 flex items-center text-[11px] font-semibold text-text-muted uppercase tracking-wider">Parameters</div>
                <div className="flex-1 min-w-44 border-r border-border px-3 py-1.5 flex items-center text-[11px] font-semibold text-text-muted uppercase tracking-wider">Default Value</div>
                <div className="w-max shrink-0 border-r border-border px-3 py-1.5 flex items-center justify-end gap-1 invisible">
                  <Link size={12} />
                  <X size={12} />
                </div>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis]}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={cols.map((c) => c.rowId)} strategy={verticalListSortingStrategy}>
                  {cols.map((c, i) => (
                    <ColumnRow
                      key={c.rowId}
                      c={c}
                      index={i}
                      mode={mode}
                      setCell={setCell}
                      hasFk={!!c.fk || fkColumns.has(c.name)}
                      onRemove={() => removeColumn(i)}
                      onFk={() => setFkPanel({ open: true, column: c.name })}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <div className="border-b border-border px-4 h-max">
                <button
                  type="button"
                  aria-label="Add column"
                  onClick={addColumn}
                  className="text-xs text-accent hover:text-accent-hover cursor-pointer py-2 flex items-center gap-1"
                >
                  <Plus size={12} /> Add column
                </button>
              </div>
            </div>

            <OptionsSection
              connectionId={connectionId}
              schema={params.schema}
              table={params.name}
              mode={mode}
              tablespace={action.tablespace ?? null}
              rls={action.rls ?? null}
              onTablespace={(tablespace) =>
                setParams({ ...params, action: { ...action, tablespace } })
              }
              onRls={(rls) => setParams({ ...params, action: { ...action, rls } })}
            />

            <RelationshipsSection
              connectionId={connectionId}
              schema={params.schema}
              table={params.name}
              createFks={mode === "create" ? createFks : []}
              onAddFk={() => setFkPanel({ open: true, column: null })}
            />

            <AnimatePresence>
              {fkPanel?.open && (
                <FkPanel
                  connectionId={connectionId}
                  schema={params.schema}
                  table={params.name}
                  column={fkPanel.column}
                  mode={mode ?? "edit"}
                  localColumns={(action.columns ?? []).map((c) => ({ name: c.name, data_type: c.type }))}
                  onStaged={handleFkStaged}
                  onClose={() => setFkPanel(null)}
                />
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="px-4 py-3">
            <pre className="text-xs leading-6 font-mono whitespace-pre-wrap text-text">
              {preview}
            </pre>
          </div>
        )}
      </div>

      {error && (
        <div className="border-t border-border px-4 py-2">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}

interface ColumnRowProps {
  c: TableFormColumn;
  index: number;
  mode: "create" | "edit";
  setCell: (i: number, key: keyof TableFormColumn, value: unknown) => void;
  onRemove: () => void;
  onFk: () => void;
  hasFk: boolean;
}

function ColumnRow({ c, index, mode, setCell, onRemove, onFk, hasFk }: ColumnRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: c.rowId });

  const [menuOpen, setMenuOpen] = useState(false);
  const cogRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const toggleMenu = () => {
    if (!menuOpen && cogRef.current) {
      const r = cogRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    setMenuOpen((v) => !v);
  };

  const constraintsMenu =
    menuOpen && menuPos
      ? createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div
              role="menu"
              className="fixed z-50 bg-surface-raised border border-border rounded-lg shadow-lg p-2 min-w-44 flex flex-col gap-1"
              style={{ top: menuPos.top, right: menuPos.right }}
            >
              <label className="flex items-center gap-2 px-2 py-1 text-xs text-text whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="PK"
                  checked={c.is_pk}
                  disabled={mode === "edit"}
                  onChange={(e) => setCell(index, "is_pk", e.target.checked)}
                  className="rounded border-border bg-surface text-accent focus:ring-accent"
                />
                Primary key
              </label>
              {mode === "create" && supportsAutoIncrement(c.type) && (
                <label className="flex items-center gap-2 px-2 py-1 text-xs text-text whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label="Auto-Increment"
                    checked={c.auto_increment ?? false}
                    onChange={(e) => setCell(index, "auto_increment", e.target.checked)}
                    className="rounded border-border bg-surface text-accent focus:ring-accent"
                  />
                  Auto-Increment
                </label>
              )}
              {mode === "create" && (
                <label className="flex items-center gap-2 px-2 py-1 text-xs text-text whitespace-nowrap cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label="Unique"
                    checked={c.unique ?? false}
                    onChange={(e) => setCell(index, "unique", e.target.checked)}
                    className="rounded border-border bg-surface text-accent focus:ring-accent"
                  />
                  Unique
                </label>
              )}
              <label className="flex items-center gap-2 px-2 py-1 text-xs text-text whitespace-nowrap cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Nullable"
                  checked={c.nullable}
                  onChange={(e) => setCell(index, "nullable", e.target.checked)}
                  className="rounded border-border bg-surface text-accent focus:ring-accent"
                />
                Nullable
              </label>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-border flex items-stretch w-full min-w-[760px] ${isDragging ? "opacity-60" : ""}`}
    >
      <div className="w-8 shrink-0 border-r border-border px-2 py-2 flex items-center justify-center">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          type="button"
          aria-label="Drag to reorder"
          className="cursor-grab active:cursor-grabbing touch-none text-text-muted hover:text-text transition-colors"
        >
          <GripVertical size={14} />
        </button>
      </div>
      <div className="w-8 shrink-0 border-r border-border px-3 py-2 flex items-center text-xs font-mono text-text-muted">
        {index + 1}
      </div>
      <div className="flex-1 min-w-48 border-r border-border px-3 py-2 flex items-center gap-2">
        <input
          className={cellInput}
          placeholder="name"
          value={c.name}
          onChange={(e) => setCell(index, "name", e.target.value)}
        />
        {!c.is_pk && (
          <button
            type="button"
            aria-label="Set foreign key"
            onClick={onFk}
            title={hasFk ? "This column has a foreign key" : "Set foreign key"}
            className={`shrink-0 transition-colors ${hasFk ? "text-accent" : "text-text-muted hover:text-accent"}`}
          >
            <Link size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 min-w-40 border-r border-border px-3 py-2 flex items-center gap-1.5">
        <DataTypeIcon dataType={c.type} size={12} />
        <select
          aria-label="type"
          value={c.type}
          onChange={(e) => setCell(index, "type", e.target.value)}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none cursor-pointer"
        >
          {c.type !== "" && !PG_TYPES.includes(c.type) && <option value={c.type}>{c.type}</option>}
          {PG_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="w-24 shrink-0 border-r border-border px-3 py-2 flex items-center">
        <input
          className={cellMono}
          placeholder="length"
          value={c.params ?? ""}
          onChange={(e) => setCell(index, "params", e.target.value)}
        />
      </div>
      <div className="flex-1 min-w-44 border-r border-border px-3 py-2 flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Has default"
          checked={c.default !== null}
          onChange={(e) => setCell(index, "default", e.target.checked ? (c.default ?? "") : null)}
          className="rounded border-border bg-surface text-accent focus:ring-accent"
        />
        <input
          className={cellMono}
          placeholder="default"
          disabled={c.default === null}
          value={c.default ?? ""}
          onChange={(e) => setCell(index, "default", e.target.value)}
        />
      </div>
      <div className="w-max shrink-0 border-r border-border px-3 py-2 flex items-center justify-end gap-1">
        <button
          ref={cogRef}
          type="button"
          aria-label="Column settings"
          onClick={toggleMenu}
          className="text-text-muted hover:text-text transition-colors"
        >
          <Settings2 size={12} />
        </button>
        <button
          type="button"
          aria-label="Remove column"
          onClick={onRemove}
          className="text-text-muted hover:text-red-400"
        >
          <X size={12} />
        </button>
      </div>
      {constraintsMenu}
    </div>
  );
}

interface OptionsSectionProps {
  connectionId: string;
  schema: string;
  table: string;
  mode: "create" | "edit";
  tablespace: string | null;
  rls: "disable" | "enable" | "force" | null;
  onTablespace: (value: string | null) => void;
  onRls: (value: "disable" | "enable" | "force" | null) => void;
}

function OptionsSection({
  connectionId,
  mode,
  tablespace,
  rls,
  onTablespace,
  onRls,
}: OptionsSectionProps) {
  const [tablespaces, setTablespaces] = useState<TablespaceInfo[]>([]);

  useEffect(() => {
    let active = true;
    cmd
      .getTablespaces(connectionId)
      .then((ts) => {
        if (active) setTablespaces(Array.isArray(ts) ? ts : []);
      })
      .catch(() => {
        if (active) setTablespaces([]);
      });
    return () => {
      active = false;
    };
  }, [connectionId]);

  return (
    <>
      <FormRow label="Tablespace">
        <select
          aria-label="Tablespace"
          value={tablespace ?? ""}
          onChange={(e) => onTablespace(e.target.value || null)}
          className={controlClass}
        >
          <option value="">(default)</option>
          {tablespaces.map((ts) => (
            <option key={ts.name} value={ts.name}>
              {ts.name}
            </option>
          ))}
        </select>
      </FormRow>

      {mode === "edit" && (
        <FormRow label="Row level security">
          <div className="flex items-center gap-4 px-3">
            {[
              { value: "disable", label: "Disabled" },
              { value: "enable", label: "Enabled" },
              { value: "force", label: "Forced" },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-1 text-xs text-text">
                <input
                  type="radio"
                  name="rls"
                  value={value}
                  checked={rls === value}
                  onChange={() => onRls(value as "disable" | "enable" | "force")}
                />
                {label}
              </label>
            ))}
          </div>
        </FormRow>
      )}
    </>
  );
}

interface RelationshipsSectionProps {
  connectionId: string;
  schema: string;
  table: string;
  /** FKs to inline into a CREATE TABLE (create mode only). */
  createFks?: FkDefinition[];
  onAddFk: () => void;
}

function RelationshipsSection({ connectionId, schema, table, createFks = [], onAddFk }: RelationshipsSectionProps) {
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const queued = useDbViewerStore((s) => s.changesQueue);

  useEffect(() => {
    let active = true;
    cmd
      .getConstraints(connectionId, schema)
      .then((cs) => {
        if (active) setConstraints(Array.isArray(cs) ? cs.filter((c) => c.table === table) : []);
      })
      .catch(() => {
        if (active) setConstraints([]);
      });
    return () => {
      active = false;
    };
  }, [connectionId, schema, table]);

  const fks = useMemo(
    () => constraints.filter((c) => (c.definition ?? "").toUpperCase().includes("FOREIGN")),
    [constraints],
  );

  // FKs staged in this session live in the changes queue (create mode has no DB row yet).
  const queuedFks = useMemo(
    () =>
      queued.filter(
        (q) =>
          q.type === "ddl" &&
          q.sql.toUpperCase().includes("FOREIGN KEY") &&
          q.sql.includes(`"${schema}"."${table}"`),
      ),
    [queued, schema, table],
  );

  const allFks = [...queuedFks, ...fks];

  return (
    <div>
      <div className="border-b border-border px-4 py-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          Foreign keys
        </span>
        <button
          type="button"
          aria-label="Add FK"
          onClick={onAddFk}
          className="text-xs text-accent hover:text-accent-hover"
        >
          Add FK
        </button>
      </div>

      {createFks.map((fk, i) => (
        <div key={`cfk-${i}`} className="border-b border-border px-4 py-2">
          <p className="text-xs text-text">
            FOREIGN KEY ({fk.columns.join(", ")}) → {fk.ref_schema}.{fk.ref_table} (
            {fk.ref_columns.join(", ")})
            {fk.on_delete ? ` ON DELETE ${fk.on_delete}` : ""}
            {fk.on_update ? ` ON UPDATE ${fk.on_update}` : ""}
          </p>
        </div>
      ))}

      {allFks.length === 0 && createFks.length === 0 && (
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs text-text-muted">No foreign keys listed.</p>
        </div>
      )}

      {allFks.map((fk, i) => (
        <div key={i} className="border-b border-border px-4 py-2">
          {"sql" in fk ? (
            <>
              <p className="text-xs text-text">{fk.description}</p>
              <p className="font-mono text-[11px] text-text-muted break-all mt-0.5">{fk.sql}</p>
            </>
          ) : (
            <p className="text-xs text-text">
              <span className="font-mono">{fk.name}</span>{" "}
              <span className="text-text-muted">{fk.definition}</span>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}