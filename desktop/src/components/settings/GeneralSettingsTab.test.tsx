import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GeneralSettingsTab } from "./GeneralSettingsTab";
import { useSettingsStore } from "../../stores/settingsStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useNotificationStore } from "../../stores/notificationStore";
import * as commands from "../../lib/commands";

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
  exportSettingsToFile: vi.fn().mockResolvedValue("/tmp/gridline-settings.json"),
  readSettingsFile: vi.fn().mockResolvedValue('{"schemaVersion":1,"settings":{}}'),
  selectFileForGrant: vi.fn(),
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

const grant = (intent: "read" | "write", id = "grant-1") => ({
  id,
  path: "/tmp/gridline-settings.json",
  displayName: "gridline-settings.json",
  intent,
  expiresInSeconds: 300,
});

const mocked = commands as unknown as Record<string, ReturnType<typeof vi.fn>>;

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

  it("exports settings through a File Grant, never a renderer-supplied path", async () => {
    const user = userEvent.setup();
    mocked.selectFileForGrant.mockResolvedValue(grant("write", "grant-export"));

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /export settings/i }));

    await waitFor(() => expect(mocked.exportSettingsToFile).toHaveBeenCalledWith("grant-export"));
    // The dialog is Rust's: the renderer asks for a grant, it never picks a path.
    expect(mocked.selectFileForGrant).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "write" }),
    );
    expect(mocked.selectFileForGrant.mock.calls[0][0]).not.toHaveProperty("path");
    expect(useNotificationStore.getState().notifications).toContainEqual(
      expect.objectContaining({ type: "success", message: expect.stringMatching(/exported/i) })
    );
  });

  it("writes nothing when the export picker is cancelled (no grant)", async () => {
    const user = userEvent.setup();
    mocked.selectFileForGrant.mockResolvedValue(null);

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /export settings/i }));

    await waitFor(() => expect(mocked.selectFileForGrant).toHaveBeenCalled());
    expect(mocked.exportSettingsToFile).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it("imports settings read through a File Grant and shows a success toast", async () => {
    const user = userEvent.setup();
    const importedJson = JSON.stringify({ schemaVersion: 1, settings: baseSettings });
    mocked.selectFileForGrant.mockResolvedValue(grant("read", "grant-import"));
    mocked.readSettingsFile.mockResolvedValue(importedJson);

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    await waitFor(() => {
      expect(mocked.importSettings).toHaveBeenCalledTimes(1);
    });
    // The validated document is what reaches the backend (never a raw file with
    // a value the validator already changed).
    expect(JSON.parse(mocked.importSettings.mock.calls[0][0])).toEqual(
      JSON.parse(importedJson),
    );
    expect(mocked.selectFileForGrant).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "read" }),
    );
    expect(mocked.readSettingsFile).toHaveBeenCalledWith("grant-import");
    expect(useNotificationStore.getState().notifications).toContainEqual(
      expect.objectContaining({ type: "success", message: expect.stringMatching(/imported/i) })
    );
  });

  // The store judges every entry and refuses the file as a whole (`store::settings_schema`,
  // ADR 0003), naming each offending key. The interface must show that refusal with the
  // keys visible and import nothing — there is no "import the valid parts" path.
  const refusal = (keys: string[]) =>
    [
      `invalid settings file: ${keys.length} ${keys.length === 1 ? "entry was" : "entries were"} refused, so nothing was imported`,
      ...keys.map((key) => `- settings key "${key}" value is not valid`),
    ].join("\n");

  it("refuses an out-of-range page size instead of clamping it", async () => {
    // This used to be clamped here and the clamped document imported. The store
    // declares the range, so it - not the renderer - refuses the value.
    const user = userEvent.setup();
    mocked.selectFileForGrant.mockResolvedValue(grant("read", "grant-refused"));
    mocked.readSettingsFile.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        settings: { ...baseSettings, table_page_size: 100000 },
      }),
    );
    mocked.importSettings.mockRejectedValueOnce(refusal(["table_page_size"]));

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    await waitFor(() => expect(mocked.importSettings).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(mocked.importSettings.mock.calls[0][0]);
    expect(sent.settings.table_page_size, "the file must reach the store as written").toBe(100000);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("table_page_size");
    expect(useNotificationStore.getState().notifications).toContainEqual(
      expect.objectContaining({ type: "error", message: expect.stringMatching(/refused/i) }),
    );
    expect(useNotificationStore.getState().notifications.some((n) => n.type === "success")).toBe(false);
    // Nothing was applied, so nothing is reloaded and no success can be shown.
    expect(mocked.getSettings).not.toHaveBeenCalled();
    // No partial-import affordance: one Import button, and no other way forward.
    expect(screen.getAllByRole("button", { name: /import settings/i })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /valid|partial/i })).toBeNull();
  });

  it("shows every offending key the store refused, including one it does not know", async () => {
    const user = userEvent.setup();
    const keys = ["future_setting", "theme"];
    mocked.selectFileForGrant.mockResolvedValue(grant("read", "grant-refusal"));
    mocked.readSettingsFile.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        settings: { ...baseSettings, theme: "purple", future_setting: true },
      }),
    );
    mocked.importSettings.mockRejectedValueOnce(refusal(keys));

    render(<GeneralSettingsTab />);
    await user.click(screen.getByRole("button", { name: /import settings/i }));

    const alert = await screen.findByRole("alert");
    for (const key of keys) expect(alert).toHaveTextContent(key);

    // A key this build does not know must survive to the store: filtering it out
    // here is what let an unknown setting import silently.
    const sent = JSON.parse(mocked.importSettings.mock.calls[0][0]);
    expect(sent.settings).toHaveProperty("future_setting", true);
    expect(useNotificationStore.getState().notifications.some((n) => n.type === "success")).toBe(false);
  });

  it("surfaces an error toast when importing an invalid settings file", async () => {
    const user = userEvent.setup();
    const invalidJson = JSON.stringify({
      schemaVersion: 1,
      settings: { ...baseSettings, theme: "purple" },
    });
    mocked.selectFileForGrant.mockResolvedValue(grant("read", "grant-bad"));
    mocked.readSettingsFile.mockResolvedValue(invalidJson);
    mocked.importSettings.mockRejectedValueOnce(refusal(["theme"]));

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
    mocked.selectFileForGrant.mockResolvedValue(grant("read", "grant-json"));
    mocked.readSettingsFile.mockResolvedValue("not-json");

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