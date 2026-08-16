import { open } from "@tauri-apps/plugin-dialog";
import { Input } from "../ui/Input";
import { SelectDropdown } from "../ui/SelectDropdown";
import { useNotificationStore } from "../../stores/notificationStore";

export interface SslFieldsProps {
  values: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

const SSL_MODE_OPTIONS = [
  { value: "disable", label: "Disable" },
  { value: "require", label: "Require" },
  { value: "verify-ca", label: "Verify CA" },
  { value: "verify-full", label: "Verify Full" },
];

export function SslFields({ values, onChange }: SslFieldsProps) {
  const notify = useNotificationStore((s) => s.notify);
  const mode = (values.ssl_mode as string) ?? "disable";
  const showCertFields = mode === "verify-ca" || mode === "verify-full";

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
        <label className="block text-sm text-text mb-1.5">SSL Mode</label>
        <SelectDropdown
          value={mode}
          onChange={(value) => onChange({ ssl_mode: value })}
          options={SSL_MODE_OPTIONS}
          aria-label="SSL Mode"
        />
      </div>

      {mode === "require" && (
        <p className="text-sm text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          Require mode is vulnerable to man-in-the-middle attacks because it does not verify the server certificate.
        </p>
      )}

      {showCertFields && (
        <>
          <div>
            <label className="block text-sm text-text mb-1.5">CA Certificate</label>
            <div className="flex gap-2">
              <Input
                value={(values.ssl_ca_cert as string) ?? ""}
                onChange={(value) => onChange({ ssl_ca_cert: value })}
                placeholder="/path/to/ca-cert.pem"
                aria-label="CA Certificate"
              />
              <button
                type="button"
                onClick={() => handlePickFile("ssl_ca_cert")}
                className="px-4 py-2 rounded-full bg-surface border border-border text-sm text-text hover:bg-surface-raised transition-colors cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">Client Certificate</label>
            <div className="flex gap-2">
              <Input
                value={(values.ssl_client_cert as string) ?? ""}
                onChange={(value) => onChange({ ssl_client_cert: value })}
                placeholder="/path/to/client-cert.pem"
                aria-label="Client Certificate"
              />
              <button
                type="button"
                onClick={() => handlePickFile("ssl_client_cert")}
                className="px-4 py-2 rounded-full bg-surface border border-border text-sm text-text hover:bg-surface-raised transition-colors cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text mb-1.5">Client Key</label>
            <div className="flex gap-2">
              <Input
                value={(values.ssl_client_key as string) ?? ""}
                onChange={(value) => onChange({ ssl_client_key: value })}
                placeholder="/path/to/client-key.pem"
                aria-label="Client Key"
              />
              <button
                type="button"
                onClick={() => handlePickFile("ssl_client_key")}
                className="px-4 py-2 rounded-full bg-surface border border-border text-sm text-text hover:bg-surface-raised transition-colors cursor-pointer"
              >
                Browse
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}