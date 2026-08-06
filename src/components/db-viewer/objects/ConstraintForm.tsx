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

function patchAction(params: DdlParams, patch: Record<string, unknown>): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function ConstraintForm({ connectionId, params, schemas, onChange }: Props) {
  const p = params as Record<string, unknown>;
  const action = (p.action ?? {}) as Record<string, unknown>;
  const kind = (action.op as string) ?? "check";

  const [graph, setGraph] = useState<SchemaGraph>({ tables: [], relationships: [] });

  useEffect(() => {
    cmd
      .getSchemaGraph(connectionId, (p.schema as string) || undefined)
      .then((g: SchemaGraph) => setGraph(g))
      .catch(() => setGraph({ tables: [], relationships: [] }));
  }, [connectionId, p.schema]);

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
            <input
              type="text"
              placeholder="Referenced table"
              value={(action.ref_table as string) ?? ""}
              onChange={(e) => {
                const t = graph.tables.find((t) => t.name === e.target.value);
                setAction({
                  ref_table: e.target.value,
                  ref_schema: t?.schema ?? "",
                  ref_columns: [],
                });
              }}
              className={inputClass}
            />
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
        </>
      )}
    </div>
  );
}