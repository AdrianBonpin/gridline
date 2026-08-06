import { useEffect, useState } from "react";
import { getFunctions } from "../../../lib/commands";
import type { DdlParams } from "../../../lib/objectCrud";
import type { FunctionInfo } from "../../../lib/types";

interface Props {
  connectionId: string;
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}

type TriggerOp = "create" | "enable" | "disable";

const TIMINGS = ["BEFORE", "AFTER", "INSTEAD OF"];
const EVENTS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];
const ORIENT = ["ROW", "STATEMENT"];

function getOp(params: DdlParams): TriggerOp {
  const action = (params.action ?? {}) as Record<string, unknown>;
  const op = action.op as string;
  if (op === "enable" || op === "disable") return op;
  return "create";
}

function patchAction(
  params: DdlParams,
  patch: Record<string, unknown>,
): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

export function TriggerForm({ connectionId, params, onChange }: Props) {
  const [fns, setFns] = useState<FunctionInfo[]>([]);
  const op = getOp(params);
  const action = (params.action ?? {}) as Record<string, unknown>;
  const events = (action.events as string[]) ?? [];

  useEffect(() => {
    let cancelled = false;
    getFunctions(connectionId, (params.schema as string) || undefined)
      .then((all) => {
        if (!cancelled) {
          setFns(all.filter((f) => f.return_type === "trigger"));
        }
      })
      .catch(() => {
        if (!cancelled) setFns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, params.schema]);

  const setAction = (patch: Record<string, unknown>) =>
    onChange(patchAction(params, patch));

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder="Schema"
        value={(params.schema as string) ?? ""}
        onChange={(e) => onChange({ ...params, schema: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <input
        type="text"
        placeholder="Trigger name"
        value={(params.name as string) ?? ""}
        onChange={(e) => onChange({ ...params, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <select
        value={op}
        onChange={(e) =>
          onChange({ ...params, action: { op: e.target.value } })
        }
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      >
        <option value="create">Create</option>
        <option value="enable">Enable</option>
        <option value="disable">Disable</option>
      </select>

      {op === "create" && (
        <>
          <input
            type="text"
            placeholder="Table"
            value={(action.table as string) ?? ""}
            onChange={(e) => setAction({ table: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <select
            value={(action.timing as string) ?? "BEFORE"}
            onChange={(e) => setAction({ timing: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {TIMINGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1">
            {EVENTS.map((ev) => (
              <button
                type="button"
                key={ev}
                onClick={() =>
                  setAction({
                    events: events.includes(ev)
                      ? events.filter((x) => x !== ev)
                      : [...events, ev],
                  })
                }
                className={`text-xs px-2 py-1 rounded-lg border ${
                  events.includes(ev)
                    ? "bg-accent text-white border-accent"
                    : "border-border text-text"
                }`}
              >
                {ev}
              </button>
            ))}
          </div>
          <select
            value={(action.orientation as string) ?? "ROW"}
            onChange={(e) => setAction({ orientation: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {ORIENT.map((o) => (
              <option key={o} value={o}>
                FOR EACH {o}
              </option>
            ))}
          </select>
          <select
            value={(action.function_name as string) ?? ""}
            onChange={(e) => {
              const f = fns.find((fn) => fn.name === e.target.value);
              setAction({
                function_name: e.target.value,
                function_schema: f?.schema ?? (params.schema as string),
              });
            }}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            <option value="">(trigger function)</option>
            {fns.map((f) => (
              <option key={`${f.schema}.${f.name}`} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Function args (comma-separated)"
            value={(action.function_args as string[] | undefined)?.join(", ") ?? ""}
            onChange={(e) =>
              setAction({
                function_args: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <input
            type="text"
            placeholder="WHEN (optional)"
            value={(action.when as string) ?? ""}
            onChange={(e) =>
              setAction({ when: e.target.value || null })
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
        </>
      )}

      {(op === "enable" || op === "disable") && (
        <input
          type="text"
          placeholder="Table"
          value={(action.table as string) ?? ""}
          onChange={(e) => setAction({ table: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
    </div>
  );
}