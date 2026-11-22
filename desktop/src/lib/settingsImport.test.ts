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

  // The backend rejects a page size outside 1..=500 (`commands/db_viewer.rs`),
  // so an imported value it would reject must never reach the settings store:
  // the grid would ask for a window every browse fails to satisfy.
  it("clamps table_page_size into the range the backend accepts", () => {
    for (const [given, expected] of [
      [100_000, 500],
      [501, 500],
      [500, 500],
      [50, 50],
      [1, 1],
    ] as const) {
      const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, table_page_size: given } });
      expect(r.ok, `page size ${given} must import`).toBe(true);
      if (r.ok) expect(r.settings.table_page_size).toBe(expected);
    }
  });

  it("still rejects a non-positive table_page_size", () => {
    for (const bad of [0, -50]) {
      const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, table_page_size: bad } });
      expect(r.ok, `page size ${bad} must be refused`).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.field === "table_page_size")).toBe(true);
    }
  });

  it("requires a non-negative table_refresh_rate", () => {
    const r = validateSettingsExport({ schemaVersion: 1, settings: { ...good, table_refresh_rate: -1 } });
    expect(r.ok).toBe(false);
  });
});