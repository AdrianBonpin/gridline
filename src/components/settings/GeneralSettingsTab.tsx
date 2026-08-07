import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import { Select } from "../ui/Select";
import { ThemePicker } from "../ui/ThemePicker";
import { AccentPicker } from "../ui/AccentPicker";
import { SettingsRow } from "../ui/SettingsRow";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import * as cmd from "../../lib/commands";
import { validateSettingsExport } from "../../lib/settingsImport";
import type { FontSize } from "../../lib/types";
import { useState } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";

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
  const loadAll = useConnectionStore((s) => s.loadAll);
  const notify = useNotificationStore((s) => s.notify);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  if (!settings) return null;

  const folderOptions = [
    { value: "", label: "None" },
    ...folders.map((f) => ({ value: f.id, label: f.name })),
  ];

  const handleReAddDemo = async () => {
    try {
      const msg = await cmd.recreateDemoDb();
      await load();
      await loadAll();
      notify(msg, "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handleRegenerateDemo = async () => {
    setConfirmRegenerate(false);
    setRegenerating(true);
    try {
      const msg = await cmd.regenerateDemoDb();
      await loadAll();
      notify(msg, "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setRegenerating(false);
    }
  };

  const handleExport = async () => {
    try {
      const json = await cmd.exportSettings();
      const path = await save({
        defaultPath: "gridline-settings.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, json);
      notify("Settings exported", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const handleImport = async () => {
    try {
      const p = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!p || Array.isArray(p)) return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(p);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        notify("Invalid settings: file is not valid JSON", "error");
        return;
      }
      const r = validateSettingsExport(parsed);
      if (!r.ok) {
        notify(
          `Invalid settings: ${r.errors.map((e) => e.field).join(", ")}`,
          "error",
        );
        return;
      }
      await cmd.importSettings(text);
      await load();
      notify("Settings imported", "success");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-medium text-text mb-3">Appearance</h2>
        <div className="flex flex-col gap-4">
          <SettingsRow title="Theme" description="Choose your preferred appearance.">
            <ThemePicker
              value={settings.theme}
              onChange={(theme) => updateSetting("theme", theme)}
            />
          </SettingsRow>
          <SettingsRow title="Font size" description="Adjust the application font size.">
            <Select
              value={settings.font_size}
              onChange={(value) => updateSetting("font_size", value)}
              options={FONT_SIZE_OPTIONS}
              label="Font size"
            />
          </SettingsRow>
          <SettingsRow
            title="Accent color"
            description="Used for buttons, active states, and highlights."
          >
            <AccentPicker
              value={settings.accent_color}
              onChange={(color) => updateSetting("accent_color", color)}
            />
          </SettingsRow>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text mb-3">Workspace</h2>
        <div className="flex flex-col gap-4">
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
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text mb-3">Table defaults</h2>
        <div className="flex flex-col gap-4">
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
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text mb-3">Data</h2>
        <div className="flex flex-col gap-4">
          <SettingsRow
            title="Export settings"
            description="Save your settings to a JSON file."
          >
            <button
              type="button"
              onClick={handleExport}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-raised transition-colors"
            >
              Export settings
            </button>
          </SettingsRow>
          <SettingsRow
            title="Import settings"
            description="Restore settings from a previously exported JSON file."
          >
            <button
              type="button"
              onClick={handleImport}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-raised transition-colors"
            >
              Import settings
            </button>
          </SettingsRow>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-text mb-3">Demo</h2>
        <div className="flex flex-col gap-4">
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
          <SettingsRow
            title="Regenerate demo database"
            description="Reset the demo to its original state. Any edits or changes you made against the demo are lost."
          >
            <button
              type="button"
              onClick={() => setConfirmRegenerate(true)}
              disabled={regenerating}
              className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {regenerating ? "Regenerating…" : "Regenerate demo"}
            </button>
          </SettingsRow>
        </div>
        <ConfirmDialog
          open={confirmRegenerate}
          title="Regenerate demo database?"
          message="This deletes the current demo file and re-seeds it with fresh data. Any edits or changes you made against the demo will be lost."
          confirmLabel="Regenerate"
          onConfirm={handleRegenerateDemo}
          onCancel={() => setConfirmRegenerate(false)}
        />
      </section>
    </div>
  );
}