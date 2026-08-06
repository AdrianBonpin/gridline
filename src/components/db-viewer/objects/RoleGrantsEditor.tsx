import { useEffect, useMemo, useState } from "react";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import type { PrivilegeEntry } from "../../../lib/types";
import { FormRow, FormSectionHeader, inputClass, controlClass } from "./formRow";

type ObjectClass = "table" | "sequence" | "routine" | "schema" | "database";

interface Props {
  connectionId: string;
  role: string;
}

const CLASS_LABELS: Record<ObjectClass, string> = {
  table: "Table",
  sequence: "Sequence",
  routine: "Routine",
  schema: "Schema",
  database: "Database",
};

const PRIVILEGES: Record<ObjectClass, string[]> = {
  table: ["SELECT", "INSERT", "UPDATE", "TRUNCATE", "REFERENCES", "TRIGGER"],
  sequence: ["USAGE", "SELECT", "UPDATE"],
  routine: ["EXECUTE"],
  schema: ["USAGE", "CREATE"],
  database: ["CONNECT", "CREATE", "TEMP"],
};

export function RoleGrantsEditor({ connectionId, role }: Props) {
  const [privileges, setPrivileges] = useState<PrivilegeEntry[]>([]);
  const [objectClass, setObjectClass] = useState<ObjectClass>("table");
  const [objectSchema, setObjectSchema] = useState("");
  const [objectName, setObjectName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grantOption, setGrantOption] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    cmd
      .getRolePrivileges(connectionId, role)
      .then((list) => {
        if (active) {
          setPrivileges(Array.isArray(list) ? list : []);
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [connectionId, role]);

  const grouped = useMemo(() => {
    const map = new Map<ObjectClass, PrivilegeEntry[]>();
    privileges.forEach((p) => {
      const list = map.get(p.object_class) ?? [];
      list.push(p);
      map.set(p.object_class, list);
    });
    return map;
  }, [privileges]);

  const togglePrivilege = (priv: string) => {
    const next = new Set(selected);
    if (next.has(priv)) next.delete(priv);
    else next.add(priv);
    setSelected(next);
  };

  const submit = async (op: "grant" | "revoke") => {
    setError(null);
    try {
      const sqls = await cmd.buildObjectDdl(connectionId, "role", {
        schema: "",
        name: "",
        action: {
          op,
          object_class: objectClass,
          object_schema: objectSchema || null,
          object_name: objectName,
          privileges: Array.from(selected),
          grantee: role,
          grant_option: grantOption,
        },
      });
      const list = Array.isArray(sqls) ? sqls : [sqls];
      list.forEach((sql) =>
        useDbViewerStore.getState().addChange({
          type: "ddl",
          sql,
          description: `${op.toUpperCase()} ${Array.from(selected).join(",")} on ${objectClass} ${objectSchema ? `${objectSchema}.` : ""}${objectName} to ${role}`,
        }),
      );
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      <FormSectionHeader label="Current privileges" count={privileges.length} />
      {loading && <p className="px-4 py-2 text-xs text-text-muted">Loading...</p>}
      {grouped.size === 0 && !loading && (
        <p className="px-4 py-2 text-xs text-text-muted">No privileges found for this role.</p>
      )}
      {Array.from(grouped.entries()).map(([cls, list]) => (
        <div key={cls} className="border-b border-border">
          <div className="px-4 py-1 text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {CLASS_LABELS[cls]}
          </div>
          {list.map((entry) => (
            <div
              key={`${entry.object_class}:${entry.schema ?? ""}:${entry.name}`}
              className="px-4 py-1.5 flex items-center gap-2 text-xs text-text"
            >
              <span className="font-mono text-accent">
                {entry.schema ? `${entry.schema}.` : ""}
                {entry.name}
              </span>
              <span className="text-text-muted">{entry.privileges.join(", ")}</span>
            </div>
          ))}
        </div>
      ))}

      <FormSectionHeader label="Edit privileges" />

      <FormRow label="Object class">
        <select
          aria-label="Object class"
          value={objectClass}
          onChange={(e) => {
            setObjectClass(e.target.value as ObjectClass);
            setSelected(new Set());
          }}
          className={controlClass}
        >
          {(Object.keys(CLASS_LABELS) as ObjectClass[]).map((c) => (
            <option key={c} value={c}>
              {CLASS_LABELS[c]}
            </option>
          ))}
        </select>
      </FormRow>

      <FormRow label="Schema">
        <input
          type="text"
          placeholder="Schema"
          value={objectSchema}
          onChange={(e) => setObjectSchema(e.target.value)}
          className={inputClass}
        />
      </FormRow>

      <FormRow label="Object name">
        <input
          type="text"
          placeholder="Object name"
          value={objectName}
          onChange={(e) => setObjectName(e.target.value)}
          className={inputClass}
        />
      </FormRow>

      <FormRow label="Privileges">
        <div className="flex-1 px-4 py-2 grid grid-cols-2 gap-2">
          {PRIVILEGES[objectClass].map((priv) => (
            <label key={priv} className="flex items-center gap-2 text-xs text-text cursor-pointer">
              <input
                type="checkbox"
                aria-label={priv}
                checked={selected.has(priv)}
                onChange={() => togglePrivilege(priv)}
                className="rounded border-border bg-surface text-accent focus:ring-accent"
              />
              <span>{priv}</span>
            </label>
          ))}
        </div>
      </FormRow>

      <FormRow label="Grant option">
        <label className="min-w-0 flex-1 flex items-center gap-2 px-3 font-heading text-xs text-text cursor-pointer">
          <input
            type="checkbox"
            checked={grantOption}
            onChange={(e) => setGrantOption(e.target.checked)}
            className="rounded border-border bg-surface text-accent focus:ring-accent"
          />
          <span>WITH GRANT OPTION</span>
        </label>
      </FormRow>

      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => submit("grant")}
          disabled={selected.size === 0 || !objectName.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Grant
        </button>
        <button
          type="button"
          onClick={() => submit("revoke")}
          disabled={selected.size === 0 || !objectName.trim()}
          className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-text border border-border hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          Revoke
        </button>
      </div>

      {error && <p className="px-4 text-xs text-red-400">{error}</p>}
    </div>
  );
}