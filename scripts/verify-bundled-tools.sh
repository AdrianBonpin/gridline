#!/usr/bin/env bash
#
# Check the packaged database-tool manifests BEFORE anything is uploaded.
#
# Ticket 44, "Release inputs are verified": `release.yml` builds the bundled
# PostgreSQL and MariaDB client tools from the pinned, digest-verified inputs in
# `scripts/tool-inputs.env`, writes `checksums.txt` into each resource directory,
# and then runs this script as its last gate before `tauri-action` packages
# those directories into the installers and opens the draft release.
#
# What it asserts, per resource directory (`resources/pg_tools`,
# `resources/mysql_tools`):
#
#   1. The manifest exists. A missing manifest means the build step never
#      finished writing what is about to ship, so nothing is packaged.
#   2. Every file the manifest lists is present and still hashes to the digest
#      the manifest recorded — a binary swapped after the build step, a
#      half-written copy, or a truncated library fails here.
#   3. Every non-hidden file in the directory is listed in the manifest, so an
#      unexpected extra executable cannot be smuggled into the bundle.
#   4. Every required tool is present, actually runs from the resource
#      directory (shared-library/path damage is a real failure mode that has
#      bitten this bundle before), and reports the version pinned in
#      `scripts/tool-inputs.env` — a tool built from the wrong source, or a
#      stale artifact, fails here.
#   5. `tauri.conf.json` still bundles both directories, so the checked files
#      really are the files that get packaged.
#
# The expected tool FILE NAME carries the platform's binary suffix: the Windows
# job writes (and manifests) `pg_dump.exe`, `pg_restore.exe`, `psql.exe`,
# `mariadb-dump.exe` and `mariadb.exe`, while the Linux and macOS jobs write
# the bare names. --platform says which shape is expected (it defaults to
# $PLATFORM, then to the host's `uname -s`); both resource directories are
# checked the same way. It is deliberately NOT decided by probing the
# directory: under MSYS2 (the `bash` shell on the windows-latest runner)
# `test -f pg_dump` SUCCEEDS for `pg_dump.exe`, so a probe picks the bare name,
# `basename` then reports `pg_dump`, and a manifest that correctly lists
# `pg_dump.exe` reads as missing the tool — the v0.9.1 false failure that
# blocked every Windows release.
#
# Usage:
#   scripts/verify-bundled-tools.sh [--resources DIR] [--conf FILE] [--platform LABEL]
#
#   --platform LABEL   the release runner label whose bundle shape is expected
#                      (`windows-latest` → `.exe` names, `ubuntu-22.04` /
#                      `macos-latest` / `macos-15-intel` → bare names).
#
# Exit status: 0 = every manifest and tool checked out, 1 = a check failed,
# 2 = usage error.

set -uo pipefail

self_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$self_dir/.." && pwd)"
inputs_file="$self_dir/tool-inputs.env"
fetch="$self_dir/verified-fetch.sh"

resources="$repo_root/desktop/src-tauri/resources"
conf="$repo_root/desktop/src-tauri/tauri.conf.json"
platform_name=""

usage() {
  cat >&2 <<'EOF'
usage: scripts/verify-bundled-tools.sh [--resources DIR] [--conf FILE] [--platform LABEL]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --resources) resources="${2:-}"; shift 2 || usage ;;
    --resources=*) resources="${1#*=}"; shift ;;
    --conf) conf="${2:-}"; shift 2 || usage ;;
    --conf=*) conf="${1#*=}"; shift ;;
    --platform) platform_name="${2:-}"; shift 2 || usage ;;
    --platform=*) platform_name="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'verify-bundled-tools: unknown argument: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

status=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; status=1; }

if [ ! -f "$inputs_file" ]; then
  fail "missing pin file: $inputs_file"
  printf '\nverify-bundled-tools: FAILED\n' >&2
  exit 1
fi
if [ ! -x "$fetch" ]; then
  fail "missing verifier: $fetch"
  printf '\nverify-bundled-tools: FAILED\n' >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$inputs_file"
set +a

#
# Which binary suffix the bundle being checked must contain.
#
# Decided by the runner label — the same label the build step branches on to
# decide what it writes — and never by probing the directory (see the header:
# MSYS2 resolves `pg_dump` to `pg_dump.exe`, so a probe cannot tell the two
# shapes apart). An unknown label is refused instead of guessed, so a release
# that stops passing the label fails here rather than silently checking the
# wrong shape.
#
if [ -z "$platform_name" ]; then
  platform_name="${PLATFORM:-}"
fi
if [ -z "$platform_name" ]; then
  platform_name="$(uname -s 2>/dev/null || true)"
fi
case "$platform_name" in
  windows-*|Windows-*|WINDOWS-*|win32|MINGW*|mingw*|MSYS*|msys*|CYGWIN*|cygwin*)
    bin_ext=".exe"
    ;;
  ubuntu-*|macos-*|MacOS*|linux|Linux|darwin|Darwin)
    bin_ext=""
    ;;
  *)
    printf 'verify-bundled-tools: refusing an unrecognised platform: %s\n' "${platform_name:-<empty>}" >&2
    printf 'verify-bundled-tools: pass the release runner label via --platform (windows-latest, ubuntu-22.04, macos-latest, macos-15-intel)\n' >&2
    exit 2
    ;;
