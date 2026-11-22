#!/usr/bin/env bash
#
# Fetch (or re-use) a pinned build input and verify it cryptographically.
#
# Ticket 44, "Release inputs are verified": the bundled database tools come
# from pinned sources with checked integrity, so the shipped executables have
# an auditable chain. Every PostgreSQL / MariaDB input the release pipeline
# consumes is declared in `scripts/tool-inputs.env` with a version and either a
# SHA-256 digest or an exact git commit. This script is the ONLY place that
# retrieves those inputs, and it never hands one back unverified:
#
#   * a fresh download is hashed BEFORE it is moved into place, so a truncated
#     or substituted response can never be used,
#   * a cached archive (the CI cache, or a leftover from an earlier run) is
#     re-hashed every single time it is used — a cache hit is verified, never
#     trusted,
#   * a mismatch deletes the unverified bytes and exits non-zero, so the
#     calling step fails closed instead of packaging the artifact. It does not
#     "warn and continue", and it does not silently re-download over a cache
#     entry whose digest is wrong (that is a security event, not a glitch),
#   * plain `http://` inputs are refused outright — the transport has to be
#     authenticated as well as the payload.
#
# Usage:
#   scripts/verified-fetch.sh fetch   <https-url> <sha256> <destination>
#   scripts/verified-fetch.sh check   <file> <sha256>
#   scripts/verified-fetch.sh commit  <git-worktree> <commit-sha>
#   scripts/verified-fetch.sh sha256  <file>
#   scripts/verified-fetch.sh digest  <sha256sum-output-field>
#
# `sha256 <file>` prints the bare digest; `digest <field>` normalises a digest
# that was parsed out of a `sha256sum`/`shasum -a 256` listing (see
# `normalise_sha256` — the two must agree, which is why the parser lives here
# and `scripts/verify-bundled-tools.sh` calls it instead of re-implementing it).
#
# Exit status: 0 = verified/ok, 1 = missing, malformed or mismatched input,
# 2 = usage error.

set -euo pipefail

err() { printf 'verified-fetch: %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/verified-fetch.sh fetch   <https-url> <sha256> <destination>
       scripts/verified-fetch.sh check   <file> <sha256>
       scripts/verified-fetch.sh commit  <git-worktree> <commit-sha>
       scripts/verified-fetch.sh sha256  <file>
       scripts/verified-fetch.sh digest  <sha256sum-output-field>
EOF
  exit 2
}

is_sha256() {
  # 64 lowercase hex characters, nothing else.
  case "$1" in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

is_git_sha() {
  # Full commit id: 40 (SHA-1) or 64 (SHA-256) lowercase hex characters.
  case "$1" in
    *[!0-9a-f]*) return 1 ;;
  esac
  [ "${#1}" -eq 40 ] || [ "${#1}" -eq 64 ]
}

# Normalise one digest field from a `sha256sum`/`shasum -a 256` listing.
#
# The bare hex digest is all that may be compared, but the tools do not always
# print it bare:
#
#   * GNU coreutils prefixes the digest with a backslash when the file name it
#     prints alongside it needs escaping, and a backslash does — which means
#     EVERY Windows runner path (`D:\a\_temp\…`) is printed as
#     `\3508d8f0…  D:\a\_temp\…\postgresql-16.4-1-windows-x64-binaries.zip`.
#     Parsing that field naively yields `\3508d8f0…`, which can never equal the
#     pin, so the v0.9.0 release run failed every bundled-tool download on
#     Windows with "DIGEST MISMATCH" against two visually identical digests.
#   * `sha256sum -b` / BSD `shasum -b` mark binary mode with a `*` before the
#     file name, so a field parsed loosely can carry it.
#   * a digest listing produced on Windows can carry CRLF line endings.
#
# So: drop a CR, drop one leading `\` escape marker, drop one leading `*`
# binary marker, then keep exactly the first 64 characters when those are all
# lowercase hex. Anything else is returned unchanged, so `is_sha256` and the
# comparison still fail closed on a genuinely malformed or mismatched value —
# normalising removes the TOOL's decoration, never a difference between two
# digests.
normalise_sha256() {
  local value="${1:-}"
  # A caller may hand over a whole listing line (digest, marker, file name).
  # Drop leading whitespace, then keep only the first field — which also drops
  # a CR from a CRLF listing, the `*` binary marker of `sha256sum -b` and the
  # file name itself.
  while :; do
    case "$value" in
      [[:space:]]*) value="${value#?}" ;;
      *) break ;;
    esac
  done
  value="${value%%[[:space:]]*}"
  value="${value#\\}"
  value="${value#\*}"
  case "${value:0:64}" in
    '' | *[!0-9a-f]*) ;;
    *) value="${value:0:64}" ;;
  esac
  printf '%s' "$value"
}

