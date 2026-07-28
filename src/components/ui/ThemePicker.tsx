import type { Theme } from "../../lib/types";

interface ThemePickerProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

const THEMES: { value: Theme; label: string; previewClass: string }[] = [
  { value: "light", label: "Light", previewClass: "bg-zinc-100" },
  { value: "dark", label: "Dark", previewClass: "bg-surface" },
  { value: "system", label: "System", previewClass: "bg-gradient-to-br from-zinc-100 to-surface" },
];

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="flex gap-3" role="radiogroup" aria-label="Theme">
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          role="radio"
          aria-checked={value === theme.value}
          aria-label={theme.label}
          onClick={() => onChange(theme.value)}
          className={`group relative w-20 h-14 rounded-lg border-2 overflow-hidden transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
            value === theme.value
              ? "border-accent"
              : "border-border hover:border-border-hover"
          }`}
        >
          <div className={`absolute inset-0 ${theme.previewClass}`} />
          <div className="absolute top-1 left-1 right-1 h-2 rounded bg-black/10" />
          <div className="absolute bottom-1 left-1 right-2 h-1 rounded bg-black/5" />
          <span className="absolute bottom-1 right-1 text-[9px] font-medium text-text-muted opacity-70 group-hover:opacity-100">
            {theme.label}
          </span>
        </button>
      ))}
    </div>
  );
}