import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { shortcutIsSuppressed } from "../lib/shortcutGuard";

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

/**
 * Bind one configurable action to its keyboard shortcut.
 *
 * Two things this hook guarantees (ticket 39):
 *
 * - **One listener per combo.** The window listener is installed from the combo
 *   alone, and the callback is read through a ref, so a parent re-render (which
 *   always mints a fresh inline callback) never re-binds — and can never leak a
 *   second listener that would fire the action twice.
 * - **No firing where it is unsafe.** Typing in a text field, or having a modal
 *   open, suppresses the shortcut entirely (see `lib/shortcutGuard.ts`).
 */
export function useShortcut(
  action: string,
  callback: () => void,
) {
  const settings = useSettingsStore((s) => s.settings);
  const raw = settings?.shortcuts?.[action] ?? DEFAULTS[action];

  // Always call the current callback without making it a listener dependency.
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    const combo = parseCombo(raw);
    if (!combo) return;

    const handler = (e: KeyboardEvent) => {
      if (shortcutIsSuppressed(e)) return;
      const metaMatch = combo.metaKey ? (e.metaKey || e.ctrlKey) : e.metaKey === combo.metaKey && e.ctrlKey === combo.ctrlKey;
      if (metaMatch && e.key.toLowerCase() === combo.key) {
        e.preventDefault();
        callbackRef.current();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [raw]);
}
