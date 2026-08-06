import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import * as cmd from "../../../lib/commands";
import type { SchemaGraph } from "../../../lib/types";
import { ColumnPicker } from "./ColumnPicker";

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
    <div className="flex flex-col gap-2">
      {schemas && schemas.length > 0 ? (
        <select
          value={(p.schema as string) ?? ""}
          onChange={(e) => onChange({ ...p, schema: e.target.value })}
          aria-label="Schema"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
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
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
      <input
        type="text"
        placeholder="Table"
        value={(p.table as string) ?? ""}
        onChange={(e) => onChange({ ...p, table: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <input
        type="text"
        placeholder="Constraint name"
        value={(p.name as string) ?? ""}
        onChange={(e) => onChange({ ...p, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <select
        aria-label="Kind"
        value={kind}
        onChange={(e) => onChange({ ...p, action: { op: e.target.value } })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      {(kind === "unique" || kind === "primary_key") && (
        <ColumnPicker
          cols={tableCols}
          selected={selected}
          onToggle={(c) => setAction({ columns: pick(selected, c) })}
        />
      )}

      {kind === "check" && (
        <input
          type="text"
          placeholder="CHECK expression"
          value={(action.expression as string) ?? ""}
          onChange={(e) => setAction({ expression: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text"
        />
      )}

      {kind === "foreign_key" && (
        <>
          <ColumnPicker
            cols={tableCols}
            selected={selected}
            onToggle={(c) => setAction({ columns: pick(selected, c) })}
          />
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
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <ColumnPicker
            cols={refCols}
            selected={refSelected}
            onToggle={(c) => setAction({ ref_columns: pick(refSelected, c) })}
          />
        </>
      )}
    </div>
  );
}