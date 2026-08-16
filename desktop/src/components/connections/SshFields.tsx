import { open } from "@tauri-apps/plugin-dialog";
import { Input } from "../ui/Input";
import { PasswordInput } from "./PasswordInput";
import { SelectDropdown } from "../ui/SelectDropdown";
import { useNotificationStore } from "../../stores/notificationStore";

export interface SshFieldsProps {
  values: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

const AUTH_METHOD_OPTIONS = [
  { value: "password", label: "Password" },
  { value: "key", label: "Private Key" },
];

export function SshFields({ values, onChange }: SshFieldsProps) {
  const notify = useNotificationStore((s) => s.notify);
  const authMethod = (values.ssh_auth_method as string) ?? "password";

  const handlePickFile = async (field: string) => {
    try {
      const path = await open({ multiple: false, directory: false });
      if (path) {
        onChange({ [field]: path });
      }
    } catch {
      notify("File picker not available", "error");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text mb-1.5">SSH Host</label>
        <Input
          value={(values.ssh_host as string) ?? ""}
          onChange={(value) => onChange({ ssh_host: value })}
          placeholder="bastion.example.com"
          aria-label="SSH Host"
        />
      </div>

      <div>
        <label className="block text-sm text-text mb-1.5">SSH Port</label>
        <Input
          type="number"
          value={(values.ssh_port as number)?.toString() ?? "22"}
          onChange={(value) => onChange({ ssh_port: value === "" ? null : Number(value) })}
          placeholder="22"
          aria-label="SSH Port"
        />
      </div>

      <div>
        <label className="block text-sm text-text mb-1.5">SSH User</label>
        <Input
          value={(values.ssh_user as string) ?? ""}
          onChange={(value) => onChange({ ssh_user: value })}
          placeholder="ssh-user"
          aria-label="SSH User"
        />
      </div>

      <div>
        <label className="block text-sm text-text mb-1.5">Auth Method</label>
        <SelectDropdown
          value={authMethod}
          onChange={(value) => onChange({ ssh_auth_method: value })}
          options={AUTH_METHOD_OPTIONS}
          aria-label="Auth Method"
        />
      </div>

      {authMethod === "key" ? (
        <>
          <div>
            <label className="block text-sm text-text mb-1.5">Private Key</label>
            <div className="flex gap-2">
              <Input
                value={(values.ssh_private_key as string) ?? ""}
                onChange={(value) => onChange({ ssh_private_key: value })}
                placeholder="/path/to/key"
                aria-label="Private Key"
              />
              <button
                type="button"
                onClick={() => handlePickFile("ssh_private_key")}
                className="px-4 py-2 rounded-full bg-surface border border-border text-sm text-text hover:bg-surface-raised transition-colors cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">Passphrase</label>
            <PasswordInput
              value={(values.ssh_passphrase as string) ?? ""}
              onChange={(value) => onChange({ ssh_passphrase: value })}
              placeholder="••••••••"
              aria-label="Passphrase"
            />
          </div>
        </>
      ) : (
        <div>
          <label className="block text-sm text-text mb-1.5">SSH Password</label>
          <PasswordInput
            value={(values.ssh_password as string) ?? ""}
            onChange={(value) => onChange({ ssh_password: value })}
            placeholder="••••••••"
            aria-label="SSH Password"
          />
        </div>
      )}
    </div>
  );
}