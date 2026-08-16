import { useState } from "react";
import { SshFields } from "./SshFields";
import { SslFields } from "./SslFields";

export interface SshSslTabProps {
  form: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

export function SshSslTab({ form, onChange }: SshSslTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<"ssh" | "ssl">("ssh");

  return (
    <div>
      <div className="flex gap-4 border-b border-border mb-4">
        <button
          type="button"
          onClick={() => setActiveSubTab("ssh")}
          className={`pb-2 text-sm cursor-pointer transition-colors ${
            activeSubTab === "ssh" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"
          }`}
        >
          SSH
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("ssl")}
          className={`pb-2 text-sm cursor-pointer transition-colors ${
            activeSubTab === "ssl" ? "text-text border-b-2 border-text" : "text-text-muted hover:text-text"
          }`}
        >
          SSL
        </button>
      </div>

      {activeSubTab === "ssh" ? <SshFields values={form} onChange={onChange} /> : <SslFields values={form} onChange={onChange} />}
    </div>
  );
}