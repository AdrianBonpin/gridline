import type { DdlParams } from "../../../lib/objectCrud";
import { FormRow, inputClass, controlClass } from "./formRow";

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
    <div>
      <FormRow label="Schema">
        {schemas && schemas.length > 0 ? (
          <select
            value={(params.schema as string) ?? ""}
            onChange={(e) => onChange({ ...params, schema: e.target.value })}
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
            value={(params.schema as string) ?? ""}
            onChange={(e) => onChange({ ...params, schema: e.target.value })}
            className={inputClass}
          />
        )}
      </FormRow>
      <FormRow label="Name">
        <input
          type="text"
          placeholder="Sequence name"
          value={(params.name as string) ?? ""}
          onChange={(e) => onChange({ ...params, name: e.target.value })}
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Operation">
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) =>
            onChange(patchAction(params, { op: e.target.value }))
          }
          className={controlClass}
        >
          {(Object.keys(OP_LABELS) as SequenceOp[]).map((key) => (
            <option key={key} value={key}>
              {OP_LABELS[key]}
            </option>
          ))}
        </select>
      </FormRow>

      {(op === "create" || op === "alter") && (
        <>
          <FormRow label="Increment">
            <input
              type="text"
              placeholder="Increment"
              value={(action.increment as string) ?? ""}
              onChange={(e) =>
                onChange(patchAction(params, { increment: e.target.value }))
              }
              className={inputClass}
            />
          </FormRow>
          <FormRow label="Min value">
            <input
              type="text"
              placeholder="Min value"
              value={(action.min_value as string) ?? ""}
              onChange={(e) =>
                onChange(patchAction(params, { min_value: e.target.value }))
              }
              className={inputClass}
            />
          </FormRow>
          <FormRow label="Max value">
            <input
              type="text"
              placeholder="Max value"
              value={(action.max_value as string) ?? ""}
              onChange={(e) =>
                onChange(patchAction(params, { max_value: e.target.value }))
              }
              className={inputClass}
            />
          </FormRow>
          {op === "create" && (
            <FormRow label="Start">
              <input
                type="text"
                placeholder="Start"
                value={(action.start as string) ?? ""}
                onChange={(e) =>
                  onChange(patchAction(params, { start: e.target.value }))
                }
                className={inputClass}
              />
            </FormRow>
          )}
          <FormRow label="Cycle">
            <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={!!action.cycle}
                onChange={(e) =>
                  onChange(patchAction(params, { cycle: e.target.checked }))
                }
                aria-label="CYCLE"
                className="rounded border-border bg-surface text-accent focus:ring-accent"
              />
              <span>CYCLE</span>
            </label>
          </FormRow>
        </>
      )}

      {op === "restart" && (
        <FormRow label="Restart with">
          <input
            type="text"
            placeholder="Restart with"
            value={(action.with as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { with: e.target.value }))
            }
            className={inputClass}
          />
        </FormRow>
      )}
    </div>
  );
}