import { SelectDropdown } from "../ui/SelectDropdown";

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
        <SelectDropdown
            value={value ?? ""}
            onChange={(next) =>
                onChange(next === "" ? null : (next as Environment))
            }
            options={OPTIONS.map((opt) => ({
                value: opt.value ?? "",
                label: opt.label,
            }))}
            placeholder="None"
        />
    );
}