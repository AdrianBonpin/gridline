/**
 * A settings file's structure — and deliberately nothing more.
 *
 * The store is the only judge of a settings value (ADR 0003): `store::settings_schema`
 * declares one rule per key, refuses a file as a whole, names every offending key, and
 * refuses rather than clamps. The renderer cannot call that table, so the correct shape
 * for this module is to judge **no** value: every range, allowlist, hex pattern or clamp
 * restated here is a second copy of a rule that can drift from the store's — which is
 * exactly what had happened (the page-size bound lived here, in the IPC layer and in the
 * store, and an out-of-range value was clamped here before being imported).
 *
 * What is left is the one property a file has before any value is read: it is an object
 * with a settings object in it. The document is returned untouched, so the store receives
 * the file as written — including keys this build does not know, which the store refuses
 * by name instead of having them filtered out here.
 */
export interface SettingsDocument {
  settings: Record<string, unknown>;
  [key: string]: unknown;
}

export type ValidationOk = { ok: true; document: SettingsDocument };
export type ValidationErr = { ok: false; errors: { field: string; message: string }[] };
export type ValidationResult = ValidationOk | ValidationErr;

export function validateSettingsExport(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ field: "file", message: "not a settings document" }] };
  }
  const settings = (input as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return { ok: false, errors: [{ field: "settings", message: "missing settings object" }] };
  }
  return { ok: true, document: input as SettingsDocument };
}
