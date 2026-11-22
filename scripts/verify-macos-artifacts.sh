#!/usr/bin/env bash
#
# Verify that a macOS release artifact is really Developer-ID signed, notarized
# and stapled BEFORE it is uploaded (ticket 45, "macOS signing fails closed").
#
# `.github/workflows/release.yml` builds each macOS bundle WITHOUT uploading it,
# runs this script, and then uploads exactly the paths it prints — so a failed
# verification cannot be followed by an upload. `scripts/release-mac.sh` (the
# documented local fallback) runs the same script before `gh release upload`.
#
# What it asserts:
#   1. `codesign --verify --deep --strict` accepts the .app, nested helpers and
#      the bundled pg/mariadb tools included.
#   2. The signature is a Developer ID Application signature under the hardened
#      runtime with a secure timestamp — NOT the `signingIdentity "-"` ad-hoc
#      fallback in tauri.conf.json. An ad-hoc build passes `codesign --verify`,
#      which is exactly why this distinguishes them explicitly.
#   3. The .app carries a stapled notarization ticket (`stapler validate`).
#   4. Gatekeeper accepts the .app for execution (`spctl --assess --type
#      execute`).
#   5. The .dmg is notarized (notarytool with the App Store Connect API key),
#      stapled, carries a valid ticket, and is accepted for opening
#      (`spctl --assess --type open --context context:primary-signature`).
#      Notarizing only the .app is not enough: Gatekeeper assesses the
#      downloaded disk image itself and rejects it as "Unnotarized Developer ID".
#
# Retries exist only for the checks that are known to lag Apple's caches
# (`stapler validate` right after stapling, `spctl` right after the ticket
# lands) and for transient notarytool network failures. A retry is a delay, not
# a downgrade: every attempt still has to pass, and running out of attempts
# fails.
#
# Usage:
#   scripts/verify-macos-artifacts.sh [--target TRIPLE] [--bundle DIR] [--conf FILE]
#
#   --target   Rust target triple of the build (default: aarch64-apple-darwin).
#              Chooses the bundle directory below `desktop/src-tauri/target/`
#              and the architecture in the disk-image name.
#   --bundle   Bundle directory to verify (default:
#              <repo>/desktop/src-tauri/target/<target>/release/bundle).
#   --conf     tauri.conf.json to read productName/version from
#              (default: <repo>/desktop/src-tauri/tauri.conf.json).
#
# Prints the verified asset paths (one absolute path per line) on success, so
# the caller uploads exactly what was verified. **stdout carries nothing but
# those paths** — every diagnostic, and every line a tool prints on its own
# stdout, goes to stderr instead (`say` below, and the fd swap it is paired
# with). `xcrun stapler validate` in particular prints `Processing: <path>` on
# stdout; that line was on the asset list in v0.9.0 and the upload step failed
# with "verified asset is gone: Processing: …/Gridline.app".
#
# Environment:
#   APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH
#              Notarization credentials (required when a disk image is present).
#   GRIDLINE_MACOS_VERIFY_ATTEMPTS / GRIDLINE_MACOS_VERIFY_DELAY
#              Retry count (default 5) and delay in seconds (default 20).
#
# Exit status: 0 = every artifact verified, 1 = a check failed, 2 = usage error.

set -uo pipefail

self_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$self_dir/.." && pwd)"

conf="$repo_root/desktop/src-tauri/tauri.conf.json"
target_triple="aarch64-apple-darwin"
bundle=""

attempts="${GRIDLINE_MACOS_VERIFY_ATTEMPTS:-5}"
retry_delay="${GRIDLINE_MACOS_VERIFY_DELAY:-20}"

usage() {
  cat >&2 <<'EOF'
usage: scripts/verify-macos-artifacts.sh [--target TRIPLE] [--bundle DIR] [--conf FILE]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) target_triple="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --target=*) target_triple="${1#*=}"; shift ;;
    --bundle) bundle="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --bundle=*) bundle="${1#*=}"; shift ;;
    --conf) conf="${2:-}"; shift 2 || { usage; exit 2; } ;;
    --conf=*) conf="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'verify-macos-artifacts: unknown argument: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$bundle" ]; then
  bundle="$repo_root/desktop/src-tauri/target/${target_triple}/release/bundle"
fi

die() { printf 'verify-macos-artifacts: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*" >&2; }

# ---- stdout is the asset list, and nothing else ----------------------------
# The callers (.github/workflows/release.yml, scripts/release-mac.sh) treat
# every stdout line as a path they may upload, so a tool that prints progress
# on stdout must not be able to reach it. From here on fd 1 is stderr — any
# command added later, redirected or not, inherits the safe channel — and the
# verified paths are written to the real stdout saved as fd 3.
#
# The v0.9.0 release run proved why: `xcrun stapler validate` writes
# `Processing: /…/Gridline.app` to stdout, both macOS jobs collected it as an
# asset and the upload step reported `verified asset is gone: Processing: …`.
exec 3>&1 1>&2

# ---- tooling ---------------------------------------------------------------
# These ship with macOS; a missing one means this is not a macOS verification
# host (or the PATH is broken), so fail rather than silently skip a check.
for tool in codesign spctl xcrun; do
  command -v "$tool" >/dev/null 2>&1 ||
    die "required tool '${tool}' is not available on PATH"
done
case "$attempts" in
  ''|*[!0-9]*) die "GRIDLINE_MACOS_VERIFY_ATTEMPTS must be a positive integer" ;;
