#!/usr/bin/env bash
#
# Regenerate desktop/src-tauri/icons/* from icons/icon.svg.
#
# Usage:
#   scripts/regenerate-icons.sh
#
# `icon.svg` is the source of truth for the app icon; the PNG/ICNS/ICO set next
# to it is generated output and must be regenerated whenever the SVG changes.
#
# Always regenerate through this script rather than calling `tauri icon`
# directly, for two reasons:
#
#   1. `tauri icon` only supports a single output directory for all platforms, so
#      running it in place would also drop generated `android/` and `ios/` icon
#      trees into the (desktop-only) icons directory. This generates into a temp
#      dir and copies back just the desktop set.
#
#   2. `tauri icon` emits the legacy `is32`/`s8mk`/`il32`/`l8mk` and `ic12`
#      representations, which make macOS 26+ draw the app icon on a grey
#      "legacy plate" at small sizes (a white border in the Dock and in any
#      launcher that uses NSWorkspace). fix-icns.mjs strips them — see that file
#      for the details and the measurements.
#
# The committed icon set was last regenerated because those stale rasters meant
# the shipped icon no longer matched icon.svg at all.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/desktop"
ICONS_DIR="$DESKTOP_DIR/src-tauri/icons"
SOURCE_SVG="$ICONS_DIR/icon.svg"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required (https://bun.sh)" >&2
  exit 1
fi

if [ ! -f "$SOURCE_SVG" ]; then
  echo "error: missing icon source $SOURCE_SVG" >&2
  exit 1
fi

# Files `tauri icon` produces for the desktop/Windows/macOS targets. The
# android/ and ios/ output is intentionally ignored.
DESKTOP_ICON_FILES=(
  32x32.png
  64x64.png
  128x128.png
  128x128@2x.png
  icon.png
  icon.icns
  icon.ico
  Square30x30Logo.png
  Square44x44Logo.png
  Square71x71Logo.png
  Square89x89Logo.png
  Square107x107Logo.png
  Square142x142Logo.png
  Square150x150Logo.png
  Square284x284Logo.png
  Square310x310Logo.png
  StoreLogo.png
)

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "==> rendering $SOURCE_SVG with tauri icon"
( cd "$DESKTOP_DIR" && bunx tauri icon "src-tauri/icons/icon.svg" -o "$TMP_DIR" )

for file in "${DESKTOP_ICON_FILES[@]}"; do
  if [ ! -f "$TMP_DIR/$file" ]; then
    echo "error: tauri icon did not produce $file" >&2
    exit 1
  fi
  cp "$TMP_DIR/$file" "$ICONS_DIR/$file"
  echo "    updated icons/$file"
done

echo "==> stripping legacy ICNS representations"
bun "$REPO_ROOT/scripts/fix-icns.mjs" "$ICONS_DIR/icon.icns"

echo
echo "icons regenerated. Verify with:"
echo "  bun $REPO_ROOT/scripts/verify-app-icon.mjs"
