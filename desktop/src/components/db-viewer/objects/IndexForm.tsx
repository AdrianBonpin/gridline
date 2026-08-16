import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import * as cmd from "../../../lib/commands";
import type { SchemaGraph } from "../../../lib/types";
import { ColumnPicker } from "./ColumnPicker";
import { FormRow, inputClass, controlClass } from "./formRow";

interface Props {
  connectionId: string;
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

const METHODS = ["", "btree", "hash", "gist", "gin", "brin"];

function patchAction(params: DdlParams, patch: Record<string, unknown>): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function IndexForm({ connectionId, params, schemas, onChange }: Props) {
  const p = params as Record<string, unknown>;
  const action = (p.action ?? {}) as Record<string, unknown>;
  const [cols, setCols] = useState<string[]>([]);

  useEffect(() => {
    cmd
      .getSchemaGraph(connectionId, (p.schema as string) || undefined)
      .then((g: SchemaGraph) => {
        const t = g.tables.find(
          (t) => t.name === (p.table as string) && t.schema === (p.schema as string),
        );
        setCols(t ? t.columns.map((c) => c.name) : []);
      })
      .catch(() => setCols([]));
  }, [connectionId, p.schema, p.table]);

  const selected: string[] = (action.columns as string[]) ?? [];
  const setAction = (patch: Record<string, unknown>) => onChange(patchAction(params, patch));

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
          placeholder="Index name"
          value={(p.name as string) ?? ""}
          onChange={(e) => onChange({ ...p, name: e.target.value })}
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Unique">
        <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
          <input
            type="checkbox"
            checked={!!action.unique}
            onChange={(e) => setAction({ unique: e.target.checked })}
            aria-label="Unique"
            className="rounded border-border bg-surface text-accent focus:ring-accent"
          />
          <span>Unique</span>
        </label>
      </FormRow>
      <FormRow label="Method">
        <select
          aria-label="Method"
          value={(action.method as string) ?? ""}
          onChange={(e) => setAction({ method: e.target.value })}
          className={controlClass}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m || "(default btree)"}
            </option>
          ))}
        </select>
      </FormRow>
      <FormRow label="Columns" className="items-stretch">
        <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-2">
          <ColumnPicker
            cols={cols}
            selected={selected}
            onToggle={(c) =>
              setAction({
                columns: selected.includes(c)
                  ? selected.filter((x) => x !== c)
                  : [...selected, c],
              })
            }
          />
        </div>
      </FormRow>
      <FormRow label="Predicate">
        <input
          type="text"
          placeholder="WHERE predicate (optional)"
          value={(action.predicate as string) ?? ""}
          onChange={(e) => setAction({ predicate: e.target.value || null })}
          className={inputClass}
        />
      </FormRow>
    </div>
  );
}