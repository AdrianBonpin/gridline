import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../../lib/commands", () => ({
  getSettings: vi.fn().mockResolvedValue({
    theme: "system",
    font_size: "medium",
    default_folder_id: null,
    confirm_before_delete: true,
    default_ports: { postgresql: 5432, mysql: 3306, sqlite: null, redis: 6379 },
    tag_order: null,
    table_refresh_rate: 0,
    table_page_size: 50,
    shortcuts: {},
    accent_color: "#2563EB",
    editor_font_size: 13,
    editor_font_family: "Space Mono",
    editor_word_wrap: "off",
    editor_minimap: false,
    editor_tab_size: 4,
  }),
  updateSetting: vi.fn().mockResolvedValue(undefined),
  exportSettings: vi.fn().mockResolvedValue('{"schemaVersion":1,"settings":{}}'),
  importSettings: vi.fn().mockResolvedValue(undefined),
  recreateDemoDb: vi.fn().mockResolvedValue("Demo re-added"),
  regenerateDemoDb: vi.fn().mockResolvedValue("Demo regenerated"),
}));

const baseSettings = {
  theme: "system" as const,
  font_size: "medium" as const,
  default_folder_id: null,
  confirm_before_delete: true,
  default_ports: { postgresql: 5432, mysql: 3306, sqlite: null as number | null, redis: 6379 },
  tag_order: null,
  table_refresh_rate: 0,
  table_page_size: 50,
  shortcuts: {} as Record<string, string>,
  accent_color: "#2563EB",
  editor_font_size: 13,
  editor_font_family: "Space Mono",
  editor_word_wrap: "off" as const,
  editor_minimap: false,
  editor_tab_size: 4,
};

describe("GeneralSettingsTab settings export/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ settings: baseSettings, loading: false, error: null });
    useConnectionStore.setState({
      connections: [],
      folders: [],
      tags: [],
      tagOrder: [],
      loading: false,
      error: null,
    });
    useNotificationStore.setState({ notifications: [] });
  });

  it("renders Export Settings and Import Settings buttons", () => {
    render(<GeneralSettingsTab />);
    expect(screen.getByRole("button", { name: /export settings/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import settings/i })).toBeInTheDocument();
  });

  it("exports settings to the chosen file and shows a success toast", async () => {
    const user = userEvent.setup();
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const exportedJson = JSON.stringify({ schemaVersion: 1, settings: baseSettings });
    (commands.exportSettings as ReturnType<typeof vi.fn>).mockResolvedValue(exportedJson);
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/gridline-settings.json");
    (writeTextFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /export settings/i }));

    await waitFor(() => {
      expect(writeTextFile).toHaveBeenCalledWith("/tmp/gridline-settings.json", exportedJson);
    });
    expect(useNotificationStore.getState().notifications).toContainEqual(
      expect.objectContaining({ type: "success", message: expect.stringMatching(/exported/i) })
    );
  });

  it("imports settings from the chosen file, reloads settings, and shows a success toast", async () => {
    const user = userEvent.setup();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const importedJson = JSON.stringify({ schemaVersion: 1, settings: baseSettings });
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/gridline-settings.json");
    (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValue(importedJson);

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    await waitFor(() => {
      expect(commands.importSettings).toHaveBeenCalledWith(importedJson);
    });
    expect(useNotificationStore.getState().notifications).toContainEqual(
      expect.objectContaining({ type: "success", message: expect.stringMatching(/imported/i) })
    );
  });

  it("surfaces an error toast when importing an invalid settings file", async () => {
    const user = userEvent.setup();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      settings: { ...baseSettings, theme: "purple" },
    });
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/bad.json");
    (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValue(invalidJson);

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications).toContainEqual(
        expect.objectContaining({
          type: "error",
          message: expect.stringMatching(/invalid settings/i),
        })
      );
    });
  });

  it("surfaces an error toast when importing malformed JSON", async () => {
    const user = userEvent.setup();
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/bad.json");
    (readTextFile as ReturnType<typeof vi.fn>).mockResolvedValue("not-json");

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    await waitFor(() => {
      expect(useNotificationStore.getState().notifications).toContainEqual(
        expect.objectContaining({
          type: "error",
          message: expect.stringMatching(/invalid settings/i),
        })
      );
    });
  });
});