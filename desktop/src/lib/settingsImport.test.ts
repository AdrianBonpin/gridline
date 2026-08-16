import { describe, it, expect } from "vitest";
import { validateSettingsExport } from "./settingsImport";
import type { Settings } from "./types";

const good: Settings = {
  confirm_before_delete: true, default_folder_id: null, theme: "dark", font_size: "medium",
  default_ports: { postgresql: 5432 }, tag_order: null, table_refresh_rate: 5, table_page_size: 50,
  shortcuts: { open_command_palette: "Cmd+K" }, accent_color: "#2563EB",
  editor_font_size: 14, editor_font_family: "Menlo", editor_word_wrap: "off", editor_minimap: true, editor_tab_size: 2,
};

describe("validateSettingsExport", () => {
  it("accepts a well-formed object", () => {
    const r = validateSettingsExport({ schemaVersion: 1, settings: good });
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid theme", () => {
    const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, theme: "purple" as never } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "theme")).toBe(true);
  });

  it("clamps editor_font_size to [8,24]", () => {
    const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, editor_font_size: 999 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.settings.editor_font_size).toBe(24);
  });

  it("tolerates unknown keys (version skew)", () => {
    const r = validateSettingsExport({ schemaVersion: 99, settings: { ...good, futureField: true } } as never);
    expect(r.ok).toBe(true);
  });

  it("requires a non-negative table_refresh_rate", () => {
    const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, table_refresh_rate: -1 } });
    expect(r.ok).toBe(false);
  });
});