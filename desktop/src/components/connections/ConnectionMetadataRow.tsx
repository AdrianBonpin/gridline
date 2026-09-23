import { Input } from "../ui/Input";
import type { ConnectionFormData } from "./connectionFormData";

interface ConnectionMetadataRowProps {
  form: ConnectionFormData;
  onChange: (updates: Partial<ConnectionFormData>) => void;
  /** Shown when the label is empty — usually the name derived from a pasted
   *  connection string, which Test/Save uses as a fallback. */
  namePlaceholder?: string;
}

export function ConnectionMetadataRow({ form, onChange, namePlaceholder }: ConnectionMetadataRowProps) {
  return (
    <div className="space-y-3">
      <label className="block text-sm text-text mb-1.5">Connection Label</label>
      <Input
        value={form.name}
        onChange={(value) => onChange({ name: value })}
        placeholder={namePlaceholder || "My Production Database"}
        aria-label="Connection Label"
      />
    </div>
  );
}