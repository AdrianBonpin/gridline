#!/usr/bin/env bash
#
# Build Gridline for macOS on this machine and upload the DMGs to the Gitea
# release for a given tag. macOS is built manually (NOT auto-built on tag);
# the Linux and Windows installers are built by the Gitea Actions workflow
# (.gitea/workflows/release.yml) and already uploaded to the same release.
#
# Usage:
#   TAG=v0.7.11 ./scripts/release-mac.sh
#   (optionally set GITEA_TOKEN env var to override token lookup)
#
# The release is keyed by tag. The Linux/Windows job creates it on the first
# tag push; this script finds it (creating it only if it somehow doesn't exist)
# and attaches the two DMGs: Gridline_<ver>_aarch64.dmg and Gridline_<ver>_x64.dmg
#
# Token: reads $GITEA_TOKEN, else tries the tea CLI config, else prompts.

set -euo pipefail

# ---- config ---------------------------------------------------------------
GITEA_SERVER="${GITEA_SERVER:-https://git.ranio.xyz}"
REPO_OWNER="${REPO_OWNER:-adrianbonpin}"
REPO_NAME="${REPO_NAME:-gridline}"
TAG="${TAG:-${1:-}}"

if [ -z "$TAG" ]; then
  echo "usage: TAG=vX.Y.Z ./scripts/release-mac.sh" >&2
  exit 1
fi

# ---- resolve auth token ----------------------------------------------------
get_token() {
  if [ -n "${GITEA_TOKEN:-}" ]; then
    echo "$GITEA_TOKEN"; return
  fi
  # Try tea's stored credentials if available.
  if command -v tea >/dev/null 2>&1; then
    # tea stores its token in a config under the platform app-support dir.
    local cfg
    cfg="$(find "$HOME/Library/Application Support" "$HOME/.config" \
      -maxdepth 2 -name 'config.yml' -path '*tea*' 2>/dev/null | head -1 || true)"
    if [ -n "$cfg" ]; then
      local tok
      tok="$(sed -n 's/.*token:[" ]*\([^" ]*\).*/\1/p' "$cfg" 2>/dev/null | head -1 || true)"
      if [ -n "$tok" ]; then echo "$tok"; return; fi
    fi
  fi
  read -rsp "Gitea personal access token (repo write): " GITEA_TOKEN
  echo "$GITEA_TOKEN"
}

GITEA_TOKEN="$(get_token)"

# ---- build bundled DB tools (macOS) ----------------------------------------
WORKSPACE="$(cd "$(dirname "$0")/.." && pwd)"
OUT_PG="${WORKSPACE}/desktop/src-tauri/resources/pg_tools"
OUT_MY="${WORKSPACE}/desktop/src-tauri/resources/mysql_tools"

echo ">> Building PostgreSQL client tools..."
mkdir -p "$OUT_PG"
PG_VER="16.4"
curl -fsSL "https://ftp.postgresql.org/pub/source/v${PG_VER}/postgresql-${PG_VER}.tar.bz2" -o /tmp/pg.tar.bz2
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

echo ">> Building MariaDB client tools..."
mkdir -p "$OUT_MY"
MARIADB_VER="11.4.5"
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
    codesign --force --sign - "$dylib" 2>/dev/null || true
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

# ---- create/ensure release + upload DMGs -----------------------------------
API="${GITEA_SERVER}/api/v1/repos/${REPO_OWNER}/${REPO_NAME}"
AUTH="Authorization: token ${GITEA_TOKEN}"

echo ">> Ensuring release ${TAG} exists..."
REL_ID=$(curl -fsS -H "$AUTH" "${API}/releases/tags/${TAG}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [ -z "$REL_ID" ]; then
  BODY="Gridline ${VERSION} — macOS (built manually)."
  REL_ID=$(curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"tag_name\":\"${TAG}\",\"name\":\"Gridline ${VERSION}\",\"body\":\"${BODY}\",\"draft\":true}" \
    "${API}/releases" \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
fi

upload() {
  local file="$1"
  [ -f "$file" ] || { echo "missing $file" >&2; exit 1; }
  local name
  name=$(basename "$file")
  echo ">> uploading $name"
  curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/octet-stream" \
    --data-binary "@$file" \
    "${API}/releases/${REL_ID}/assets?name=${name}"
}

upload "${BUNDLE_ARM}/dmg/Gridline_${VERSION}_aarch64.dmg"
upload "${BUNDLE_INTEL}/dmg/Gridline_${VERSION}_x64.dmg"

echo "Done. Release: ${GITEA_SERVER}/${REPO_OWNER}/${REPO_NAME}/releases/tag/${TAG}"
