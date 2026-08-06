import type { DdlParams } from "../../../lib/objectCrud";

interface Props {
  params: DdlParams;
  onChange: (p: DdlParams) => void;
}

type EnumOp = "create" | "rename_type" | "add_value" | "rename_value";

const OP_LABELS: Record<EnumOp, string> = {
  create: "Create",
  rename_type: "Rename type",
  add_value: "Add value",
  rename_value: "Rename value",
};

function getOp(params: DdlParams): EnumOp {
  const action = (params.action ?? {}) as Record<string, unknown>;
  const op = action.op;
  if (op === "rename_type" || op === "add_value" || op === "rename_value") return op;
  return "create";
}

function patchAction(params: DdlParams, patch: Record<string, unknown>): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  return { ...params, action: { ...action, ...patch } };
}

function patchActionResetOp(params: DdlParams, op: EnumOp): DdlParams {
  const action = (params.action ?? {}) as Record<string, unknown>;
  const labels = (action.labels as string[]) ?? [];
  return { ...params, action: { op, labels } };
}

function NoRemovalNote() {
  return (
    <p className="text-xs text-text-muted">
      PostgreSQL has no ALTER TYPE … DROP VALUE. To remove a value, drop and recreate the type.
    </p>
  );
}

export function EnumForm({ params, onChange }: Props) {
  const op = getOp(params);
  const action = (params.action ?? {}) as Record<string, unknown>;
  const labels = (action.labels as string[]) ?? [];

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
        placeholder="Enum name"
        value={(params.name as string) ?? ""}
        onChange={(e) => onChange({ ...params, name: e.target.value })}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
      />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-muted">Operation</span>
        <select
          aria-label="Operation"
          value={op}
          onChange={(e) => onChange(patchActionResetOp(params, e.target.value as EnumOp))}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        >
          {(Object.keys(OP_LABELS) as EnumOp[]).map((key) => (
            <option key={key} value={key}>
              {OP_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      {op === "create" && (
        <div className="flex flex-col gap-1">
          {labels.map((l, i) => (
            <div key={i} className="flex gap-1">
              <input
                type="text"
                placeholder={`Value ${i + 1}`}
                value={l}
                onChange={(e) =>
                  onChange(
                    patchAction(params, {
                      labels: labels.map((x, j) => (j === i ? e.target.value : x)),
                    }),
                  )
                }
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
              />
              <button
                type="button"
                onClick={() =>
                  onChange(patchAction(params, { labels: labels.filter((_, j) => j !== i) }))
                }
                className="text-text-muted hover:text-red-400 px-2"
                aria-label={`Remove value ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange(patchAction(params, { labels: [...labels, ""] }))}
            className="self-start text-xs text-accent hover:text-accent/80"
          >
            + Add value
          </button>
          <NoRemovalNote />
        </div>
      )}

      {op === "rename_type" && (
        <input
          type="text"
          placeholder="New name"
          value={(action.new_name as string) ?? ""}
          onChange={(e) => onChange(patchAction(params, { new_name: e.target.value }))}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
        />
      )}

      {op === "add_value" && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            placeholder="New value"
            value={(action.value as string) ?? ""}
            onChange={(e) => onChange(patchAction(params, { value: e.target.value }))}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={!!action.if_not_exists}
              onChange={(e) => onChange(patchAction(params, { if_not_exists: e.target.checked }))}
              className="rounded border-border bg-surface text-accent focus:ring-accent"
            />
            IF NOT EXISTS
          </label>
          <input
            type="text"
            placeholder="BEFORE (optional)"
            value={(action.before as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { before: e.target.value || null, after: null }))
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <input
            type="text"
            placeholder="AFTER (optional)"
            value={(action.after as string) ?? ""}
            onChange={(e) =>
              onChange(patchAction(params, { after: e.target.value || null, before: null }))
            }
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <NoRemovalNote />
        </div>
      )}

      {op === "rename_value" && (
        <div className="flex gap-1">
          <input
            type="text"
            placeholder="From"
            value={(action.from as string) ?? ""}
            onChange={(e) => onChange(patchAction(params, { from: e.target.value }))}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
          <input
            type="text"
            placeholder="To"
            value={(action.to as string) ?? ""}
            onChange={(e) => onChange(patchAction(params, { to: e.target.value }))}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text"
          />
        </div>
      )}
    </div>
  );
}