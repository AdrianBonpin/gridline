import { useEffect } from "react";
import { useSettingsStore } from "../stores/settingsStore";

// Default macOS shortcuts (used when no custom binding is set)
const DEFAULTS: Record<string, string> = {
  command_palette: "Meta+k",
  close_tab: "Meta+w",
};

// Normalize key combo from settings (e.g. "Meta+K" → { metaKey: true, key: "k" })
function parseCombo(combo: string): { metaKey: boolean; ctrlKey: boolean; key: string } | null {
  if (!combo) return null;
  const parts = combo.toLowerCase().split("+");
  const metaKey = parts.includes("meta") || parts.includes("cmd");
  const ctrlKey = parts.includes("ctrl");
  // The last part is the key
  const key = parts.filter((p) => !["meta", "cmd", "ctrl", "shift", "alt"].includes(p)).join("+");
  if (!key) return null;
  return { metaKey, ctrlKey, key };
}

export function useShortcut(
  action: string,
  callback: () => void,
) {
  const settings = useSettingsStore((s) => s.settings);

  useEffect(() => {
    // Get the combo from settings or use default
    const raw = settings?.shortcuts?.[action] ?? DEFAULTS[action];
    const combo = parseCombo(raw);
    if (!combo) return;

    const handler = (e: KeyboardEvent) => {
      const metaMatch = combo.metaKey ? (e.metaKey || e.ctrlKey) : e.metaKey === combo.metaKey && e.ctrlKey === combo.ctrlKey;
      if (metaMatch && e.key.toLowerCase() === combo.key) {
        e.preventDefault();
        callback();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [action, callback, settings?.shortcuts]);
}