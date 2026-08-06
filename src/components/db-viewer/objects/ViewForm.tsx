import type { DdlParams } from "../../../lib/objectCrud";

interface Props {
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

type ViewOp = "create" | "replace";

function getOp(params: DdlParams): ViewOp {
  const action = (params.action ?? {}) as Record<string, unknown>;
  const op = action.op;
  if (op === "replace") return "replace";
  return "create";
}

function patchAction(
  params: DdlParams,
  patch: Record<string, unknown>,
): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function ViewForm({ params, schemas, onChange }: Props) {
  const op = getOp(params);
  const isMat = !!params.materialized;
  const action = (params.action ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-2">
      {schemas && schemas.length > 0 ? (
        <select
          value={(params.schema as string) ?? ""}
          onChange={(e) => onChange({ ...params, schema: e.target.value })}
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
          value={(params.schema as string) ?? ""}
          onChange={(e) => onChange({ ...params, schema: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
      <input
        type="text"
        placeholder={isMat ? "Materialized view name" : "View name"}
        value={(params.name as string) ?? ""}
        onChange={(e) => onChange({ ...params, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">Operation</span>
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) => onChange(patchAction(params, { op: e.target.value }))}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          <option value="create">{isMat ? "Create" : "Create or replace"}</option>
          {isMat && <option value="replace">Replace (drop + create)</option>}
        </select>
      </label>
      {isMat && op === "replace" && (
        <p className="text-xs text-text-muted">
          Materialized views cannot be CREATE OR REPLACE — this will drop and recreate.
        </p>
      )}
      <textarea
        placeholder="Definition"
        value={(action.definition as string) ?? ""}
        onChange={(e) => onChange(patchAction(params, { definition: e.target.value }))}
        rows={6}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text"
      />
    </div>
  );
}