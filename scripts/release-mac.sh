#!/usr/bin/env bash
#
# LOCAL FALLBACK: build Gridline for macOS on this machine and upload the signed
# + notarized DMGs to the GitHub release for a given tag.
#
# macOS is normally built, Developer-ID signed and notarized by GitHub Actions
# (.github/workflows/release.yml) using the APPLE_* repository secrets, together
# with the Windows and Linux installers. Reach for this script when you want a
# signed build without spending CI minutes, or when Actions is unavailable.
#
# Usage:
#   TAG=v0.8.1 ./scripts/release-mac.sh
#
# The release is keyed by tag: the Actions job creates the draft on a tag push,
# and this script finds it (creating it only if it somehow doesn't exist) and
# attaches/replaces the two DMGs — Gridline_<ver>_aarch64.dmg and
# Gridline_<ver>_x64.dmg. Uploads use --clobber, so a locally signed DMG
# supersedes the CI one; publish the draft afterwards on GitHub.
#
# Auth: the `gh` CLI (GitHub is the only release target; the Gitea mirror is
# code-only).

set -euo pipefail

# ---- config ---------------------------------------------------------------
GH_REPO="${GH_REPO:-AdrianBonpin/gridline}"
TAG="${TAG:-${1:-}}"

if [ -z "$TAG" ]; then
  echo "usage: TAG=vX.Y.Z ./scripts/release-mac.sh" >&2
  exit 1
fi

# ---- resolve auth (gh CLI) -------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found (needed to upload release assets)" >&2
  echo "  install it: https://cli.github.com" >&2
  exit 1
fi

# ---- macOS signing + notarization -----------------------------------------
# Requires a "Developer ID Application" certificate in the login keychain and
# an App Store Connect API key for notarization. See the README's "macOS
# signing" section for how to create both.
#
# Notarization credentials are read from ~/.config/gridline/notarize.env
# (never committed). Create it with:
#   APPLE_API_KEY=<Key ID>
#   APPLE_API_ISSUER=<Issuer ID>
#   APPLE_API_KEY_PATH=/absolute/path/to/AuthKey_<KeyID>.p8
# (or drop the .p8 at ~/.appstoreconnect/private_keys/AuthKey_<KeyID>.p8 and
# omit APPLE_API_KEY_PATH — tauri auto-searches that location.)

# 1. Resolve the Developer ID Application signing identity from the keychain.
SIGNING_IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -i 'Developer ID Application' \
  | sed -E 's/.*"([^"]+)".*/\1/' \
  | head -1 || true)"
if [ -z "$SIGNING_IDENTITY" ]; then
  echo "ERROR: No 'Developer ID Application' certificate found in the login keychain." >&2
  echo "  Create one at https://developer.apple.com/account/resources/certificates/list" >&2
  echo "  (Certificates, IDs & Profiles -> + -> Developer ID Application), download the" >&2
  echo "  .cer, and double-click it to install into your login keychain." >&2
  echo "  Verify with: security find-identity -v -p codesigning" >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY="$SIGNING_IDENTITY"
echo ">> Signing identity: $SIGNING_IDENTITY"

