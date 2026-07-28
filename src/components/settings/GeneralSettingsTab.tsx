import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { Select } from "../ui/Select";
import { ThemePicker } from "../ui/ThemePicker";
import { SettingsRow } from "../ui/SettingsRow";
import { SettingsSection } from "../ui/SettingsSection";
import * as cmd from "../../lib/commands";
import type { FontSize } from "../../lib/types";

const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const REFRESH_RATE_OPTIONS = [
  { value: "0", label: "Off" },
  { value: "5000", label: "5 seconds" },
  { value: "10000", label: "10 seconds" },
  { value: "30000", label: "30 seconds" },
  { value: "60000", label: "1 minute" },
  { value: "300000", label: "5 minutes" },
];

const PAGE_SIZE_OPTIONS = [
  { value: "50", label: "50 rows" },
  { value: "100", label: "100 rows" },
  { value: "200", label: "200 rows" },
  { value: "500", label: "500 rows" },
];

export function GeneralSettingsTab() {
  const { settings, updateSetting, load } = useSettingsStore();
  const folders = useConnectionStore((s) => s.folders);

  if (!settings) return null;

  const folderOptions = [
    { value: "", label: "None" },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  const handleReAddDemo = async () => {
    try {
      await cmd.recreateDemoDb();
      await load();
    } catch (e) {
      // ignore
    }
  };

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

      <SettingsSection title="Table defaults">
        <SettingsRow
          title="Auto-refresh rate"
          description="How often tables auto-refresh by default."
        >
          <Select
            value={String(settings.table_refresh_rate ?? 0)}
            onChange={(value) => updateSetting("table_refresh_rate", value)}
            options={REFRESH_RATE_OPTIONS}
            label="Auto-refresh rate"
          />
        </SettingsRow>
        <SettingsRow
          title="Rows per page"
          description="Default number of rows shown per page."
        >
          <Select
            value={String(settings.table_page_size ?? 50)}
            onChange={(value) => updateSetting("table_page_size", value)}
            options={PAGE_SIZE_OPTIONS}
            label="Rows per page"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Demo">
        <SettingsRow
          title="Re-add demo database"
          description="Re-create the demo SQLite connection if it was deleted."
        >
          <button
            type="button"
            onClick={handleReAddDemo}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-raised transition-colors"
          >
            Re-add demo
          </button>
        </SettingsRow>
      </SettingsSection>
    </>
  );
}