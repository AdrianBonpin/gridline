import type { Theme } from "../../lib/types";

interface ThemePickerProps {
  value: Theme;
  onChange: (theme: Theme) => void;
}

interface PreviewPalette {
  canvas: string;
  surface: string;
  sidebar: string;
  text: string;
  textMuted: string;
  accent: string;
}

// Miniature app-window mock per theme, using the real theme palette hexes.
const PREVIEWS: Record<Theme, PreviewPalette> = {
  light: {
    canvas: "#FAFAFA",
    surface: "#FFFFFF",
    sidebar: "#E4E4E7",
    text: "#18181B",
    textMuted: "#71717A",
    accent: "#2563EB",
  },
  dark: {
    canvas: "#0A0A0B",
    surface: "#18181B",
    sidebar: "#27272A",
    text: "#FAFAFA",
    textMuted: "#A1A1AA",
    accent: "#2563EB",
  },
  // "system" renders the dark palette with a light right half to signal it follows the OS.
  system: {
    canvas: "#0A0A0B",
    surface: "#18181B",
    sidebar: "#27272A",
    text: "#FAFAFA",
    textMuted: "#A1A1AA",
    accent: "#2563EB",
  },
};

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function WindowMock({ preview }: { preview: PreviewPalette }) {
  return (
    <div aria-hidden="true" className="absolute inset-0" style={{ background: preview.canvas }}>
      {/* Top bar strip with traffic-light dots */}
      <div
        className="h-3 flex items-center px-1 gap-0.5"
        style={{
          background: preview.surface,
          borderBottom: "1px solid color-mix(in srgb, currentColor 10%, transparent)",
        }}
      >
        <span className="w-1 h-1 rounded-full" style={{ background: preview.accent }} />
        <span className="w-1 h-1 rounded-full" style={{ background: preview.textMuted }} />
        <span className="w-1 h-1 rounded-full" style={{ background: preview.textMuted }} />
      </div>
      {/* Left sidebar strip */}
      <div className="absolute left-0 top-3 bottom-0 w-2.5" style={{ background: preview.sidebar }} />
      {/* Content lines */}
      <div className="absolute left-4 right-1 top-4 space-y-0.5">
        <div className="h-0.5 rounded" style={{ background: preview.text }} />
        <div className="h-0.5 rounded w-2/3" style={{ background: preview.textMuted }} />
        <div className="h-0.5 rounded w-1/2" style={{ background: preview.textMuted }} />
      </div>
    </div>
  );
}

export function ThemePicker({ value, onChange }: ThemePickerProps) {
  return (
    <div className="flex gap-4" role="radiogroup" aria-label="Theme">
      {THEMES.map((theme) => {
        const preview = PREVIEWS[theme.value];
        return (
          <div key={theme.value} className="flex flex-col items-center gap-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={value === theme.value}
              aria-label={theme.label}
              onClick={() => onChange(theme.value)}
              className={`relative w-[76px] h-[52px] rounded-md border-2 overflow-hidden transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${
                value === theme.value
                  ? "border-accent"
                  : "border-border hover:border-border-hover"
              }`}
            >
              <WindowMock preview={preview} />
              {/* System: overlay a light right half so the preview reads "follows the OS" */}
              {theme.value === "system" && (
                <div
                  aria-hidden="true"
                  className="absolute right-0 top-0 bottom-0 w-1/2 border-l"
                  style={{ background: PREVIEWS.light.canvas, borderColor: PREVIEWS.dark.sidebar }}
                >
                  <div
                    className="h-3 flex items-center px-1 gap-0.5"
                    style={{
                      background: PREVIEWS.light.surface,
                      borderBottom: "1px solid color-mix(in srgb, currentColor 10%, transparent)",
                    }}
                  >
                    <span className="w-1 h-1 rounded-full" style={{ background: PREVIEWS.light.accent }} />
                    <span className="w-1 h-1 rounded-full" style={{ background: PREVIEWS.light.textMuted }} />
                    <span className="w-1 h-1 rounded-full" style={{ background: PREVIEWS.light.textMuted }} />
                  </div>
                </div>
              )}
            </button>
            <span className="text-xs font-medium text-text-muted">
              {theme.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}