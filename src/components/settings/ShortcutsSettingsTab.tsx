import { useState, useEffect, useRef } from "react";
import { Pencil } from "lucide-react";
import { SettingsSection } from "../ui/SettingsSection";
import { useSettingsStore } from "../../stores/settingsStore";

type ShortcutDef = {
  id: string;
  description: string;
  defaultKeys: string;
  defaultWin: string;
};

const SHORTCUTS: ShortcutDef[] = [
  {
    id: "command_palette",
    description: "Open command palette / search",
    defaultKeys: "⌘K",
    defaultWin: "Ctrl+K",
  },
  {
    id: "close_tab",
    description: "Close current tab (or return home if none)",
    defaultKeys: "⌘W",
    defaultWin: "Ctrl+W",
  },
];

const STATIC_SHORTCUTS = [
  { description: "Close modal, dropdown, or popover", keys: ["Esc"] },
  { description: "Submit / confirm in dialogs", keys: ["↵ Enter"] },
  { description: "Follow foreign-key link on focused cell", keys: ["↵ Enter", "Space"] },
  { description: "Toggle row selection", keys: ["Click"] },
  { description: "Select / deselect all visible rows", keys: ["Header ☐"] },
];

function displayCombo(combo: string): string {
  return combo
    .replace(/meta/gi, "⌘")
    .replace(/ctrl/gi, "⌃")
    .replace(/shift/gi, "⇧")
    .replace(/alt/gi, "⌥")
    .replace(/\+/g, "")
    .replace(/\b(\w)\b/g, (_, c) => c.toUpperCase());
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium text-text-muted font-heading">
      {children}
    </kbd>
  );
}

export function ShortcutsSettingsTab() {
  const settings = useSettingsStore((s) => s.settings);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const customShortcuts = settings?.shortcuts ?? {};
  const [recording, setRecording] = useState<string | null>(null);
  const recordingRef = useRef<string | null>(null);

  // Listen for keypress when recording
  useEffect(() => {
    if (!recording) return;
    recordingRef.current = recording;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const parts: string[] = [];
      if (e.metaKey) parts.push("Meta");
      if (e.ctrlKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      // Ignore modifier-only presses
      if (["Meta", "Control", "Alt", "Shift"].includes(e.key)) return;
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const combo = parts.join("+");

      const action = recordingRef.current;
      if (!action) return;
      const next = { ...customShortcuts, [action]: combo };
      const existing = { ...(settings?.shortcuts ?? {}) };
      updateSetting("shortcuts", JSON.stringify({ ...existing, ...next }));
      setRecording(null);
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [recording, customShortcuts, settings?.shortcuts, updateSetting]);

  const handleStartRecord = (action: string) => {
    setRecording(action);
  };

  const handleReset = (action: string) => {
    const next = { ...customShortcuts };
    delete next[action];
    const existing = { ...(settings?.shortcuts ?? {}) };
    updateSetting("shortcuts", JSON.stringify({ ...existing, ...next, [action]: undefined as any }));
  };

  return (
    <>
      <SettingsSection title="Customizable Shortcuts">
        <p className="text-xs text-text-muted mb-3">
          Click the pencil icon to record a new key combination. Click the shortcut to reset to default.
        </p>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => {
            const custom = customShortcuts[s.id];
            const isRecording = recording === s.id;
            return (
              <div
                key={s.id}
                className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-raised/50 group"
              >
                <span className="text-sm text-text">{s.description}</span>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  {isRecording ? (
                    <Kbd>Listening…</Kbd>
                  ) : custom ? (
                    <button
                      type="button"
                      onClick={() => handleReset(s.id)}
                      className="text-xs text-accent hover:underline"
                      title="Reset to default"
                    >
                      {displayCombo(custom)}
                    </button>
                  ) : (
                    <Kbd>{s.defaultKeys}</Kbd>
                  )}
                  <button
                    type="button"
                    onClick={() => handleStartRecord(s.id)}
                    className={`p-0.5 rounded transition-colors ${
                      isRecording
                        ? "text-accent bg-accent/10"
                        : "text-text-muted hover:text-text opacity-0 group-hover:opacity-100"
                    }`}
                    aria-label={`Record shortcut for ${s.description}`}
                    title="Record new shortcut"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="System Shortcuts">
        <p className="text-xs text-text-muted mb-3">
          These shortcuts are standard across all applications and cannot be changed.
        </p>
        <div className="space-y-2">
          {STATIC_SHORTCUTS.map((s) => (
            <div key={s.description} className="flex items-center justify-between py-1">
              <span className="text-sm text-text">{s.description}</span>
              <div className="flex items-center gap-1 shrink-0 ml-4">
                {s.keys.map((key, i) => (
                  <Kbd key={i}>{key}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </>
  );
}