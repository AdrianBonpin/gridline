import { Input } from "../ui/Input";
import type { ConnectionFormData } from "./connectionFormData";

interface ConnectionMetadataRowProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
}

export function ConnectionMetadataRow({ form, onChange }: ConnectionMetadataRowProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm text-text mb-1.5">Connection Label</label>
      <Input
        value={form.name}
        onChange={(value) => onChange({ name: value })}
        placeholder="My Production Database"
        aria-label="Connection Label"
      />
    </div>
  );
}