import { DEFAULT_EXPECTED_WINDOW, DEFAULT_SIZE_TOLERANCE } from "./appimageAnalysis.mjs";

/**
 * X11 window discovery/geometry helpers for the AppImage smoke.
 *
 * The packaged lane has no WebDriver (the AppImage is not a WebDriver target),
 * so the window is found and measured through the same X tools a user's session
 * exposes: `xdotool search` (by title) and `xwininfo` (map state + geometry).
 * All parsing is pure so it can be unit tested against recorded output.
 */

/** Parse `xdotool search --onlyvisible --name <title>` output (one id per line). */
export function parseXdotoolSearchIds(stdout) {
  const text = String(stdout ?? "");
  const ids = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const value = Number(trimmed);
    if (Number.isInteger(value) && value > 0 && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

/** Parse `xdotool getwindowgeometry --shell <id>` output into numbers. */
export function parseXdotoolGeometry(stdout) {
  const geometry = {};
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(-?\d+)\s*$/.exec(line.trim());
    if (!match) continue;
    geometry[match[1].toLowerCase()] = Number(match[2]);
  }
  return {
    id: geometry.window ?? null,
    x: geometry.x ?? null,
    y: geometry.y ?? null,
    width: geometry.width ?? null,
    height: geometry.height ?? null,
    screen: geometry.screen ?? null,
  };
}

/**
 * Parse `xwininfo -id <id>` output into a window record.
 *
 * Real `xwininfo` starts its report with a blank line, so the header is matched
 * anywhere in the output rather than being assumed to be line 1. A record is
 * only usable when a map state and a size were found: a window that xdotool
 * lists but xwininfo cannot measure has not been created/painted yet.
 */
export function parseXwininfo(stdout) {
  const text = String(stdout ?? "");
  const headerMatch = /xwininfo:\s*Window id:\s*(0x[0-9a-fA-F]+|\d+)(?:\s+"([^"]*)")?/.exec(text);
  const widthMatch = /^\s*Width:\s*(\d+)\s*$/m.exec(text);
  const heightMatch = /^\s*Height:\s*(\d+)\s*$/m.exec(text);
  const mapStateMatch = /^\s*Map State:\s*([A-Za-z]+)\s*$/m.exec(text);
  const xMatch = /^\s*Absolute upper-left X:\s*(-?\d+)\s*$/m.exec(text);
  const yMatch = /^\s*Absolute upper-left Y:\s*(-?\d+)\s*$/m.exec(text);

  if (!mapStateMatch || !widthMatch || !heightMatch) return null;

  const rawId = headerMatch?.[1] ?? null;
  const id = rawId === null ? null : /^0x/i.test(rawId) ? Number.parseInt(rawId, 16) : Number(rawId);
  const mapState = mapStateMatch[1];

  return {
    id,
    // `xwininfo` prints `(has no name)` for an unnamed window; keep it empty
    // rather than copying that marker into the name.
    name: headerMatch?.[2] ?? "",
    mapState,
    // IsViewable is the state a window the user can actually see reports; an
    // IsUnmapped/IsUnviewable window exists but never became visible.
    mapped: /^IsViewable$/i.test(mapState),
    width: Number(widthMatch[1]),
    height: Number(heightMatch[1]),
    x: xMatch ? Number(xMatch[1]) : null,
    y: yMatch ? Number(yMatch[1]) : null,
  };
}

/**
 * Pick the application window out of everything the display reports.
 *
 * Preference order: a mapped window at the expected size, then any other
 * mapped window (largest first, which is the top-level window rather than a
 * popover/menu), then an unmapped candidate so the caller can report *why* it
 * failed instead of "no window".
 */
export function selectWindow(
  candidates,
  {
    expectedWidth = DEFAULT_EXPECTED_WINDOW.width,
    expectedHeight = DEFAULT_EXPECTED_WINDOW.height,
    tolerance = DEFAULT_SIZE_TOLERANCE,
  } = {},
) {
  const windows = (candidates ?? []).filter(Boolean);
  if (windows.length === 0) return null;

  const sizedWindow = windows.find(
    (window) =>
      window.mapped &&
      Math.abs(window.width - expectedWidth) <= tolerance &&
      Math.abs(window.height - expectedHeight) <= tolerance,
  );
  if (sizedWindow) return sizedWindow;

  const mapped = windows.filter((window) => window.mapped);
  if (mapped.length > 0) {
    return mapped.sort((left, right) => right.width * right.height - left.width * left.height)[0];
  }

  return windows.sort((left, right) => right.width * right.height - left.width * left.height)[0];
}

/** Assert the mapped window is at the configured size (± tolerance). */
export function judgeWindowSize(
  window,
  {
    expectedWidth = DEFAULT_EXPECTED_WINDOW.width,
    expectedHeight = DEFAULT_EXPECTED_WINDOW.height,
    tolerance = DEFAULT_SIZE_TOLERANCE,
  } = {},
) {
  const reasons = [];
  if (!window) {
    reasons.push("no window was measured, so no size could be checked");
    return { ok: false, reasons };
  }
  if (!window.mapped) {
    reasons.push(`window ${window.id} is not mapped, so its size proves nothing`);
  }
  const dWidth = window.width - expectedWidth;
  const dHeight = window.height - expectedHeight;
  if (Math.abs(dWidth) > tolerance) {
    reasons.push(
      `width is ${window.width}px, expected ${expectedWidth}px (±${tolerance}px, off by ${dWidth})`,
    );
  }
  if (Math.abs(dHeight) > tolerance) {
    reasons.push(
      `height is ${window.height}px, expected ${expectedHeight}px (±${tolerance}px, off by ${dHeight})`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}

/** One-line evidence about the window that was found. */
export function describeWindow(window) {
  if (!window) return "no window";
  return `window ${window.id} "${window.name}" ${window.width}x${window.height} at ` +
    `${window.x ?? "?"},${window.y ?? "?"} (${window.mapState})`;
}
