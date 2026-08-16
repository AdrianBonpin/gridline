/** True only on macOS (the macOS "Overlay" drag strip is gated on this). Uses
 * navigator.platform/userAgent (the established pattern in BackupPage.tsx);
 * @tauri-apps/plugin-os is not installed and getCurrentWindow() has no osLabel(). */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator.platform || "").toLowerCase();
  const u = (navigator.userAgent || "").toLowerCase();
  return p.includes("mac") || u.includes("macintosh") || u.includes("mac os");
}