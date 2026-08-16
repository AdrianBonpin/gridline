import { lazy, Suspense } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import { FormRow, FormSectionHeader, inputClass, controlClass, monoInputClass } from "./formRow";

const SqlEditorField = lazy(() =>
  import("../../editor/SqlEditorField").then((m) => ({ default: m.SqlEditorField })),
);

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
    <div>
      <FormRow label="Schema">
        {schemas && schemas.length > 0 ? (
          <select
            value={(params.schema as string) ?? ""}
            onChange={(e) =>
              onChange(patchTopLevel(params, kind, { schema: e.target.value }))
            }
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
            onChange={(e) =>
              onChange(patchTopLevel(params, kind, { schema: e.target.value }))
            }
            className={inputClass}
          />
        )}
      </FormRow>
      <FormRow label="Name">
        <input
          type="text"
          placeholder={placeholder}
          value={(params.name as string) ?? ""}
          onChange={(e) =>
            onChange(patchTopLevel(params, kind, { name: e.target.value }))
          }
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Operation">
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) => onChange({ ...params, action: { op: e.target.value } })}
          className={controlClass}
        >
          <option value="create_or_replace">Create / replace</option>
          <option value="drop">Drop by signature</option>
        </select>
      </FormRow>

      {op === "create_or_replace" && (
        <>
          <FormSectionHeader label="Arguments" count={args.length} />
          {args.map((a, i) => (
            <div
              key={i}
              className="border-b border-border px-4 py-2 flex items-center gap-2"
            >
              <select
                value={a.mode}
                onChange={(e) => setArg(i, { mode: e.target.value })}
                aria-label={`Argument ${i + 1} mode`}
                className="w-24 shrink-0 rounded bg-surface px-2 py-1 font-heading text-xs text-text outline-none"
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="text-xs text-text-muted w-8 shrink-0 font-mono">
                #{i + 1}
              </span>
              <input
                type="text"
                placeholder="name"
                value={a.name}
                onChange={(e) => setArg(i, { name: e.target.value })}
                className={`${monoInputClass} flex-1`}
              />
              <span className="text-border">:</span>
              <input
                type="text"
                placeholder="type"
                value={a.type}
                onChange={(e) => setArg(i, { type: e.target.value })}
                className={`${monoInputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => setAction({ args: args.filter((_, j) => j !== i) })}
                className="text-text-muted px-2"
              >
                ×
              </button>
            </div>
          ))}
          <div className="border-b border-border px-4 py-2">
            <button
              type="button"
              onClick={() =>
                setAction({
                  args: [...args, { mode: "in", name: "", type: "" }],
                })
              }
              className="text-xs text-accent hover:text-accent-hover"
            >
              + Add argument
            </button>
          </div>

          {kind === "function" && (
            <FormRow label="Return type">
              <input
                type="text"
                placeholder="Return type"
                value={(action.return_type as string | null) ?? ""}
                onChange={(e) => setAction({ return_type: e.target.value })}
                className={monoInputClass}
              />
            </FormRow>
          )}
          <FormRow label="Language">
            <select
              aria-label="Language"
              value={(action.language as string) ?? "plpgsql"}
              onChange={(e) => setAction({ language: e.target.value })}
              className={controlClass}
            >
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Volatility">
            <select
              aria-label="Volatility"
              value={(action.volatility as string) ?? ""}
              onChange={(e) => setAction({ volatility: e.target.value || null })}
              className={controlClass}
            >
              {VOL.map((v) => (
                <option key={v} value={v}>
                  {v || "(default VOLATILE)"}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Strict">
            <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                checked={!!action.strict}
                onChange={(e) => setAction({ strict: e.target.checked })}
                aria-label="STRICT"
                className="rounded border-border bg-surface text-accent focus:ring-accent"
              />
              <span>STRICT (RETURNS NULL ON NULL INPUT)</span>
            </label>
          </FormRow>
          <FormRow label="Body" className="items-stretch" outline={false}>
            <div className="min-w-0 flex-1 py-2" style={{ minHeight: 140 }}>
              <Suspense
                fallback={
                  <textarea
                    rows={6}
                    value={(action.body as string) ?? ""}
                    onChange={(e) => setAction({ body: e.target.value })}
                    className="w-full h-full bg-transparent px-3 font-mono text-xs text-text outline-none resize-none"
                  />
                }
              >
                <div className="h-full w-full font-mono">
                  <SqlEditorField
                    value={(action.body as string) ?? ""}
                    onChange={(v) => setAction({ body: v })}
                    height={140}
                  />
                </div>
              </Suspense>
            </div>
          </FormRow>
        </>
      )}

      {op === "drop" && (
        <FormRow label="Arg types">
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
            className={monoInputClass}
          />
        </FormRow>
      )}
    </div>
  );
}