esac
[ "$attempts" -ge 1 ] || die "GRIDLINE_MACOS_VERIFY_ATTEMPTS must be at least 1"

# retry <description> <command...> — every attempt must pass; the last failure
# is the one that counts. The command's stdout goes to stderr: only the asset
# list at the end of this script may reach stdout.
retry() {
  local what="$1"
  shift
  local attempt rc
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    "$@" 1>&2
    rc=$?
    if [ "$rc" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -lt "$attempts" ]; then
      say "  ${what} failed (attempt ${attempt}/${attempts}); retrying in ${retry_delay}s"
      sleep "$retry_delay"
    fi
  done
  say "  ${what} still failing after ${attempts} attempt(s)"
  return 1
}

# ---- resolve what was built ------------------------------------------------
[ -f "$conf" ] || die "tauri config not found: ${conf}"
[ -d "$bundle" ] || die "bundle directory not found: ${bundle} (nothing was built?)"

product="$(sed -n 's/.*"productName"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$conf" | head -n 1)"
version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$conf" | head -n 1)"
[ -n "$product" ] || die "could not read productName from ${conf}"
[ -n "$version" ] || die "could not read version from ${conf}"

case "$target_triple" in
  aarch64-*) asset_arch="aarch64" ;;
  x86_64-*) asset_arch="x64" ;;
  *) die "unexpected macOS target triple: ${target_triple}" ;;
esac

app="${bundle}/macos/${product}.app"
dmg="${bundle}/dmg/${product}_${version}_${asset_arch}.dmg"

say ">> verifying ${app}"
[ -d "$app" ] || die "application bundle not found: ${app}"

# ---- 1. the signature is valid ---------------------------------------------
codesign --verify --deep --strict --verbose=2 "$app" 1>&2 ||
  die "codesign --verify rejected ${app} (broken or missing signature)"

# ---- 2. it is a Developer ID signature, not the ad-hoc fallback -------------
signature_info="$(codesign --display --verbose=4 "$app" 2>&1)"
if ! printf '%s\n' "$signature_info" | grep -q '^Authority=Developer ID Application'; then
  printf '%s\n' "$signature_info" >&2
  die "${app} is not signed with a Developer ID Application identity"
fi
if printf '%s\n' "$signature_info" | grep -q '^Signature=adhoc'; then
  die "${app} is ad-hoc signed (signingIdentity \"-\"), which cannot be notarized"
fi
if ! printf '%s\n' "$signature_info" | grep -q 'flags=.*runtime'; then
  die "${app} is not signed with the hardened runtime"
fi
if ! printf '%s\n' "$signature_info" | grep -q '^Timestamp='; then
  die "${app} has no secure signing timestamp (notarization requires one)"
fi
say "  identity: $(printf '%s\n' "$signature_info" | grep '^Authority=Developer ID Application' | head -n 1)"

# ---- 3./4. the .app carries a ticket and Gatekeeper accepts it -------------
say ">> stapler validate ${app}"
retry "stapler validate ${app}" xcrun stapler validate "$app" ||
  die "${app} has no stapled notarization ticket"

say ">> spctl --assess --type execute ${app}"
retry "spctl --assess --type execute ${app}" \
  spctl --assess --type execute --verbose=4 "$app" ||
  die "Gatekeeper rejected ${app} (not notarized, or signed by an untrusted identity)"

# ---- 5. the disk image is notarized, stapled and accepted -------------------
[ -f "$dmg" ] || die "disk image not found: ${dmg}"

"${self_dir}/require-macos-signing-credentials.sh" \
  APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH >&2 ||
  die "notarization credentials are required to notarize ${dmg}"
[ -f "${APPLE_API_KEY_PATH}" ] ||
  die "notarization API key not found at \$APPLE_API_KEY_PATH"

say ">> notarizing $(basename "$dmg") (this can take a few minutes)"
retry "notarytool submit $(basename "$dmg")" \
  xcrun notarytool submit "$dmg" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --wait ||
  die "notarization of ${dmg} failed"

say ">> stapler staple $(basename "$dmg")"
retry "stapler staple $(basename "$dmg")" xcrun stapler staple "$dmg" ||
  die "could not staple the notarization ticket into ${dmg}"

retry "stapler validate $(basename "$dmg")" xcrun stapler validate "$dmg" ||
  die "${dmg} has no stapled notarization ticket"

say ">> spctl --assess --type open $(basename "$dmg")"
retry "spctl --assess --type open $(basename "$dmg")" \
  spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg" ||
  die "Gatekeeper rejected ${dmg}"

# ---- what the caller may upload -------------------------------------------
# Exactly the artifacts that were verified: the disk image above and, only when
# the build produced one (tauri-action packages the .app for macOS), the
# tarball of that same .app. Written to fd 3 — the real stdout saved at the top
# — so no tool output can join the list.
printf '%s\n' "$dmg" >&3
if [ -f "${bundle}/macos/${product}.app.tar.gz" ]; then
  printf '%s\n' "${bundle}/macos/${product}.app.tar.gz" >&3
fi
say ">> ${app} and $(basename "$dmg") verified as signed, notarized and stapled"
