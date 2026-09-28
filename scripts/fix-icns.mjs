#!/usr/bin/env bun
/**
 * Strip the icon representations that make macOS render Gridline's icon on a
 * "legacy plate" at small sizes.
 *
 * ## Why this exists
 *
 * On macOS 26+ (Tahoe) IconServices wraps *legacy* app icons in a light
 * rounded-square plate for render sizes below ~72px. `tauri icon` emits exactly
 * those legacy representations, so the artifact shows up in the Dock and in any
 * launcher that resolves app icons through `NSWorkspace.icon(forFile:)`
 * (Spotlight, Vicinae, Raycast, …): the app icon gets a white/grey border.
 *
 * Two representations in `tauri icon` output trigger it, independently:
 *
 *   - `ic12`  (64x64)               -> plates the 40-64px range
 *   - `is32` / `s8mk` (16x16 RGB+mask)
 *     `il32` / `l8mk` (32x32 RGB+mask) -> plates the 16-32px range
 *
 * Dropping them leaves a perfectly valid family (ic07/ic08/ic09/ic10/ic11/ic13/
 * ic14 — 32, 128, 256, 512 and 1024px), and macOS then renders cleanly at every
 * size from 16px to 1024px. There is no visible quality cost: every small size
 * is resampled from the 128px+ reps with high-quality interpolation.
 *
 * Note `tauri icon` re-emits all of these chunks on every run, which is why this
 * post-processing step is committed rather than done once by hand. Always
 * regenerate through `scripts/regenerate-icons.sh`, never with bare
 * `tauri icon`.
 *
 * ## Usage
 *
 *   bun scripts/fix-icns.mjs [icns-path] [--keep-ic12]
 *
 * Defaults to desktop/src-tauri/icons/icon.icns. Edits the file in place and
 * prints a before/after chunk summary.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ICNS = "desktop/src-tauri/icons/icon.icns";

// 16x16 / 32x32 RGB + 8-bit mask pairs. These predate macOS 10.7's PNG chunks
// and are what IconServices uses for the smallest sizes.
const LEGACY_CHUNKS = ["is32", "s8mk", "il32", "l8mk"];

// 32x32@2x = 64x64. Legitimate modern chunk, but with legacy (padded) artwork
// macOS plates it across the 40-64px range.
const IC12 = "ic12";

const args = process.argv.slice(2);
const keepIc12 = args.includes("--keep-ic12");
const pathArg = args.find((a) => !a.startsWith("-"));

const unknown = args.filter((a) => a.startsWith("-") && a !== "--keep-ic12");
if (unknown.length > 0) {
  console.error(`fix-icns: unknown option(s): ${unknown.join(", ")}`);
  console.error("usage: bun scripts/fix-icns.mjs [icns-path] [--keep-ic12]");
  process.exit(2);
}

const target = resolve(REPO_ROOT, pathArg ?? DEFAULT_ICNS);

/** Read an .icns container into its ordered chunks. */
function readIcns(buf) {
  if (buf.length < 8 || buf.toString("latin1", 0, 4) !== "icns") {
    throw new Error(`not an .icns file: ${target}`);
  }
  const declared = buf.readUInt32BE(4);
  if (declared !== buf.length) {
    throw new Error(
      `truncated/oversized .icns: header says ${declared} bytes, file is ${buf.length}`,
    );
  }
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buf.length) {
    const type = buf.toString("latin1", offset, offset + 4);
    const size = buf.readUInt32BE(offset + 4);
    if (size < 8 || offset + size > buf.length) {
      throw new Error(
        `corrupt .icns: chunk "${type}" at offset ${offset} declares ${size} bytes`,
      );
    }
    chunks.push({ type, bytes: buf.subarray(offset, offset + size) });
    offset += size;
  }
  return chunks;
}

function writeIcns(chunks) {
  const body = Buffer.concat(chunks.map((c) => c.bytes));
  const header = Buffer.alloc(8);
  header.write("icns", 0, "latin1");
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

const drop = new Set(LEGACY_CHUNKS);
if (!keepIc12) drop.add(IC12);

let original;
try {
  original = readFileSync(target);
} catch (err) {
  console.error(`fix-icns: cannot read ${target}: ${err.message}`);
  process.exit(1);
}

let chunks;
try {
  chunks = readIcns(original);
} catch (err) {
  console.error(`fix-icns: ${err.message}`);
  process.exit(1);
}

const before = chunks.map((c) => c.type);
const kept = chunks.filter((c) => !drop.has(c.type));
const removed = before.filter((t) => drop.has(t));

if (removed.length === 0) {
  console.log(`fix-icns: ${target} is already clean (no ${[...drop].join("/")} chunks)`);
  process.exit(0);
}

if (kept.length === 0) {
  console.error("fix-icns: refusing to write an icon family with no chunks left");
  process.exit(1);
}

const out = writeIcns(kept);
// Write to a sibling temp file then rename, so an interrupted run can't leave a
// half-written icon in the tree.
const tmp = `${target}.tmp`;
writeFileSync(tmp, out);
renameSync(tmp, target);

console.log(`fix-icns: ${target}`);
console.log(`  removed: ${removed.join(", ")}`);
console.log(`  chunks:  ${kept.map((c) => c.type).join(", ")}`);
console.log(`  ${original.length} -> ${out.length} bytes`);
