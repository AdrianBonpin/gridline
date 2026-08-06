import { useEffect, useState } from "react";
import type { DdlParams } from "../../../lib/objectCrud";
import {
  getAvailableExtensions,
  type AvailableExtension,
} from "../../../lib/objectCrud";

interface Props {
  connectionId: string;
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}

type ExtensionOp = "create" | "set_schema";

const OP_LABELS: Record<ExtensionOp, string> = {
  create: "Install",
  set_schema: "Set schema",
};

export function ExtensionForm({ connectionId, params, onChange }: Props) {
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
    <div className="flex flex-col gap-2">
      <input
        type="text"
        placeholder="Schema"
        value={(p.schema as string) ?? ""}
        onChange={(e) => onChange({ ...p, schema: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">Operation</span>
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) =>
            onChange({ ...p, action: { op: e.target.value as ExtensionOp } })
          }
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          {(Object.keys(OP_LABELS) as ExtensionOp[]).map((key) => (
            <option key={key} value={key}>
              {OP_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {op === "create" && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            placeholder="Extension name"
            value={(p.name as string) ?? ""}
            onChange={(e) => onChange({ ...p, name: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />

          <span className="text-xs text-text-muted">Available:</span>
          {available.map((ext) => (
            <button
              key={ext.name}
              type="button"
              onClick={() => pickExtension(ext)}
              className="text-left text-sm font-medium text-accent hover:text-accent-hover hover:underline"
            >
              <span>{ext.name}</span>
              {ext.version ? (
                <span className="text-text-muted"> ({ext.version})</span>
              ) : null}
            </button>
          ))}

          <input
            type="text"
            placeholder="Version (optional)"
            value={(action.version as string) ?? ""}
            onChange={(e) => setAction({ version: e.target.value || null })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
        </div>
      )}

      {op === "set_schema" && (
        <input
          type="text"
          placeholder="New schema"
          value={(action.new_schema as string) ?? ""}
          onChange={(e) => setAction({ new_schema: e.target.value })}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}
    </div>
  );
}