import { describe, it, expect } from "vitest";
import { validateSettingsExport } from "./settingsImport";

const good = {
  confirm_before_delete: true, default_folder_id: null, theme: "dark", font_size: "medium",
  default_ports: { postgresql: 5432 }, tag_order: null, table_refresh_rate: 5, table_page_size: 50,
  shortcuts: { open_command_palette: "Cmd+K" }, accent_color: "#2563EB",
  editor_font_size: 14, editor_font_family: "Menlo", editor_word_wrap: "off", editor_minimap: true, editor_tab_size: 2,
};

const doc = (settings: Record<string, unknown>) => ({ schemaVersion: 1, settings });

// The store holds the one validity rule per settings key (`store::settings_schema`,
// ADR 0003) and refuses a file as a whole, naming every offending key. The renderer
// cannot call that table, so this module must judge no value at all: every rule it
// restates here is a rule that can drift from the one the store enforces.
describe("validateSettingsExport", () => {
  it("accepts a settings document and hands it on untouched", () => {
    const input = doc({ ...good });
    const r = validateSettingsExport(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document).toEqual(input);
  });

  it("refuses no value the store might accept: an out-of-range number is passed on", () => {
    const r = validateSettingsExport(doc({ ...good, table_page_size: 100_000, editor_font_size: 999 }));
    expect(r.ok, "the store refuses this, not the renderer").toBe(true);
    if (r.ok) {
      // Neither clamped: the store must see the file as written to refuse it.
      expect(r.document.settings.table_page_size).toBe(100_000);
      expect(r.document.settings.editor_font_size).toBe(999);
    }
  });

  it("refuses no value the store might accept: an unknown enum member is passed on", () => {
    // `theme: "purple"` and a non-positive page size used to be rejected here
    // against copies of the store's list and range.
    expect(validateSettingsExport(doc({ ...good, theme: "purple" })).ok).toBe(true);
    expect(validateSettingsExport(doc({ ...good, table_page_size: -50 })).ok).toBe(true);
  });

  it("keeps a key this build does not know, so the store can refuse it by name", () => {
    const r = validateSettingsExport(doc({ ...good, future_setting: true }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.document.settings).toHaveProperty("future_setting", true);
  });

  it("refuses a file that is not a settings document", () => {
    for (const input of [null, undefined, "settings", 42, [], ["settings"]]) {
      expect(validateSettingsExport(input).ok, String(input)).toBe(false);
    }

    const missing = validateSettingsExport({ schemaVersion: 1 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.some((e) => e.field === "settings")).toBe(true);

    const notAnObject = validateSettingsExport({ schemaVersion: 1, settings: "nope" });
    expect(notAnObject.ok).toBe(false);
  });
});
