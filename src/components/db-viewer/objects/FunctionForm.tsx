import type { DdlParams } from "../../../lib/objectCrud";

interface Props {
  kind: "function" | "procedure";
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

interface Arg {
  mode: string;
  name: string;
  type: string;
}

type FunctionOp = "create_or_replace" | "drop";

const MODES = ["in", "out", "inout", "variadic"];
const LANGS = ["plpgsql", "sql", "c"];
const VOL = ["", "IMMUTABLE", "STABLE", "VOLATILE"];

function getOp(params: DdlParams): FunctionOp {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return action.op === "drop" ? "drop" : "create_or_replace";
}

function patchAction(
  params: DdlParams,
  patch: Record<string, unknown>,
): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

function patchTopLevel(
  params: DdlParams,
  kind: "function" | "procedure",
  patch: Record<string, unknown>,
): DdlParams {
  return {
    ...params,
    ...patch,
    is_procedure: kind === "procedure" ? true : params.is_procedure,
  };
}

export function FunctionForm({ kind, params, schemas, onChange }: Props) {
  const op = getOp(params);
  const action = (params.action ?? {}) as Record<string, unknown>;
  const args = (action.args as Arg[]) ?? [];

  const setAction = (patch: Record<string, unknown>) =>
    onChange(patchAction(params, patch));

  const setArg = (i: number, patch: Partial<Arg>) =>
    setAction({
      args: args.map((a, j) => (j === i ? { ...a, ...patch } : a)),
    });

  const placeholder = kind === "procedure" ? "Procedure name" : "Function name";

  return (
    <div className="flex flex-col gap-2">
      {schemas && schemas.length > 0 ? (
        <select
          value={(params.schema as string) ?? ""}
          onChange={(e) =>
            onChange(patchTopLevel(params, kind, { schema: e.target.value }))
          }
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
          onChange={(e) =>
            onChange(patchTopLevel(params, kind, { schema: e.target.value }))
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
      <input
        type="text"
        placeholder={placeholder}
        value={(params.name as string) ?? ""}
        onChange={(e) =>
          onChange(patchTopLevel(params, kind, { name: e.target.value }))
        }
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <select
        value={op}
        onChange={(e) =>
          onChange({ ...params, action: { op: e.target.value } })
        }
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      >
        <option value="create_or_replace">Create / replace</option>
        <option value="drop">Drop by signature</option>
      </select>

      {op === "create_or_replace" && (
        <>
          <div className="text-xs text-text-muted">Arguments</div>
          {args.map((a, i) => (
            <div key={i} className="flex gap-1">
              <select
                value={a.mode}
                onChange={(e) => setArg(i, { mode: e.target.value })}
                className="rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="name"
                value={a.name}
                onChange={(e) => setArg(i, { name: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
              />
              <input
                type="text"
                placeholder="type"
                value={a.type}
                onChange={(e) => setArg(i, { type: e.target.value })}
                className="flex-1 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text"
              />
              <button
                type="button"
                onClick={() =>
                  setAction({ args: args.filter((_, j) => j !== i) })
                }
                className="text-text-muted px-2"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setAction({
                args: [...args, { mode: "in", name: "", type: "" }],
              })
            }
            className="self-start text-xs text-accent hover:text-accent-hover"
          >
            + Add argument
          </button>
          {kind === "function" && (
            <input
              type="text"
              placeholder="Return type"
              value={(action.return_type as string | null) ?? ""}
              onChange={(e) => setAction({ return_type: e.target.value })}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
            />
          )}
          <select
            value={(action.language as string) ?? "plpgsql"}
            onChange={(e) => setAction({ language: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={(action.volatility as string) ?? ""}
            onChange={(e) =>
              setAction({ volatility: e.target.value || null })
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          >
            {VOL.map((v) => (
              <option key={v} value={v}>
                {v || "(default VOLATILE)"}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={!!action.strict}
              onChange={(e) => setAction({ strict: e.target.checked })}
              className="rounded border-border bg-surface text-accent focus:ring-accent"
            />
            STRICT (RETURNS NULL ON NULL INPUT)
          </label>
          <textarea
            placeholder="Body"
            value={(action.body as string) ?? ""}
            onChange={(e) => setAction({ body: e.target.value })}
            rows={6}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-mono text-text"
          />
        </>
      )}

      {op === "drop" && (
        <input
          type="text"
          placeholder="Arg types (comma-separated)"
          value={(action.arg_types as string[] | undefined)?.join(", ") ?? ""}
          onChange={(e) =>
            setAction({
              arg_types: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
    </div>
  );
}