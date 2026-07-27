import { useState } from "react";
import { GeneralTab } from "./GeneralTab";
import { SshSslTab } from "./SshSslTab";
import type { ConnectionFormData } from "./connectionFormData";

export interface DetailedConnectionFormProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function DetailedConnectionForm({ form, onChange }: DetailedConnectionFormProps) {
  const [activeTab, setActiveTab] = useState<"general" | "ssh">("general");

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
        <GeneralTab form={form} onChange={onChange} />
      ) : (
        <SshSslTab form={form as unknown as Record<string, unknown>} onChange={onChange as (updates: Record<string, unknown>) => void} />
      )}
    </div>
  );
}