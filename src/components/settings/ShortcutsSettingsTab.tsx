import { SettingsSection } from "../ui/SettingsSection";

const SHORTCUTS = [
  {
    category: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], windows: ["Ctrl", "K"], description: "Open command palette / search" },
      { keys: ["⌘", "W"], windows: ["Ctrl", "W"], description: "Close current tab (or return home if none)" },
    ],
  },
  {
    category: "Modal & Dialogs",
    shortcuts: [
      { keys: ["Esc"], windows: ["Esc"], description: "Close modal, dropdown, or popover" },
      { keys: ["↵ Enter"], windows: ["↵ Enter"], description: "Submit / confirm in dialogs" },
    ],
  },
  {
    category: "Data Grid",
    shortcuts: [
      { keys: ["↵ Enter"], windows: ["↵ Enter"], description: "Follow foreign-key link on focused cell" },
      { keys: ["Space"], windows: ["Space"], description: "Follow foreign-key link on focused cell" },
    ],
  },
  {
    category: "Selection",
    shortcuts: [
      { keys: ["Click"], windows: ["Click"], description: "Toggle row selection" },
      { keys: ["Header ☐"], windows: ["Header ☐"], description: "Select / deselect all visible rows" },
    ],
  },
] as const;

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium text-text-muted font-heading">
      {children}
    </kbd>
  );
}

export function ShortcutsSettingsTab() {
  return (
    <>
      {SHORTCUTS.map((group) => (
        <SettingsSection key={group.category} title={group.category}>
          <div className="space-y-2">
            {group.shortcuts.map((shortcut) => (
              <div
                key={shortcut.description}
                className="flex items-center justify-between py-1"
              >
                <span className="text-sm text-text">{shortcut.description}</span>
                <div className="flex items-center gap-1 shrink-0 ml-4">
                  {shortcut.keys.map((key, i) => (
                    <Kbd key={i}>{key}</Kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      ))}
    </>
  );
}