const ACCENT_PRESETS = [
  "#2563EB",
  "#3B82F6",
  "#06B6D4",
  "#22C55E",
  "#F59E0B",
  "#EF4444",
  "#EC4899",
  "#D946EF",
  "#8B5CF6",
  "#64748B",
];

interface AccentPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function AccentPicker({ value, onChange }: AccentPickerProps) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Accent color">
      {ACCENT_PRESETS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === color.toLowerCase()}
          aria-label={`Accent ${color}`}
          onClick={() => onChange(color)}
          className={`w-6 h-6 rounded-full border-2 transition-all cursor-pointer ${
            value.toLowerCase() === color.toLowerCase()
              ? "border-text scale-110"
              : "border-transparent hover:border-border-hover"
          }`}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}