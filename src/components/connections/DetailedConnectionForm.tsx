import { useState } from "react";
import { GeneralTab } from "./GeneralTab";
import { SshSslTab } from "./SshSslTab";
import { TagsEnvTab } from "./TagsEnvTab";
import type { ConnectionFormData } from "./connectionFormData";

export interface DetailedConnectionFormProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function DetailedConnectionForm({ form, onChange }: DetailedConnectionFormProps) {
  const [activeTab, setActiveTab] = useState<"general" | "ssh" | "tags">("general");

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
        <button
          type="button"
          onClick={() => setActiveTab("tags")}
          className={`pb-2 text-sm cursor-pointer transition-colors ${
            activeTab === "tags" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"
          }`}
        >
          Tags & Env
        </button>
      </div>

      {activeTab === "general" ? (
        <GeneralTab form={form} onChange={onChange} />
      ) : activeTab === "ssh" ? (
        <SshSslTab form={form as unknown as Record<string, unknown>} onChange={onChange as (updates: Record<string, unknown>) => void} />
      ) : (
        <TagsEnvTab form={form} onChange={onChange} />
      )}
    </div>
  );
}