# Portable SHA-256: GNU coreutils on Linux/Git-Bash, `shasum` on macOS.
sha256_of() {
  local file="$1" line
  if command -v sha256sum >/dev/null 2>&1; then
    line="$(sha256sum -- "$file")" || return 1
  elif command -v shasum >/dev/null 2>&1; then
    line="$(shasum -a 256 -- "$file")" || return 1
  else
    err "no SHA-256 tool on PATH (need sha256sum or shasum)"
    return 1
  fi
  # The digest is the first whitespace-separated field; `normalise_sha256`
  # strips the tool's decoration (`\` escape marker, `*` binary marker).
  normalise_sha256 "$line"
}

cmd_sha256() {
  [ "$#" -eq 1 ] || usage
  [ -f "$1" ] || { err "no such file: $1"; return 1; }
  sha256_of "$1"
}

cmd_digest() {
  [ "$#" -eq 1 ] || usage
  normalise_sha256 "$1"
}

cmd_check() {
  [ "$#" -eq 2 ] || usage
  local file="$1" expected="$2" actual
  [ -f "$file" ] || { err "missing input: $file"; return 1; }
  is_sha256 "$expected" || {
    err "malformed pin for $file: ${expected:-<empty>} (expected 64 hex characters)"
    return 1
  }
  actual="$(sha256_of "$file")" || return 1
  if [ "$actual" != "$expected" ]; then
    err "DIGEST MISMATCH for $file"
    err "  pinned: $expected"
    err "  actual: $actual"
    return 1
  fi
  return 0
}

cmd_fetch() {
  [ "$#" -eq 3 ] || usage
  local url="$1" expected="$2" dest="$3"

  case "$url" in
    https://*) ;;
    *)
      err "refusing a non-https input URL: $url"
      return 1
      ;;
  esac
  is_sha256 "$expected" || {
    err "malformed pin for $url: ${expected:-<empty>} (expected 64 hex characters)"
    return 1
  }
  [ -n "$dest" ] || { err "empty destination for $url"; return 1; }

  mkdir -p "$(dirname -- "$dest")"

  # Cache hit: still verified. Never trusted because it exists.
  if [ -e "$dest" ]; then
    if cmd_check "$dest" "$expected"; then
      printf 'verified cached input %s (sha256 %s)\n' "$dest" "$expected"
      return 0
    fi
    err "REFUSING the unverified cached archive at $dest"
    err "  it does not match the pin in scripts/tool-inputs.env, so the build stops here."
    err "  if an upstream pin just changed, delete the stale copy (or bump the cache key)"
    return 1
  fi

  local part="${dest}.part"
  rm -f "$part"
  if ! curl --proto '=https' --tlsv1.2 --retry 3 --retry-delay 5 --retry-connrefused \
      -fsSL -o "$part" "$url"; then
    err "download failed: $url"
    rm -f "$part"
    return 1
  fi

  if ! cmd_check "$part" "$expected"; then
    rm -f "$part"
    err "downloaded bytes do not match the pin for $url — failing closed, nothing was kept"
    return 1
  fi

  mv "$part" "$dest"
  printf 'verified downloaded input %s (sha256 %s)\n' "$dest" "$expected"
}

cmd_commit() {
  [ "$#" -eq 2 ] || usage
  local dir="$1" expected="$2" head
  is_git_sha "$expected" || {
    err "malformed commit pin for $dir: ${expected:-<empty>} (expected a full 40-char commit id)"
    return 1
  }
  [ -d "$dir" ] || { err "no such checkout: $dir"; return 1; }
  if ! head="$(git -C "$dir" rev-parse HEAD 2>/dev/null)"; then
    err "not a git checkout: $dir"
    return 1
  fi
  if [ "$head" != "$expected" ]; then
    err "COMMIT MISMATCH for $dir"
    err "  pinned: $expected"
    err "  actual: $head"
    err "  (the upstream tag moved or served a different tree — refusing to build from it)"
    return 1
  fi
  printf 'verified pinned commit %s in %s\n' "$head" "$dir"
}

[ "$#" -ge 1 ] || usage
command="$1"
shift
case "$command" in
  fetch) cmd_fetch "$@" ;;
  check) cmd_check "$@" ;;
  commit) cmd_commit "$@" ;;
  sha256) cmd_sha256 "$@" ;;
  digest) cmd_digest "$@" ;;
  *) err "unknown command: $command"; usage ;;
esac
