import type { DdlParams } from "../../../lib/objectCrud";

interface Props {
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

type SequenceOp = "create" | "alter" | "restart";

const OP_LABELS: Record<SequenceOp, string> = {
  create: "Create",
  alter: "Alter",
  restart: "Restart",
};

function getOp(params: DdlParams): SequenceOp {
  const action = (params.action ?? {}) as Record<string, unknown>;
  const op = action.op;
  if (op === "alter" || op === "restart") return op;
  return "create";
}

function patchAction(
  params: DdlParams,
  patch: Record<string, unknown>,
): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function SequenceForm({ params, schemas, onChange }: Props) {
  const op = getOp(params);
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
        placeholder="Sequence name"
        value={(params.name as string) ?? ""}
        onChange={(e) => onChange({ ...params, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">Operation</span>
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) =>
            onChange(patchAction(params, { op: e.target.value }))
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          {(Object.keys(OP_LABELS) as SequenceOp[]).map((key) => (
            <option key={key} value={key}>
              {OP_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {(op === "create" || op === "alter") && (
        <>
          <input
            type="text"
            placeholder="Increment"
            value={(action.increment as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { increment: e.target.value }))
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <input
            type="text"
            placeholder="Min value"
            value={(action.min_value as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { min_value: e.target.value }))
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <input
            type="text"
            placeholder="Max value"
            value={(action.max_value as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { max_value: e.target.value }))
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          {op === "create" && (
            <input
              type="text"
              placeholder="Start"
              value={(action.start as string) ?? ""}
              onChange={(e) =>
                onChange(patchAction(params, { start: e.target.value }))
              }
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
            />
          )}
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={!!action.cycle}
              onChange={(e) =>
                onChange(patchAction(params, { cycle: e.target.checked }))
              }
              className="rounded border-border bg-surface text-accent focus:ring-accent"
            />
            CYCLE
          </label>
        </>
      )}

      {op === "restart" && (
        <input
          type="text"
          placeholder="Restart with"
          value={(action.with as string) ?? ""}
          onChange={(e) =>
            onChange(patchAction(params, { with: e.target.value }))
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
    </div>
  );
}