import { useState } from "react";
import { GeneralTab } from "./GeneralTab";
import { SshSslTab } from "./SshSslTab";
import { TagsEnvTab } from "./TagsEnvTab";
import { ConnectionMetadataRow } from "./ConnectionMetadataRow";
import type { ConnectionFormData } from "./connectionFormData";

export interface DetailedConnectionFormProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
  managedPreset?: "supabase" | "neon" | null;
}

export function DetailedConnectionForm({ form, onChange, managedPreset }: DetailedConnectionFormProps) {
  const [activeTab, setActiveTab] = useState<"general" | "tagsEnv" | "ssh">("general");

  return (
    <div className="space-y-4">
      <ConnectionMetadataRow form={form} onChange={onChange} />
      <div>
        <div className="flex gap-6 border-b border-border mb-4">
          <button type="button" onClick={() => setActiveTab("general")} className={`pb-2 text-sm cursor-pointer transition-colors ${activeTab === "general" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"}`}>General</button>
          <button type="button" onClick={() => setActiveTab("tagsEnv")} className={`pb-2 text-sm cursor-pointer transition-colors ${activeTab === "tagsEnv" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"}`}>Tags & Env</button>
          <button type="button" onClick={() => setActiveTab("ssh")} className={`pb-2 text-sm cursor-pointer transition-colors ${activeTab === "ssh" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"}`}>SSH / SSL</button>
        </div>
        {activeTab === "general" ? (
          <GeneralTab form={form} onChange={onChange} managedPreset={managedPreset} />
        ) : activeTab === "tagsEnv" ? (
          <TagsEnvTab form={form} onChange={onChange} />
        ) : (
          <SshSslTab form={form as unknown as Record<string, unknown>} onChange={onChange as (u: Record<string, unknown>) => void} />
        )}
      </div>
    </div>
  );
}