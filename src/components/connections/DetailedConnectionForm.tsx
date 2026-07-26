import { useState } from "react";
import { Input } from "../ui/Input";
import { PasswordInput } from "./PasswordInput";
import type { ConnectionFormData } from "./connectionFormData";

interface DetailedConnectionFormProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

const AUTH_OPTIONS = ["User & Password"];

export function DetailedConnectionForm({ form, onChange }: DetailedConnectionFormProps) {
  const [activeTab, setActiveTab] = useState<"general" | "ssh">("general");
  const isSqlite = form.db_type === "sqlite";

  return (
    <div>
      <div className="flex gap-6 border-b border-border mb-4">
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          className={`pb-2 text-sm cursor-pointer transition-colors ${
            activeTab === "general" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"
          }`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("ssh")}
          className={`pb-2 text-sm cursor-pointer transition-colors ${
            activeTab === "ssh" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"
          }`}
        >
          SSH / SSL
        </button>
      </div>

      {activeTab === "general" ? (
        <div className="space-y-4">
          {!isSqlite && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm text-text mb-1.5">Host</label>
                <Input
                  value={form.host}
                  onChange={(value) => onChange({ host: value })}
                  placeholder="localhost"
                  aria-label="Host"
                />
              </div>
              <div className="w-28">
                <label className="block text-sm text-text mb-1.5">Port</label>
                <Input
                  type="number"
                  value={form.port?.toString() ?? ""}
                  onChange={(value) => onChange({ port: value === "" ? null : Number(value) })}
                  placeholder="5432"
                  aria-label="Port"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-text mb-1.5">Authentication</label>
            <select
              value={AUTH_OPTIONS[0]}
              disabled
              className="w-full rounded-full bg-surface border border-border px-4 py-2 text-sm text-text opacity-70 cursor-not-allowed"
            >
              {AUTH_OPTIONS.map((opt) => (
                <option key={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">User</label>
            <Input
              value={form.username ?? ""}
              onChange={(value) => onChange({ username: value || null })}
              placeholder="postgres"
              aria-label="User"
            />
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">Password</label>
            <PasswordInput
              value={form.password ?? ""}
              onChange={(value) => onChange({ password: value || null })}
              placeholder="••••••••"
              aria-label="Password"
            />
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">Database (optional)</label>
            <Input
              value={form.database ?? ""}
              onChange={(value) => onChange({ database: value || null })}
              placeholder="database"
              aria-label="Database"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
            <input
              type="checkbox"
              checked={form.use_keychain}
              onChange={(e) => onChange({ use_keychain: e.target.checked })}
              className="rounded border-border bg-surface text-accent focus:ring-accent"
            />
            Enable keychain
          </label>
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-text-muted">
          SSH and SSL settings are coming soon.
        </div>
      )}
    </div>
  );
}