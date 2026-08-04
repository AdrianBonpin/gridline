import { Input } from "../ui/Input";
import { PasswordInput } from "./PasswordInput";
import { SqlitePathInput } from "./SqlitePathInput";
import { INPUT_ROUNDING } from "../../lib/uiConstants";
import type { ConnectionFormData } from "./connectionFormData";

export interface GeneralTabProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
  managedPreset?: "supabase" | "neon" | null;
}

const AUTH_OPTIONS = ["User & Password"];

export function GeneralTab({ form, onChange, managedPreset }: GeneralTabProps) {
  const isSqlite = form.db_type === "sqlite";
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text mb-1.5">{isSqlite ? "File Path" : "Connection URI"}</label>
        {isSqlite ? (
          <SqlitePathInput value={form.host} onChange={(value) => onChange({ host: value })} />
        ) : (
          <input
            value={form.connection_string}
            onChange={(e) => onChange({ connection_string: e.target.value })}
            placeholder="postgresql://user:password@host:5432/database"
            aria-label="Connection URI"
            className={`w-full ${INPUT_ROUNDING} bg-surface border border-border px-4 py-2 text-sm text-text font-mono placeholder-text-muted/60 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors`}
          />
        )}
        {managedPreset && (
          <p className="text-xs text-accent-muted mt-1.5">
            {managedPreset === "supabase" ? "Supabase" : "NeonDB"} requires SSL — enable it under SSH / SSL.
          </p>
        )}
      </div>

      {!isSqlite && (
        <>
          <div className="flex items-center gap-3 my-1" data-testid="or-divider">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-text-muted">OR</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm text-text mb-1.5">Host</label>
              <Input value={form.host} onChange={(value) => onChange({ host: value })} placeholder="localhost" aria-label="Host" />
            </div>
            <div className="w-28">
              <label className="block text-sm text-text mb-1.5">Port</label>
              <Input type="number" value={form.port?.toString() ?? ""} onChange={(value) => onChange({ port: value === "" ? null : Number(value) })} placeholder="5432" aria-label="Port" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text mb-1.5">Authentication</label>
            <select
              value={AUTH_OPTIONS[0]}
              disabled
              aria-label="Authentication"
              className={`w-full ${INPUT_ROUNDING} bg-surface border border-border px-4 py-2 text-sm text-text opacity-70 cursor-not-allowed`}
            >
              {AUTH_OPTIONS.map((opt) => <option key={opt}>{opt}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-text mb-1.5">User</label>
            <Input value={form.username ?? ""} onChange={(value) => onChange({ username: value || null })} placeholder="postgres" aria-label="User" />
          </div>
          <div>
            <label className="block text-sm text-text mb-1.5">Password</label>
            <PasswordInput value={form.password ?? ""} onChange={(value) => onChange({ password: value || null })} placeholder="••••••••" aria-label="Password" />
          </div>
          <div>
            <label className="block text-sm text-text mb-1.5">Database (optional)</label>
            <Input value={form.database ?? ""} onChange={(value) => onChange({ database: value || null })} placeholder="database" aria-label="Database" />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
        <input type="checkbox" checked={form.use_keychain} onChange={(e) => onChange({ use_keychain: e.target.checked })} aria-label="Enable keychain" className="rounded border-border bg-surface text-accent focus:ring-accent" />
        Enable keychain
      </label>
    </div>
  );
}