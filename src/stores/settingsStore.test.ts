import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./settingsStore";
import * as commands from "../lib/commands";

beforeEach(() => {
  useSettingsStore.setState({ settings: null, loading: false, error: null });
  vi.restoreAllMocks();
});

describe("settingsStore", () => {
  it("load fetches settings", async () => {
    const settings = { confirm_before_delete: true, default_folder_id: null, theme: "dark" as const, font_size: "medium" as const, default_ports: { postgresql: 5432, mysql: 3306, redis: 6379, sqlite: null }, tag_order: null, table_refresh_rate: 0, table_page_size: 50, shortcuts: {} };
    vi.spyOn(commands, "getSettings").mockResolvedValue(settings);
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings).toEqual(settings);
  });

  it("updateSetting persists then reloads", async () => {
    vi.spyOn(commands, "updateSetting").mockResolvedValue(undefined);
    const settings = { confirm_before_delete: true, default_folder_id: null, theme: "light" as const, font_size: "medium" as const, default_ports: { postgresql: 5432, mysql: 3306, redis: 6379, sqlite: null }, tag_order: null, table_refresh_rate: 0, table_page_size: 50, shortcuts: {} };
    vi.spyOn(commands, "getSettings").mockResolvedValue(settings);
    await useSettingsStore.getState().updateSetting("theme", "light");
    expect(commands.updateSetting).toHaveBeenCalledWith("theme", "light");
    expect(useSettingsStore.getState().settings?.theme).toBe("light");
  });
});