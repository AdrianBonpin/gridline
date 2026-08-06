import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, Plus, X, Link } from "lucide-react";
import { useDbViewerStore, type ViewerTab } from "../../../stores/dbViewerStore";
import { useConnectionStore } from "../../../stores/connectionStore";
import * as cmd from "../../../lib/commands";
import type { ColumnInfo, ConstraintInfo, TablespaceInfo } from "../../../lib/types";
import { getCapabilities } from "../../../lib/dbCapabilities";
import { FkPanel } from "./FkPanel";
import { FormRow, FormSectionHeader, inputClass, monoInputClass, controlClass } from "./formRow";
import { DataTypeIcon } from "../../ui/DataTypeIcon";

const PG_TYPES = [
  "integer",
  "bigint",
  "smallint",
  "serial",
  "bigserial",
  "text",
  "varchar",
  "char",
  "boolean",
  "numeric",
  "decimal",
  "real",
  "double precision",
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
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  is_pk: boolean;
  params?: string;
  auto_increment?: boolean;
  unique?: boolean;
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
    if (base === "integer") type = "serial";
    else if (base === "bigint") type = "bigserial";
    else if (base === "smallint") type = "smallserial";
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

function emptyColumn(): TableFormColumn {
  return { name: "", type: "text", nullable: true, default: null, is_pk: false, params: "", auto_increment: false, unique: false };
}

function buildTablePayload(params: TableFormParams, op: "create" | "edit" | "rebuild"): Record<string, unknown> {
  const action = params.action;
  const sqlColumns = action.columns.map((c) => toSqlColumn(c, action.op));
  return {
    ...params,
    action: { ...action, op, columns: sqlColumns },
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

  // SQL preview
  useEffect(() => {
    let active = true;
    setError(null);
    const promise = isRebuild
      ? cmd.buildRebuildScript(connectionId, params.schema, params.name, action.columns)
      : cmd.buildObjectDdl(connectionId, "table", buildTablePayload(params, op));
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
  }, [params, action, op, isRebuild, connectionId, params.schema, params.name]);

  const patchColumns = (cols: TableFormColumn[]) =>
    setParams({ ...params, action: { ...action, columns: cols } });

  const addColumn = () => patchColumns([...action.columns, emptyColumn()]);

  const removeColumn = (i: number) => patchColumns(action.columns.filter((_, j) => j !== i));

  const moveColumn = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= action.columns.length) return;
    const next = [...action.columns];
    [next[i], next[j]] = [next[j], next[i]];
    patchColumns(next);
  };

  const setCell = (i: number, key: keyof TableFormColumn, value: unknown) => {
    const next = [...action.columns];
    next[i] = { ...next[i], [key]: value } as TableFormColumn;
    patchColumns(next);
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
        const liveCols: TableFormColumn[] = live.map((c: ColumnInfo) => ({
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

      const sqls = await cmd.buildObjectDdl(connectionId, "table", buildTablePayload(params, op));
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

  const cols = action.columns ?? [];

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

      <div className="flex-1 overflow-auto">
        {refusal && (
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs text-amber-400">
              Cannot reorder: {refusal}. Use the Query tab with pg_dump for these tables.
            </p>
          </div>
        )}

        {view === "visual" ? (
          <>
            <FormSectionHeader label="Columns" count={cols.length} />
            <div className="border-b border-border px-4 py-1.5 flex items-center gap-2">
              <span className="w-6 text-[11px] font-semibold text-text-muted uppercase tracking-wider">#</span>
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Name</span>
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Type</span>
              <span className="w-24 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Parameters</span>
              <span className="min-w-0 flex-1 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Default Value</span>
              <span className="min-w-0 flex-[1.5] text-[11px] font-semibold text-text-muted uppercase tracking-wider">Constraints</span>
              <span className="w-16" />
            </div>
            {cols.map((c, i) => (
              <div key={i} className="border-b border-border px-4 py-2 flex items-center gap-2">
                <span className="w-6 text-xs font-mono text-text-muted">{i + 1}</span>
                <input
                  className={inputClass}
                  placeholder="name"
                  value={c.name}
                  onChange={(e) => setCell(i, "name", e.target.value)}
                />
                <div className="min-w-0 flex-1 flex items-center gap-1">
                  <DataTypeIcon dataType={c.type} size={12} />
                  <input
                    className={monoInputClass}
                    list="pg-types"
                    placeholder="type"
                    value={c.type}
                    onChange={(e) => setCell(i, "type", e.target.value)}
                  />
                </div>
                <input
                  className={[monoInputClass, "w-24"].join(" ")}
                  placeholder="length"
                  value={c.params ?? ""}
                  onChange={(e) => setCell(i, "params", e.target.value)}
                />
                <div className="min-w-0 flex-1 flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Has default"
                    checked={c.default !== null}
                    onChange={(e) => setCell(i, "default", e.target.checked ? (c.default ?? "") : null)}
                    className="rounded border-border bg-surface text-accent focus:ring-accent"
                  />
                  <input
                    className={monoInputClass}
                    placeholder="default"
                    disabled={c.default === null}
                    value={c.default ?? ""}
                    onChange={(e) => setCell(i, "default", e.target.value)}
                  />
                </div>
                <div className="min-w-0 flex-[1.5] flex items-center gap-3">
                  {mode === "create" && (
                    <>
                      <label className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label="Auto-Increment"
                          checked={c.auto_increment ?? false}
                          onChange={(e) => setCell(i, "auto_increment", e.target.checked)}
                        />
                        Auto-Increment
                      </label>
                      <label className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label="Unique"
                          checked={c.unique ?? false}
                          onChange={(e) => setCell(i, "unique", e.target.checked)}
                        />
                        Unique
                      </label>
                    </>
                  )}
                  <label className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                    <input
                      type="checkbox"
                      aria-label={mode === "edit" ? "PK (read-only)" : "PK"}
                      checked={c.is_pk}
                      disabled={mode === "edit"}
                      onChange={(e) => setCell(i, "is_pk", e.target.checked)}
                    />
                    PK
                  </label>
                  <label className="flex items-center gap-1 text-xs text-text-muted whitespace-nowrap">
                    <input
                      type="checkbox"
                      aria-label="Nullable"
                      checked={c.nullable}
                      onChange={(e) => setCell(i, "nullable", e.target.checked)}
                    />
                    Nullable
                  </label>
                </div>
                <div className="w-16 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    aria-label="Set foreign key"
                    onClick={() => setFkPanel({ open: true, column: c.name })}
                    className="text-text-muted hover:text-accent"
                  >
                    <Link size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => moveColumn(i, -1)}
                    className="text-text-muted hover:text-text"
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => moveColumn(i, 1)}
                    className="text-text-muted hover:text-text"
                  >
                    <ArrowDown size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove column"
                    onClick={() => removeColumn(i)}
                    className="text-text-muted hover:text-red-400"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
            <datalist id="pg-types">
              {PG_TYPES.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="border-b border-border px-4 py-2">
              <button
                type="button"
                aria-label="Add column"
                onClick={addColumn}
                className="text-xs text-accent hover:text-accent-hover"
              >
                <Plus size={12} className="inline" /> Add column
              </button>
            </div>

            {mode === "create" && (
              <FormRow label="Schema">
                <input
                  className={inputClass}
                  value={params.schema}
                  onChange={(e) => setParams({ ...params, schema: e.target.value })}
                />
              </FormRow>
            )}

            {mode === "create" && (
              <FormRow label="Name">
                <input
                  className={inputClass}
                  value={params.name}
                  onChange={(e) => setParams({ ...params, name: e.target.value })}
                />
              </FormRow>
            )}

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
              onAddFk={() => setFkPanel({ open: true, column: null })}
            />

            {fkPanel?.open && (
              <FkPanel
                connectionId={connectionId}
                schema={params.schema}
                table={params.name}
                column={fkPanel.column}
                onClose={() => setFkPanel(null)}
              />
            )}
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
  onAddFk: () => void;
}

function RelationshipsSection({ connectionId, schema, table, onAddFk }: RelationshipsSectionProps) {
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);

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

      {fks.length === 0 && (
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs text-text-muted">No foreign keys listed.</p>
        </div>
      )}
    </div>
  );
}