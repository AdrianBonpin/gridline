import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import * as cmd from "../../../lib/commands";
import type { SchemaGraph } from "../../../lib/types";
import { ColumnPicker } from "./ColumnPicker";

interface Props {
  connectionId: string;
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}

const METHODS = ["", "btree", "hash", "gist", "gin", "brin"];

function patchAction(params: DdlParams, patch: Record<string, unknown>): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function IndexForm({ connectionId, params, onChange }: Props) {
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
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder="Schema"
        value={(p.schema as string) ?? ""}
        onChange={(e) => onChange({ ...p, schema: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <input
        type="text"
        placeholder="Table"
        value={(p.table as string) ?? ""}
        onChange={(e) => onChange({ ...p, table: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <input
        type="text"
        placeholder="Index name"
        value={(p.name as string) ?? ""}
        onChange={(e) => onChange({ ...p, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <label className="flex items-center gap-2 text-sm text-text">
        <input
          type="checkbox"
          checked={!!action.unique}
          onChange={(e) => setAction({ unique: e.target.checked })}
          aria-label="Unique"
          className="rounded border-border bg-surface text-accent focus:ring-accent"
        />
        Unique
      </label>
      <select
        value={(action.method as string) ?? ""}
        onChange={(e) => setAction({ method: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      >
        {METHODS.map((m) => (
          <option key={m} value={m}>
            {m || "(default btree)"}
          </option>
        ))}
      </select>
      <div className="text-xs text-text-muted">Columns</div>
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
      <input
        type="text"
        placeholder="WHERE predicate (optional)"
        value={(action.predicate as string) ?? ""}
        onChange={(e) => setAction({ predicate: e.target.value || null })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
    </div>
  );
}