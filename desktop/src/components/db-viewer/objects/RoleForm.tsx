import { useEffect, useMemo, useState } from "react";
import { useDbViewerStore } from "../../../stores/dbViewerStore";
import * as cmd from "../../../lib/commands";
import type { RoleInfo } from "../../../lib/types";
import { FormRow, FormSectionHeader, inputClass, controlClass } from "./formRow";

interface RoleMember {
  name: string;
  admin: boolean;
}

interface RoleAction {
  op: "create" | "edit" | "drop";
  login: boolean;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  inherit: boolean;
  replication: boolean;
  bypassrls: boolean;
  connection_limit: number;
  valid_until: string;
  password: string;
  members: RoleMember[];
}

interface RoleParams {
  schema: string;
  name: string;
  action: RoleAction;
}

interface Props {
  connectionId: string;
  mode?: "create" | "edit";
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}

const OPTIONS: { key: keyof Omit<RoleAction, "op" | "connection_limit" | "valid_until" | "password" | "members">; label: string }[] = [
  { key: "login", label: "LOGIN" },
  { key: "superuser", label: "SUPERUSER" },
  { key: "createdb", label: "CREATEDB" },
  { key: "createrole", label: "CREATEROLE" },
  { key: "inherit", label: "INHERIT" },
  { key: "replication", label: "REPLICATION" },
  { key: "bypassrls", label: "BYPASSRLS" },
];

function patchAction(params: RoleParams, patch: Partial<RoleAction>): RoleParams {
  return { ...params, action: { ...params.action, ...patch } };
}

export function RoleForm({ connectionId, mode = "create", params, onChange }: Props) {
  const typed = params as unknown as RoleParams;
  const action = typed.action;

  const [view, setView] = useState<"visual" | "sql">("visual");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [staging, setStaging] = useState(false);
  const [roles, setRoles] = useState<RoleInfo[]>([]);

  const setParams = (next: RoleParams) => onChange(next as unknown as Record<string, unknown>);

  useEffect(() => {
    let active = true;
    cmd
      .getRoles(connectionId)
      .then((list) => {
        if (active) setRoles(list);
      })
      .catch(() => {
        if (active) setRoles([]);
      });
    return () => {
      active = false;
    };
  }, [connectionId]);

  useEffect(() => {
    let active = true;
    setError(null);
    cmd
      .buildObjectDdl(connectionId, "role", params)
      .then((sqls) => {
        if (active) setPreview(Array.isArray(sqls) ? sqls.join("\n;\n") : (sqls as string));
      })
      .catch((e: unknown) => {
        if (active) {
          setPreview("");
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      active = false;
    };
  }, [connectionId, params]);

  const availableRoles = useMemo(
    () => roles.filter((r) => r.name !== typed.name),
    [roles, typed.name],
  );

  const toggleMember = (name: string, checked: boolean) => {
    const next = checked
      ? [...action.members, { name, admin: false }]
      : action.members.filter((m) => m.name !== name);
    setParams(patchAction(typed, { members: next }));
  };

  const setMemberAdmin = (name: string, admin: boolean) => {
    const next = action.members.map((m) => (m.name === name ? { ...m, admin } : m));
    setParams(patchAction(typed, { members: next }));
  };

  const stage = async () => {
    setStaging(true);
    setError(null);
    try {
      const sqls = await cmd.buildObjectDdl(connectionId, "role", params);
      const list = Array.isArray(sqls) ? sqls : [sqls];
      list.forEach((sql) =>
        useDbViewerStore.getState().addChange({
          type: "ddl",
          sql,
          description: `${mode === "edit" ? "Edit" : "Create"} role ${typed.name}`,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStaging(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {mode} role
        </span>

        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              aria-label="Visual"
              onClick={() => setView("visual")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "visual" ? "bg-surface-raised text-text" : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              Visual
            </button>
            <button
              type="button"
              aria-label="SQL"
              onClick={() => setView("sql")}
              className={[
                "px-2 py-0.5 text-xs transition-colors cursor-pointer",
                view === "sql" ? "bg-surface-raised text-text" : "text-text-muted hover:text-text",
              ].join(" ")}
            >
              SQL
            </button>
          </div>

          <button
            type="button"
            onClick={stage}
            disabled={!!error || staging || !typed.name.trim()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Stage
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-3">
        {view === "visual" ? (
          <>
            <FormRow label="Name">
              <input
                type="text"
                placeholder="Role name"
                value={typed.name}
                onChange={(e) => setParams({ ...typed, name: e.target.value })}
                className={inputClass}
              />
            </FormRow>

            <div className="border-b border-border">
              <FormSectionHeader label="Options" />
              <div className="px-4 py-2 grid grid-cols-2 gap-2">
                {OPTIONS.map(({ key, label }) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 text-xs text-text cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={!!action[key]}
                      onChange={(e) =>
                        setParams(patchAction(typed, { [key]: e.target.checked } as Partial<RoleAction>))
                      }
                      className="rounded border-border bg-surface text-accent focus:ring-accent"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <FormRow label="Connection limit">
              <input
                type="number"
                placeholder="-1 for unlimited"
                value={action.connection_limit}
                onChange={(e) =>
                  setParams(
                    patchAction(typed, {
                      connection_limit: e.target.value === "" ? -1 : Number(e.target.value),
                    }),
                  )
                }
                className={inputClass}
              />
            </FormRow>

            <FormRow label="Valid until">
              <input
                type="datetime-local"
                value={action.valid_until}
                onChange={(e) => setParams(patchAction(typed, { valid_until: e.target.value }))}
                className={controlClass}
              />
            </FormRow>

            <FormRow label="Password">
              <input
                type="password"
                placeholder={
                  mode === "edit"
                    ? "leave blank to keep current password"
                    : "Password"
                }
                value={action.password}
                onChange={(e) => setParams(patchAction(typed, { password: e.target.value }))}
                className={inputClass}
              />
            </FormRow>

            <div className="border-b border-border">
              <FormSectionHeader label="Member of" count={action.members.length} />
              {availableRoles.length === 0 && (
                <p className="px-4 py-2 text-xs text-text-muted">No other roles available.</p>
              )}
              <div className="px-4 py-2 space-y-1">
                {availableRoles.map((r) => {
                  const member = action.members.find((m) => m.name === r.name);
                  return (
                    <div key={r.name} className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-text cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!member}
                          onChange={(e) => toggleMember(r.name, e.target.checked)}
                          className="rounded border-border bg-surface text-accent focus:ring-accent"
                        />
                        <span className="font-mono">{r.name}</span>
                      </label>
                      {member && (
                        <label className="flex items-center gap-1 text-xs text-text-muted cursor-pointer">
                          <input
                            type="checkbox"
                            checked={member.admin}
                            onChange={(e) => setMemberAdmin(r.name, e.target.checked)}
                            className="rounded border-border bg-surface text-accent focus:ring-accent"
                          />
                          ADMIN
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <pre className="text-xs leading-6 font-mono whitespace-pre-wrap text-text">{preview}</pre>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}