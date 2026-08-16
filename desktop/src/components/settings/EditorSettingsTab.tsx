import { useSettingsStore } from "../../stores/settingsStore";
import { Select } from "../ui/Select";
import { SettingsRow } from "../ui/SettingsRow";
import { Toggle } from "../ui/Toggle";

const FONT_FAMILY_OPTIONS = [
  { value: "Space Mono", label: "Space Mono" },
  { value: "Fira Code", label: "Fira Code" },
  { value: "Menlo", label: "Menlo" },
  { value: "Monaco", label: "Monaco" },
  { value: "Consolas", label: "Consolas" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "monospace", label: "monospace" },
];
const FONT_SIZE_OPTIONS = [8,10,11,12,13,14,16,18,20,24].map((v) => ({ value: String(v), label: String(v) }));
const TAB_SIZE_OPTIONS = [2,4,6,8].map((v) => ({ value: String(v), label: String(v) }));
const WORD_WRAP_OPTIONS = [{ value: "off", label: "Off" }, { value: "on", label: "On" }];

export function EditorSettingsTab() {
  const { settings, updateSetting } = useSettingsStore();
  if (!settings) return null;

  const set = (key: string) => (value: string) => { void updateSetting(key, value); };

  return (
    <section className="space-y-4">
      <SettingsRow title="Font size" description="Editor font size in pixels">
        <Select label="Font size" value={String(settings.editor_font_size)} onChange={set("editor_font_size")} options={FONT_SIZE_OPTIONS} />
      </SettingsRow>
      <SettingsRow title="Font family" description="Monospace font for the SQL editor">
        <Select label="Font family" value={settings.editor_font_family} onChange={set("editor_font_family")} options={FONT_FAMILY_OPTIONS} />
      </SettingsRow>
      <SettingsRow title="Word wrap" description="Wrap long lines in the editor">
        <Select label="Word wrap" value={settings.editor_word_wrap} onChange={set("editor_word_wrap")} options={WORD_WRAP_OPTIONS} />
      </SettingsRow>
      <SettingsRow title="Minimap" description="Show the code minimap">
        <Toggle label="Minimap" checked={settings.editor_minimap} onChange={(c) => void updateSetting("editor_minimap", c ? "true" : "false")} />
      </SettingsRow>
      <SettingsRow title="Tab size" description="Spaces per indentation level">
        <Select label="Tab size" value={String(settings.editor_tab_size)} onChange={set("editor_tab_size")} options={TAB_SIZE_OPTIONS} />
      </SettingsRow>
    </section>
  );
}