import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { Select } from "../ui/Select";
import { ThemePicker } from "../ui/ThemePicker";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSection } from "../ui/SettingsSection";
import type { FontSize } from "../../lib/types";

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

export function GeneralSettingsTab() {
  const { settings, updateSetting } = useSettingsStore();
  const folders = useConnectionStore((s) => s.folders);

  if (!settings) return null;

  const folderOptions = [
    { value: "", label: "None" },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <>
      <SettingsSection title="Appearance">
        <SettingsRow title="Theme" description="Choose your preferred appearance.">
          <ThemePicker
            value={settings.theme}
            onChange={(theme) => updateSetting("theme", theme)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Interface">
        <SettingsRow title="Font size" description="Adjust the application font size.">
          <Select
            value={settings.font_size}
            onChange={(value) => updateSetting("font_size", value)}
            options={FONT_SIZE_OPTIONS}
            label="Font size"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Workspace">
        <SettingsRow
          title="Default folder"
          description="Select the folder to show on startup."
        >
          <Select
            value={settings.default_folder_id ?? ""}
            onChange={(value) => updateSetting("default_folder_id", value)}
            options={folderOptions}
            label="Default folder"
          />
        </SettingsRow>
      </SettingsSection>
    </>
  );
}