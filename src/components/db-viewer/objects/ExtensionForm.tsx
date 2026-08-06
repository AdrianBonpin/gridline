import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import {
  getAvailableExtensions,
  type AvailableExtension,
} from "../../../lib/objectCrud";
import { FormRow, inputClass, controlClass } from "./formRow";

interface Props {
  connectionId: string;
  params: DdlParams;
  schemas?: string[];
  onChange: (p: DdlParams) => void;
}

type ExtensionOp = "create" | "set_schema";

const OP_LABELS: Record<ExtensionOp, string> = {
  create: "Install",
  set_schema: "Set schema",
};

export function ExtensionForm({ connectionId, params, schemas, onChange }: Props) {
  const p = params as Record<string, unknown>;
  const action = (p.action ?? {}) as Record<string, unknown>;
  const op = (action.op as ExtensionOp) ?? "create";

  const [available, setAvailable] = useState<AvailableExtension[]>([]);

  useEffect(() => {
    getAvailableExtensions(connectionId)
      .then(setAvailable)
      .catch(() => setAvailable([]));
  }, [connectionId]);

  const setAction = (patch: Record<string, unknown>) => {
    onChange({ ...p, action: { ...action, ...patch } });
  };

  const pickExtension = (ext: AvailableExtension) => {
    onChange({
      ...p,
      name: ext.name,
      action: { op: "create", version: ext.version || null },
    });
  };

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

      <FormRow label="Operation">
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) =>
            onChange({ ...p, action: { op: e.target.value as ExtensionOp } })
          }
          className={controlClass}
        >
          {(Object.keys(OP_LABELS) as ExtensionOp[]).map((key) => (
            <option key={key} value={key}>
              {OP_LABELS[key]}
            </option>
          ))}
        </select>
      </FormRow>

      {op === "create" && (
        <>
          <FormRow label="Extension">
            <input
              type="text"
              placeholder="Extension name"
              value={(p.name as string) ?? ""}
              onChange={(e) => onChange({ ...p, name: e.target.value })}
              className={inputClass}
            />
          </FormRow>

          {available.length > 0 && (
            <FormRow label="Available" className="items-stretch">
              <div className="min-w-0 flex-1 flex flex-col gap-0.5 px-4 py-2">
                {available.map((ext) => (
                  <button
                    key={ext.name}
                    type="button"
                    onClick={() => pickExtension(ext)}
                    className="text-left text-xs font-medium text-accent hover:text-accent-hover hover:underline"
                  >
                    <span>{ext.name}</span>
                    {ext.version ? (
                      <span className="text-text-muted"> ({ext.version})</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </FormRow>
          )}

          <FormRow label="Version">
            <input
              type="text"
              placeholder="Version (optional)"
              value={(action.version as string) ?? ""}
              onChange={(e) => setAction({ version: e.target.value || null })}
              className={inputClass}
            />
          </FormRow>
        </>
      )}

      {op === "set_schema" && (
        <FormRow label="New schema">
          <input
            type="text"
            placeholder="New schema"
            value={(action.new_schema as string) ?? ""}
            onChange={(e) => setAction({ new_schema: e.target.value })}
            className={inputClass}
          />
        </FormRow>
      )}
    </div>
  );
}