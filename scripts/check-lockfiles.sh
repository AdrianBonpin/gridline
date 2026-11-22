#!/usr/bin/env bash
#
# Both Bun lockfiles are maintained (ticket 48).
#
# Gridline resolves its JavaScript dependencies twice:
#
#   * the workspace        -> root `bun.lock` (root, `desktop/`, `www/` manifests)
#   * the standalone site  -> `www/bun.lock`, which is what the Railpack/Dokploy
#                             build of `www/` actually resolves
#
# `.github/dependabot.yml` keeps both current, but Dependabot updates exactly one
# lockfile per entry and only understands the text `bun.lock` format. This check
# proves the two invariants that keep that automation meaningful:
#
#   1. Both lockfiles are text `bun.lock` files (never the legacy binary
#      `bun.lockb`, which Dependabot cannot update), so the configured coverage
#      is real rather than assumed.
#   2. Each lockfile describes its manifest(s): a `--frozen-lockfile` install of a
#      scratch copy succeeds. A manifest edited without regenerating its lockfile
#      fails here, on the pull request, instead of in a release build or on the
#      website deploy.
#
# Nothing in the working tree is modified: both installs run in throwaway copies.
#
# Usage: scripts/check-lockfiles.sh        (exit 0 = both lockfiles are maintained)

set -uo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root" || exit 1

status=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; status=1; }

if ! command -v bun >/dev/null 2>&1; then
  fail "bun is not on PATH, so neither lockfile can be verified (install Bun >= 1.2)"
  printf '\ncheck-lockfiles: FAILED\n' >&2
  exit 1
fi

# --------------------------------------------------------------------------
# 1. Both lockfiles are Dependabot-updatable text lockfiles.
# --------------------------------------------------------------------------
format_ok=1
for legacy in bun.lockb www/bun.lockb; do
  if [ -e "$legacy" ]; then
    fail "$legacy is the legacy binary Bun lockfile; Dependabot cannot update it — migrate to the text bun.lock"
    format_ok=0
  fi
done

for lockfile in bun.lock www/bun.lock; do
  if [ ! -f "$lockfile" ]; then
    fail "missing $lockfile (both lockfiles must be committed)"
    format_ok=0
    continue
  fi
  if [ "$(head -c 1 "$lockfile")" != "{" ] ||
    ! grep -q '"lockfileVersion"' "$lockfile"; then
    fail "$lockfile is not a text Bun lockfile (no JSON header / lockfileVersion); Dependabot can only update the text format"
    format_ok=0
    continue
  fi
  # Dependabot resolves the workspace graph itself; a lockfile that still names
  # the current manifest ranges is what makes its PRs mergeable.
  if ! grep -q '"workspaces"' "$lockfile"; then
    fail "$lockfile has no \"workspaces\" map, so it does not describe a Bun workspace install"
    format_ok=0
  fi
done
[ "$format_ok" = "1" ] &&
  pass "both lockfiles are text bun.lock files (root and standalone www), so Dependabot can update them"

# --------------------------------------------------------------------------
# 2. Each lockfile describes its manifest(s) — a frozen install succeeds.
# --------------------------------------------------------------------------
# frozen_install <label> <copy-root> <fix hint>
frozen_install() {
  local label="$1" dir="$2" hint="$3" out rc
  out="$(cd "$dir" && bun install --frozen-lockfile --ignore-scripts 2>&1)"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$label: 'bun install --frozen-lockfile' failed, so the lockfile no longer describes its manifest(s):"
    printf '%s\n' "$out" | sed 's/^/       /' >&2
    printf '       fix: %s\n' "$hint" >&2
    return 1
  fi
  return 0
}

scratch="$(mktemp -d "${TMPDIR:-/tmp}/gridline-lockfiles.XXXXXX")" || {
  fail "could not create a scratch directory"
  printf '\ncheck-lockfiles: FAILED\n' >&2
  exit 1
}
# shellcheck disable=SC2064
trap "rm -rf '$scratch'" EXIT

workspace_ok=1
if [ -f package.json ] && [ -f bun.lock ]; then
  mkdir -p "$scratch/workspace/desktop" "$scratch/workspace/www"
  cp package.json bun.lock "$scratch/workspace/"
  cp desktop/package.json "$scratch/workspace/desktop/"
  cp www/package.json "$scratch/workspace/www/"
  frozen_install "workspace lockfile (bun.lock)" "$scratch/workspace" \
    "run 'bun install' at the repository root and commit the updated bun.lock (it must cover the root, desktop/ and www/ manifests)" ||
    workspace_ok=0
else
  fail "missing root package.json or bun.lock"
  workspace_ok=0
fi

www_ok=1
if [ -f www/package.json ] && [ -f www/bun.lock ]; then
  mkdir -p "$scratch/www"
  cp www/package.json www/bun.lock "$scratch/www/"
  frozen_install "standalone website lockfile (www/bun.lock)" "$scratch/www" \
    "regenerate it with the documented procedure (AGENTS.md, 'Website (www/) deps') and commit www/bun.lock alongside the root bun.lock" ||
    www_ok=0
else
  fail "missing www/package.json or www/bun.lock"
  www_ok=0
fi

if [ "$workspace_ok" = "1" ]; then
  pass "the workspace lockfile (bun.lock) covers the root, desktop/ and www/ manifests"
fi
if [ "$www_ok" = "1" ]; then
  pass "the standalone website lockfile (www/bun.lock) covers www/package.json on its own"
fi

if [ "$status" -eq 0 ]; then
  printf '\ncheck-lockfiles: both lockfiles are in sync with their manifests\n'
else
  printf '\ncheck-lockfiles: FAILED\n' >&2
fi
exit "$status"