esac
if [ -n "$bin_ext" ]; then
  shape="${bin_ext} tool names"
else
  shape="bare tool names (no ${bin_ext:-.exe} suffix)"
fi
pass "platform ${platform_name}: expecting ${shape}"

#
# Verify one resource directory's manifest and tools.
#   check_dir <subdir> <expected-version> <tool>...
#
check_dir() {
  local subdir="$1" version="$2"
  shift 2
  local tools=("$@")
  local dir="$resources/$subdir"
  local manifest="$dir/checksums.txt"

  if [ ! -d "$dir" ]; then
    fail "$subdir: resource directory is missing ($dir)"
    return
  fi
  if [ ! -f "$manifest" ]; then
    fail "$subdir: checksums.txt is missing — the build step must write the packaged manifest"
    return
  fi

  # 2 + 3: verify the recorded digests, then account for every file.
  local listed=$'\n' entries=0
  local hash name actual
  while IFS= read -r line || [ -n "$line" ]; do
    [ -n "$line" ] || continue
    # The manifest is `sha256sum *` output, so a file name that needs escaping
    # (any Windows path) prefixes the digest with a backslash. Normalise it the
    # same way the file itself is hashed below, or a correctly bundled tool
    # reads as a manifest mismatch. See `normalise_sha256` in
    # scripts/verified-fetch.sh — this calls it rather than re-parsing here.
    hash="$("$fetch" digest "${line%% *}")" || hash=""
    name="${line#* }"
    while [ "${name# }" != "$name" ]; do name="${name# }"; done
    name="${name#\*}"
    if [ -z "$name" ] || [ -z "$hash" ]; then
      fail "$subdir: malformed manifest line: $line"
      continue
    fi
    entries=$((entries + 1))
    listed="${listed}${name}"$'\n'
    if [ ! -f "$dir/$name" ]; then
      fail "$subdir: manifest lists $name, which is not in the bundle"
      continue
    fi
    if ! actual="$("$fetch" sha256 "$dir/$name")"; then
      fail "$subdir: could not hash $name"
      continue
    fi
    if [ "$actual" != "$hash" ]; then
      fail "$subdir: $name does not match its manifest digest (pinned $hash, actual $actual)"
    fi
  done < "$manifest"
  if [ "$entries" -eq 0 ]; then
    fail "$subdir: checksums.txt is empty"
  fi

  local unexpected=0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$listed" in
      *$'\n'"$name"$'\n'*) ;;
      *) fail "$subdir: $name is in the bundle but not in checksums.txt"; unexpected=1 ;;
    esac
  done < <(cd "$dir" && find . -maxdepth 1 -type f ! -name checksums.txt ! -name '.*' -print | sed 's|^\./||' | sort)
  [ "$unexpected" -eq 0 ] && pass "$subdir: manifest matches the files in the bundle ($entries entries)"

  # 4: required tools present, listed in the manifest, runnable, and reporting
  # the pinned version. The file name is the platform's expected name
  # (`pg_dump.exe` on Windows, `pg_dump` elsewhere), so the name checked here is
  # exactly the name the build step wrote and the manifest lists — identically
  # for pg_tools and mysql_tools. A bundle of the other shape fails, and so does
  # a tool the manifest does not name.
  local tool name file out first
  for tool in "${tools[@]}"; do
    name="${tool}${bin_ext}"
    file="$dir/$name"
    if [ ! -f "$file" ]; then
      fail "$subdir: required tool $name is not bundled"
      continue
    fi
    case "$listed" in
      *$'\n'"$name"$'\n'*) ;;
      *) fail "$subdir: $name is missing from checksums.txt"; continue ;;
    esac
    # The exact expected path is executed — including its `.exe` suffix on
    # Windows, so the check runs the very file that ships instead of a bare name
    # MSYS2 would resolve implicitly.
    if ! out="$("$file" --version 2>&1)"; then
      fail "$subdir: $name does not run from the resource directory ($out)"
      continue
    fi
    first="$(printf '%s\n' "$out" | head -n 1)"
    case "$out" in
      *"$version"*) pass "$subdir: $name reports the pinned version ($first)" ;;
      *) fail "$subdir: $name does not report pinned version $version (got: $first)" ;;
    esac
  done
}

check_dir pg_tools "$PG_TOOLS_VERSION" pg_dump pg_restore psql
check_dir mysql_tools "$MARIADB_TOOLS_VERSION" mariadb-dump mariadb

# 5: the checked directories must be the ones Tauri bundles.
if [ ! -f "$conf" ]; then
  fail "missing bundle config: $conf"
else
  for pattern in 'resources/pg_tools/*' 'resources/mysql_tools/*'; do
    if grep -qF "$pattern" "$conf"; then
      pass "tauri.conf.json bundles $pattern"
    else
      fail "tauri.conf.json does not bundle $pattern — the verified tools would not ship"
    fi
  done
fi

if [ "$status" -eq 0 ]; then
  printf '\nverify-bundled-tools: all checks passed\n'
else
  printf '\nverify-bundled-tools: FAILED\n' >&2
fi
exit "$status"
