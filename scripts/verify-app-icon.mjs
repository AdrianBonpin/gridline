#!/usr/bin/env bun
/**
 * Verify that the repo's macOS app icon is not being rendered on a "legacy
 * plate" — the grey/white rounded-square border macOS 26+ draws behind app
 * icons at small sizes (Dock, Spotlight, Vicinae, Raycast, …).
 *
 * Usage:
 *   bun scripts/verify-app-icon.mjs
 *
 * Builds a throwaway .app around desktop/src-tauri/icons/icon.icns, asks AppKit
 * (`NSWorkspace.icon(forFile:)` — the same API launchers use) to render it at a
 * range of sizes, and samples the pixels to detect the plate. Exits non-zero if
 * any size comes out plated.
 *
 * This is the regression check for `fix-icns.mjs`: `tauri icon` re-adds the
 * offending representations every time it runs, so run this (or
 * `scripts/regenerate-icons.sh`, which calls the fix) after touching icons.
 *
 * macOS-only. Requires Swift (Xcode or the Command Line Tools).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICNS = join(REPO_ROOT, "desktop/src-tauri/icons/icon.icns");

if (process.platform !== "darwin") {
  console.log("verify-app-icon: not macOS, nothing to check");
  process.exit(0);
}

if (!existsSync(ICNS)) {
  console.error(`verify-app-icon: missing ${ICNS}`);
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "gridline-icon-check-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

// The synthetic bundle just needs to be a directory with an Info.plist pointing
// at the icon. A unique path + bundle identifier each run keeps IconServices'
// cache from serving a previous run's verdict.
const appDir = join(work, "IconCheck.app");
mkdirSync(join(appDir, "Contents", "Resources"), { recursive: true });
writeFileSync(join(appDir, "Contents", "Resources", "icon.icns"), readFileSync(ICNS));
writeFileSync(
  join(appDir, "Contents", "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.gridline.iconcheck.${process.pid}${Date.now()}</string>
  <key>CFBundleName</key><string>IconCheck</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
</dict>
</plist>
`,
);

// Samples the pixel just inside the icon square at 12% height. A legacy plate
// there is a neutral light grey; the artwork itself is dark at that point.
const SWIFT = `
import AppKit

let appPath = CommandLine.arguments[1]
let sizes = CommandLine.arguments[2].split(separator: ",").compactMap { Int($0) }
let image = NSWorkspace.shared.icon(forFile: appPath)

for px in sizes {
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .calibratedRGB, bytesPerRow: px * 4, bitsPerPixel: 32)!
  let ctx = NSGraphicsContext(bitmapImageRep: rep)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = ctx
  ctx.imageInterpolation = .high
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: px, height: px).fill(using: .copy)
  let natural = image.size
  let scale = min(CGFloat(px) / natural.width, CGFloat(px) / natural.height)
  let w = natural.width * scale
  let h = natural.height * scale
  image.draw(in: NSRect(x: (CGFloat(px) - w) / 2, y: (CGFloat(px) - h) / 2, width: w, height: h),
             from: .zero, operation: .sourceOver, fraction: 1.0, respectFlipped: true, hints: nil)
  NSGraphicsContext.restoreGraphicsState()

  let probe = rep.colorAt(x: px / 2, y: max(1, Int(Double(px) * 0.12)))
  let r = probe?.redComponent ?? 0
  let g = probe?.greenComponent ?? 0
  let b = probe?.blueComponent ?? 0
  let a = probe?.alphaComponent ?? 0
  let v = Int((r * 255).rounded())
  let plated = a > 0.78 && abs(r - g) < 0.04 && abs(g - b) < 0.05 && v > 170 && v < 245
  print("\\(px) \\(plated ? "PLATED" : "OK") v=\\(v)")
}
`;

const swiftFile = join(work, "probe.swift");
writeFileSync(swiftFile, SWIFT);
const sizes = [16, 24, 32, 40, 48, 64, 72, 96, 128, 256, 512];

function runSwift(env) {
  return spawnSync("swift", [swiftFile, appDir, sizes.join(",")], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// `swift` from a full Xcode install refuses to run until its licence is accepted;
// the Command Line Tools toolchain is a drop-in fallback for a plain AppKit program.
let result = runSwift({});
if (result.error || result.status !== 0) {
  const clt = "/Library/Developer/CommandLineTools";
  if (existsSync(join(clt, "usr/bin/swift"))) {
    result = runSwift({ DEVELOPER_DIR: clt });
  }
}

if (result.error || !result.stdout) {
  console.error("verify-app-icon: could not run Swift/AppKit");
  console.error(result.error?.message ?? result.stderr?.trim() ?? "");
  process.exit(1);
}

const lines = result.stdout.trim().split("\n").filter((l) => l.includes("PLATED") || l.includes("OK"));
const plated = lines.filter((l) => l.split(" ")[1] === "PLATED");

console.log("macOS icon render check (NSWorkspace.icon(forFile:))");
for (const line of lines) {
  const [size, verdict] = line.split(" ");
  console.log(`  ${size.padStart(4)}px  ${verdict === "PLATED" ? "PLATED — grey legacy plate" : "ok"}`);
}

if (plated.length > 0) {
  console.error(
    `\nFAIL: ${plated.length}/${lines.length} sizes render on a legacy plate.\n` +
      "The icns still carries the legacy representations (ic12 / is32 / s8mk / il32 / l8mk).\n" +
      "Run: bun scripts/fix-icns.mjs && bun scripts/regenerate-icons.sh",
  );
  process.exit(1);
}

console.log(`\nPASS: clean at every tested size (${sizes.join(", ")}px).`);
