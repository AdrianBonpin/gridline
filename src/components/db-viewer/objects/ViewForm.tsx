import { lazy, Suspense } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import { FormRow, inputClass, controlClass } from "./formRow";

const SqlEditorField = lazy(() =>
  import("../../editor/SqlEditorField").then((m) => ({ default: m.SqlEditorField })),
);

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
          placeholder={isMat ? "Materialized view name" : "View name"}
          value={(params.name as string) ?? ""}
          onChange={(e) => onChange({ ...params, name: e.target.value })}
          className={inputClass}
        />
      </FormRow>
      <FormRow label="Operation">
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) => onChange(patchAction(params, { op: e.target.value }))}
          className={controlClass}
        >
          <option value="create">{isMat ? "Create" : "Create or replace"}</option>
          {isMat && <option value="replace">Replace (drop + create)</option>}
        </select>
      </FormRow>
      {isMat && op === "replace" && (
        <div className="border-b border-border px-4 py-2">
          <p className="text-xs text-text-muted">
            Materialized views cannot be CREATE OR REPLACE — this will drop and recreate.
          </p>
        </div>
      )}
      <FormRow label={isMat ? "Definition" : "Body"} className="items-stretch">
        <div className="min-w-0 flex-1 py-2" style={{ minHeight: 140 }}>
          <Suspense
            fallback={
              <textarea
                rows={6}
                value={(action.definition as string) ?? ""}
                onChange={(e) => onChange(patchAction(params, { definition: e.target.value }))}
                className="w-full h-full bg-transparent px-3 font-mono text-xs text-text outline-none resize-none"
              />
            }
          >
            <div className="h-full w-full font-mono">
              <SqlEditorField
                value={(action.definition as string) ?? ""}
                onChange={(v) => onChange(patchAction(params, { definition: v }))}
                height={140}
              />
            </div>
          </Suspense>
        </div>
      </FormRow>
    </div>
  );
}