# 2. Load notarization credentials.
NOTARIZE_ENV="${HOME}/.config/gridline/notarize.env"
if [ -f "$NOTARIZE_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$NOTARIZE_ENV"
  set +a
fi
if [ -z "${APPLE_API_KEY:-}" ] || [ -z "${APPLE_API_ISSUER:-}" ]; then
  if [ "${GRIDLINE_SKIP_NOTARIZE:-0}" = "1" ]; then
    echo ">> WARNING: notarization credentials missing; GRIDLINE_SKIP_NOTARIZE=1 set." >&2
    echo "  Building signed but NOT notarized (test-only — users will still see a prompt)." >&2
  else
    echo "ERROR: Notarization credentials not configured." >&2
    echo "  Create ${NOTARIZE_ENV} with APPLE_API_KEY and APPLE_API_ISSUER" >&2
    echo "  (and APPLE_API_KEY_PATH, or place the .p8 at ~/.appstoreconnect/private_keys/)." >&2
    echo "  See the README's 'macOS signing' section for the App Store Connect API key setup." >&2
    exit 1
  fi
else
  echo ">> Notarization: API key ${APPLE_API_KEY} (issuer ${APPLE_API_ISSUER})"
fi

# ---- build bundled DB tools (macOS) ----------------------------------------
WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
OUT_PG="${WORKSPACE}/desktop/src-tauri/resources/pg_tools"
OUT_MY="${WORKSPACE}/desktop/src-tauri/resources/mysql_tools"

echo ">> Building PostgreSQL client tools..."
mkdir -p "$OUT_PG"
PG_VER="16.4"
curl -fsSL "https://ftp.postgresql.org/pub/source/v${PG_VER}/postgresql-${PG_VER}.tar.bz2" -o /tmp/pg.tar.bz2
# Idempotent re-runs: clear stale build dirs left by previous invocations.
rm -rf "/tmp/postgresql-${PG_VER}" /tmp/pgbuild
tar -xf /tmp/pg.tar.bz2 -C /tmp
cd /tmp/postgresql-${PG_VER}
ac_cv_func_strchrnul=no ./configure --prefix=/tmp/pgbuild --without-readline --without-icu CFLAGS="-O2"
sed -i '' 's/strchrnul/pg_strchrnul/g' src/port/snprintf.c
make -C src/backend generated-headers
make -C src/interfaces/libpq all
make -j"$(sysctl -n hw.ncpu)" -C src/bin/pg_dump all
make -j"$(sysctl -n hw.ncpu)" -C src/bin/psql all
cp src/bin/pg_dump/pg_dump src/bin/pg_dump/pg_restore "$OUT_PG"/
cp src/bin/psql/psql "$OUT_PG"/
cp src/interfaces/libpq/libpq.5.dylib "$OUT_PG"/libpq.5.dylib
for b in pg_dump pg_restore psql; do
  libpq=$(otool -L "$OUT_PG/$b" | awk '/libpq/ {print $1; exit}')
  install_name_tool -change "$libpq" "@loader_path/libpq.5.dylib" "$OUT_PG/$b"
done
# install_name_tool invalidates the linker's signature; re-sign with the
# Developer ID identity + hardened runtime + secure timestamp so the bundle
# passes notarization (Apple rejects ad-hoc-signed nested executables).
for f in "$OUT_PG"/pg_dump "$OUT_PG"/pg_restore "$OUT_PG"/psql "$OUT_PG"/libpq.5.dylib; do
  codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$f"
done

echo ">> Building MariaDB client tools..."
mkdir -p "$OUT_MY"
MARIADB_VER="11.4.5"
# Idempotent re-runs: git clone fails if the destination is non-empty (e.g.
# left over from an earlier build on the same machine). Clean it first.
rm -rf /tmp/mariadb-server
git clone --depth 1 --branch "mariadb-${MARIADB_VER}" https://github.com/MariaDB/server.git /tmp/mariadb-server
cd /tmp/mariadb-server
if [ "$(uname -m)" = arm64 ]; then
  SSL_DIR="/opt/homebrew/opt/openssl"
else
  SSL_DIR="/usr/local/opt/openssl"
fi
[ -d "$SSL_DIR" ] || brew install openssl
cmake -DCMAKE_BUILD_TYPE=Release \
  -DWITHOUT_SERVER=ON \
  -DWITHOUT_TOKUDB=1 \
  -DWITHOUT_ROCKSDB=1 \
  -DWITHOUT_MROONGA=1 \
  -DWITHOUT_SPIDER=1 \
  -DWITHOUT_SEQUENCE=1 \
  -DWITH_UNIT_TESTS=OFF \
  -DWITH_SSL="$SSL_DIR" \
  -DWITH_ZLIB=bundled .
make -j"$(sysctl -n hw.ncpu)" mariadb-dump mariadb
for b in mariadb-dump mariadb; do
  src=$(find client -maxdepth 1 -type f -name "$b" -print -quit 2>/dev/null || true)
  test -n "$src" || src=$(find . -type f -name "$b" -print -quit || true)
  test -n "$src" || { echo "build produced no $b binary"; exit 1; }
  cp "$src" "$OUT_MY"/
done
for pass in 1 2 3 4 5 6; do
  for dylib in "$OUT_MY"/*.dylib "$OUT_MY"/mariadb-dump "$OUT_MY"/mariadb; do
    [ -f "$dylib" ] || continue
    otool -L "$dylib" | awk 'NR>1 {print $1}' | grep -E '^/(usr/local|opt/homebrew)' | while read -r lib; do
      base=$(basename "$lib")
      if [ ! -f "$OUT_MY/$base" ]; then cp "$lib" "$OUT_MY/$base" 2>/dev/null || true; fi
      install_name_tool -change "$lib" "@loader_path/$base" "$dylib" 2>/dev/null || true
    done || true
    codesign --force --options runtime --timestamp --sign "$SIGNING_IDENTITY" "$dylib"
  done
done

# ---- build the app (both arches) ------------------------------------------
cd "${WORKSPACE}/desktop"
echo ">> Installing frontend dependencies..."
bun install --frozen-lockfile

echo ">> Building aarch64 (Apple Silicon)..."
bun run tauri build --target aarch64-apple-darwin
echo ">> Building x86_64 (Intel)..."
bun run tauri build --target x86_64-apple-darwin

VERSION="${TAG#v}"
BUNDLE_ARM="${WORKSPACE}/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle"
BUNDLE_INTEL="${WORKSPACE}/desktop/src-tauri/target/x86_64-apple-darwin/release/bundle"

# ---- verify signing + notarization -----------------------------------------
# Confirm both .app bundles are properly signed and carry a stapled
# notarization ticket before we upload them. spctl can lag right after
# notarization (assessment cache), so stapler validate is the authoritative
# check; a pending spctl is only a warning.
for APP in \
  "${BUNDLE_ARM}/macos/Gridline.app" \
  "${BUNDLE_INTEL}/macos/Gridline.app"; do
  [ -d "$APP" ] || { echo "missing $APP" >&2; exit 1; }
  echo ">> Verifying $APP"
  codesign --verify --deep --strict --verbose=2 "$APP" \
    || { echo "codesign verify FAILED" >&2; exit 1; }
  xcrun stapler validate "$APP" \
    || { echo "notarization ticket not stapled" >&2; exit 1; }
  spctl --assess --type execute --verbose=4 "$APP" \
    || echo "  (spctl assessment pending — normal right after notarization; stapler validate passed)"
done

# ---- notarize + staple the DMGs --------------------------------------------
# Notarizing the .app is not enough. When a user opens the downloaded DMG,
# Gatekeeper assesses the DMG itself — and an unnotarized DMG is rejected as
# "Unnotarized Developer ID" even though the app inside it is fine. Submit each
# DMG to the same notary service and staple the ticket into the DMG.
if [ "${GRIDLINE_SKIP_NOTARIZE:-0}" = "1" ]; then
  echo ">> Skipping DMG notarization (GRIDLINE_SKIP_NOTARIZE=1)."
else
  API_KEY_PATH="${APPLE_API_KEY_PATH:-${HOME}/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY}.p8}"
  [ -f "$API_KEY_PATH" ] || {
    echo "ERROR: notarization API key not found at $API_KEY_PATH" >&2
    echo "  Set APPLE_API_KEY_PATH in ${NOTARIZE_ENV} or place the .p8 at the default location." >&2
    exit 1
  }
  for DMG in \
    "${BUNDLE_ARM}/dmg/Gridline_${VERSION}_aarch64.dmg" \
    "${BUNDLE_INTEL}/dmg/Gridline_${VERSION}_x64.dmg"; do
    [ -f "$DMG" ] || { echo "missing $DMG" >&2; exit 1; }
    echo ">> Notarizing $(basename "$DMG") (this can take a few minutes)"
    xcrun notarytool submit "$DMG" \
      --key "$API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" \
      --issuer "$APPLE_API_ISSUER" \
      --wait
    xcrun stapler staple "$DMG" \
      || { echo "failed to staple $(basename "$DMG")" >&2; exit 1; }
    xcrun stapler validate "$DMG" \
      || { echo "notarization ticket not stapled to $(basename "$DMG")" >&2; exit 1; }
  done
fi

# ---- create/ensure release + upload DMGs -----------------------------------
cd "${WORKSPACE}"

echo ">> Ensuring release ${TAG} exists on ${GH_REPO}..."
if ! gh release view "${TAG}" --repo "${GH_REPO}" >/dev/null 2>&1; then
  gh release create "${TAG}" --repo "${GH_REPO}" --title "Gridline ${VERSION}" \
    --notes "Gridline ${VERSION} — macOS (built locally, signed + notarized)." --draft
else
  echo ">> Release ${TAG} already exists."
fi

# --clobber replaces the CI-built (ad-hoc) DMGs with this signed + notarized pair.
echo ">> Uploading macOS DMGs (replacing any existing ones)..."
gh release upload "${TAG}" --repo "${GH_REPO}" --clobber \
  "${BUNDLE_ARM}/dmg/Gridline_${VERSION}_aarch64.dmg" \
  "${BUNDLE_INTEL}/dmg/Gridline_${VERSION}_x64.dmg"

echo "Done. Review + publish the draft: https://github.com/${GH_REPO}/releases/tag/${TAG}"
