import type { Settings } from "./types";

export interface SettingsExport { schemaVersion: number; settings: Settings }
export type ValidationOk = { ok: true; settings: Settings };
export type ValidationErr = { ok: false; errors: { field: string; message: string }[] };
export type ValidationResult = ValidationOk | ValidationErr;

const THEMES = ["dark", "light", "system"];
const FONT_SIZES = ["small", "medium", "large"];
const FONT_FAMILIES = ["Space Mono", "Fira Code", "Menlo", "Monaco", "Consolas", "JetBrains Mono", "monospace"];
const WORD_WRAPS = ["off", "on"];

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

export function validateSettingsExport(input: unknown): ValidationResult {
  const errors: ValidationErr["errors"] = [];
  if (typeof input !== "object" || input === null || !("settings" in input)) {
    return { ok: false, errors: [{ field: "settings", message: "missing settings object" }] };
  }
  const s = (input as { settings: Record<string, unknown> }).settings;
  const out: Record<string, unknown> = {};

  const enumCheck = (field: keyof Settings, allow: readonly string[], val: unknown) => {
    if (typeof val === "string" && allow.includes(val)) out[field] = val;
    else errors.push({ field, message: `invalid ${field}` });
  };
  enumCheck("theme", THEMES, s.theme);
  enumCheck("font_size", FONT_SIZES, s.font_size);
  enumCheck("editor_word_wrap", WORD_WRAPS, s.editor_word_wrap);

  if (typeof s.accent_color === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s.accent_color)) out.accent_color = s.accent_color;
  else errors.push({ field: "accent_color", message: "invalid hex color" });

  if (typeof s.editor_font_size === "number") out.editor_font_size = clamp(Math.trunc(s.editor_font_size), 8, 24);
  else errors.push({ field: "editor_font_size", message: "must be a number" });
  if (typeof s.editor_tab_size === "number") out.editor_tab_size = clamp(Math.trunc(s.editor_tab_size), 2, 8);
  else errors.push({ field: "editor_tab_size", message: "must be a number" });
  enumCheck("editor_font_family", FONT_FAMILIES, s.editor_font_family);
  if (typeof s.editor_minimap === "boolean") out.editor_minimap = s.editor_minimap;
  else errors.push({ field: "editor_minimap", message: "must be boolean" });

  if (typeof s.table_page_size === "number" && s.table_page_size > 0) out.table_page_size = Math.trunc(s.table_page_size);
  else errors.push({ field: "table_page_size", message: "must be positive" });
  if (typeof s.table_refresh_rate === "number" && s.table_refresh_rate >= 0) out.table_refresh_rate = s.table_refresh_rate;
  else errors.push({ field: "table_refresh_rate", message: "must be non-negative" });

  out.confirm_before_delete = typeof s.confirm_before_delete === "boolean" ? s.confirm_before_delete : true;
  out.default_folder_id = typeof s.default_folder_id === "string" || s.default_folder_id === null ? s.default_folder_id : null;
  out.tag_order = typeof s.tag_order === "string" || s.tag_order === null ? s.tag_order : null;
  out.default_ports = s.default_ports && typeof s.default_ports === "object" ? s.default_ports : {};
  out.shortcuts = s.shortcuts && typeof s.shortcuts === "object" ? s.shortcuts : {};

  if (errors.length) return { ok: false, errors };
  return { ok: true, settings: out as unknown as Settings };
}