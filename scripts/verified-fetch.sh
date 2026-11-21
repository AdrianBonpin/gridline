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
#   scripts/verified-fetch.sh fetch  <https-url> <sha256> <destination>
#   scripts/verified-fetch.sh check  <file> <sha256>
#   scripts/verified-fetch.sh commit <git-worktree> <commit-sha>
#   scripts/verified-fetch.sh sha256 <file>
#
# Exit status: 0 = verified/ok, 1 = missing, malformed or mismatched input,
# 2 = usage error.

set -euo pipefail

err() { printf 'verified-fetch: %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/verified-fetch.sh fetch  <https-url> <sha256> <destination>
       scripts/verified-fetch.sh check  <file> <sha256>
       scripts/verified-fetch.sh commit <git-worktree> <commit-sha>
       scripts/verified-fetch.sh sha256 <file>
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

# Portable SHA-256: GNU coreutils on Linux/Git-Bash, `shasum` on macOS.
sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    err "no SHA-256 tool on PATH (need sha256sum or shasum)"
    return 1
  fi
}

cmd_sha256() {
  [ "$#" -eq 1 ] || usage
  [ -f "$1" ] || { err "no such file: $1"; return 1; }
  sha256_of "$1"
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
  *) err "unknown command: $command"; usage ;;
esac
