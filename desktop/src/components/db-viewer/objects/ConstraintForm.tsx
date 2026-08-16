import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import * as cmd from "../../../lib/commands";
import type { SchemaGraph } from "../../../lib/types";
import { ColumnPicker } from "./ColumnPicker";
import { FormRow, inputClass, controlClass, monoInputClass } from "./formRow";

interface Props {
  connectionId: string;
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

const KINDS = ["check", "unique", "primary_key", "foreign_key"];
const FK_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];

function patchAction(params: DdlParams, patch: Record<string, unknown>): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

function refKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function parseRefKey(key: string): { schema: string; table: string } {
  const parts = key.split(".");
  if (parts.length >= 2) return { schema: parts[0] ?? "", table: parts.slice(1).join(".") };
  return { schema: "", table: key };
}

export function ConstraintForm({ connectionId, params, schemas, onChange }: Props) {
  const p = params as Record<string, unknown>;
  const action = (p.action ?? {}) as Record<string, unknown>;
  const kind = (action.op as string) ?? "check";

  const [graph, setGraph] = useState<SchemaGraph>({ tables: [], relationships: [] });

  useEffect(() => {
    cmd
      .getSchemaGraph(connectionId, undefined)
      .then((g: SchemaGraph) => setGraph(g))
      .catch(() => setGraph({ tables: [], relationships: [] }));
  }, [connectionId]);

  const setAction = (patch: Record<string, unknown>) => onChange(patchAction(params, patch));

  const tableCols =
    graph.tables
      .find((t) => t.name === (p.table as string) && t.schema === (p.schema as string))
      ?.columns.map((c) => c.name) ?? [];

  const refCols =
    graph.tables
      .find(
        (t) =>
          t.name === (action.ref_table as string) &&
          t.schema === (action.ref_schema as string),
      )
      ?.columns.map((c) => c.name) ?? [];

  const selected: string[] = (action.columns as string[]) ?? [];
  const refSelected: string[] = (action.ref_columns as string[]) ?? [];

  const pick = (list: string[], c: string) =>
    list.includes(c) ? list.filter((x) => x !== c) : [...list, c];

  return (
    <div>
      <FormRow label="Schema">
        {schemas && schemas.length > 0 ? (
          <select
            value={(p.schema as string) ?? ""}
            onChange={(e) => onChange({ ...p, schema: e.target.value })}
            aria-label="Schema"
            className={controlClass}
          >
            <option value="" disabled>Schema</option>
            {schemas.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input
            type="text"
            placeholder="Schema"
            value={(p.schema as string) ?? ""}
            onChange={(e) => onChange({ ...p, schema: e.target.value })}
            className={inputClass}
          />
        )}
      </FormRow>
      <FormRow label="Table">
        <input
          type="text"
          placeholder="Table"
          value={(p.table as string) ?? ""}
          onChange={(e) => onChange({ ...p, table: e.target.value })}
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Name">
        <input
          type="text"
          placeholder="Constraint name"
          value={(p.name as string) ?? ""}
          onChange={(e) => onChange({ ...p, name: e.target.value })}
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Kind">
        <select
          aria-label="Kind"
          value={kind}
          onChange={(e) => onChange({ ...p, action: { op: e.target.value } })}
          className={controlClass}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </FormRow>

      {(kind === "unique" || kind === "primary_key") && (
        <FormRow label="Columns" className="items-stretch">
          <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-2">
            <ColumnPicker
              cols={tableCols}
              selected={selected}
              onToggle={(c) => setAction({ columns: pick(selected, c) })}
            />
          </div>
        </FormRow>
      )}

      {kind === "check" && (
        <FormRow label="Expression">
          <input
            type="text"
            placeholder="CHECK expression"
            value={(action.expression as string) ?? ""}
            onChange={(e) => setAction({ expression: e.target.value })}
            className={monoInputClass}
          />
        </FormRow>
      )}

      {kind === "foreign_key" && (
        <>
          <FormRow label="Columns" className="items-stretch">
            <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-2">
              <ColumnPicker
                cols={tableCols}
                selected={selected}
                onToggle={(c) => setAction({ columns: pick(selected, c) })}
              />
            </div>
          </FormRow>
          <FormRow label="Referenced table">
            <select
              aria-label="Referenced table"
              value={refKey(
                (action.ref_schema as string) ?? "",
                (action.ref_table as string) ?? "",
              )}
              onChange={(e) => {
                const { schema, table } = parseRefKey(e.target.value);
                const t = graph.tables.find(
                  (tbl) => tbl.name === table && tbl.schema === schema,
                );
                setAction({
                  ref_table: table,
                  ref_schema: schema,
                  ref_columns: [],
                });
                if (!t) return;
                const pkCols = t.columns.filter((c) => c.is_pk).map((c) => c.name);
                if (pkCols.length > 0 && selected.length > 0) {
                  setAction({
                    ref_table: table,
                    ref_schema: schema,
                    ref_columns: pkCols.slice(0, selected.length),
                  });
                }
              }}
              className={controlClass}
            >
              <option value="" disabled>
                Select a table
              </option>
              {graph.tables.map((t) => (
                <option key={refKey(t.schema, t.name)} value={refKey(t.schema, t.name)}>
                  {t.schema}.{t.name}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Referenced columns" className="items-stretch">
            <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-2">
              <ColumnPicker
                cols={refCols}
                selected={refSelected}
                onToggle={(c) => setAction({ ref_columns: pick(refSelected, c) })}
              />
            </div>
          </FormRow>
          <FormRow label="On delete">
            <select
              aria-label="On delete"
              value={(action.on_delete as string) ?? "NO ACTION"}
              onChange={(e) => setAction({ on_delete: e.target.value })}
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
              value={(action.on_update as string) ?? "NO ACTION"}
              onChange={(e) => setAction({ on_update: e.target.value })}
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
                checked={!!action.deferrable}
                onChange={(e) =>
                  setAction({
                    deferrable: e.target.checked,
                    initially_deferred: e.target.checked ? action.initially_deferred ?? false : false,
                  })
                }
                className="rounded border-border bg-surface text-accent focus:ring-accent"
              />
              <span>DEFERRABLE</span>
            </label>
          </FormRow>
          {!!action.deferrable && (
            <FormRow label="Initially deferred">
              <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="INITIALLY DEFERRED"
                  checked={!!action.initially_deferred}
                  onChange={(e) => setAction({ initially_deferred: e.target.checked })}
                  className="rounded border-border bg-surface text-accent focus:ring-accent"
                />
                <span>INITIALLY DEFERRED</span>
              </label>
            </FormRow>
          )}
        </>
      )}
    </div>
  );
}