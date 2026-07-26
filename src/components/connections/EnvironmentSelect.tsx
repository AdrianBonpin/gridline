import { ChevronDown } from "lucide-react";

export type Environment = "production" | "staging" | "development" | null;

interface EnvironmentSelectProps {
  value: Environment;
  onChange: (value: Environment) => void;
}

const OPTIONS: { value: Environment; label: string }[] = [
  { value: null, label: "None" },
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
];

export function EnvironmentSelect({ value, onChange }: EnvironmentSelectProps) {
  return (
    <div className="relative">
      <select
        value={value ?? ""}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : (raw as Environment));
        }}
        className="w-full appearance-none rounded-full bg-surface border border-border px-4 py-2 pr-10 text-sm text-text focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors cursor-pointer"
      >
        {OPTIONS.map((opt) => (
          <option key={opt.label} value={opt.value ?? ""}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
    </div>
  );
}