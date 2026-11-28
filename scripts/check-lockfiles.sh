#!/usr/bin/env bash
#
# Both Bun lockfiles are maintained (ticket 48).
#
# Gridline resolves its JavaScript dependencies twice:
#
#   * the workspace        -> root `bun.lock` (root, `desktop/`, `www/` manifests).
#                             This is the graph the website deploy installs: the
#                             deploy builds from the repository root and runs
#                             `bun install --frozen-lockfile` there.
#   * the standalone site  -> `www/bun.lock`, used when `www/` is installed on its
#                             own (an isolated build of the site package). The
#                             deploy does not consume it, but it stays checked:
#                             it is a real, Dependabot-updated graph, and an
#                             isolated build must reproduce what it declares.
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
#   3. The Bun that writes the lockfiles and the Bun that reads them are the same
#      version (`.bun-version`, `www/package.json` `packageManager`, and this
#      runner's `bun`). Bun's text lockfile gained `lockfileVersion: 2` in 1.4, and
#      a 1.3 binary rejects it outright: "Unknown lockfile version" / "lockfile
#      had changes, but lockfile is frozen". That shipped once (d9cc842) and took
#      the website deploy down while CI stayed green, because CI resolved `bun`
#      from `latest` rather than from the pinned version the deploy honours.
#      `.bun-version` is now what both the workflows and the deploy's build step
#      install; `packageManager` is what an isolated `www/` install honours, so the
#      two must agree or one of the two builds parses the other's lockfile.
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
# 2. The pinned Bun, the isolated-install Bun and this runner's Bun agree.
# --------------------------------------------------------------------------
# The website deploy's build step installs Bun from `.bun-version` (see the root
# `railpack.json`), and every workflow installs that same version. `packageManager`
# in `www/package.json` is what an isolated `bun install` inside `www/` honours.
# They must name the same version, and this check must run on the same *minor* —
# a lockfile format change is a minor-version event, so a patch difference is
# harmless while a minor difference is what breaks a build.
runtime_ok=1
if [ ! -f .bun-version ]; then
  fail "missing .bun-version (the workflows and the website deploy must install the same Bun)"
  runtime_ok=0
else
  pinned="$(tr -d '[:space:]' < .bun-version)"
  case "$pinned" in
    [0-9]*.[0-9]*.[0-9]*) : ;;
    *)
      fail ".bun-version must hold a plain X.Y.Z version, got '$pinned'"
      runtime_ok=0
      ;;
  esac

  declared="$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"bun@\([^"]*\)".*/\1/p' www/package.json)"
  if [ "$declared" != "$pinned" ]; then
    fail "www/package.json packageManager is 'bun@${declared:-<unset>}' but .bun-version is '$pinned'; the deploy's build step and every workflow install .bun-version while an isolated 'bun install' in www/ honours packageManager, so a mismatch means one of those builds parses a lockfile written by a different Bun (a lockfile-format change reads as 'Unknown lockfile version')"
    runtime_ok=0
  fi

  running="$(bun --version 2>/dev/null | tr -d '[:space:]')"
  if [ "${running%%.*}" != "${pinned%%.*}" ] ||
    [ "$(printf '%s' "$running" | cut -d. -f2)" != "$(printf '%s' "$pinned" | cut -d. -f2)" ]; then
    fail "this runner's bun is '$running' but .bun-version pins '$pinned'; run the check with the pinned Bun (CI installs it from .bun-version via oven-sh/setup-bun), otherwise the lockfile is verified with an unrelated parser"
    runtime_ok=0
  fi
fi
[ "$runtime_ok" = "1" ] &&
  pass "the pinned Bun (.bun-version) matches the website's packageManager and this runner's bun (minor version)"

# --------------------------------------------------------------------------
# 3. Each lockfile describes its manifest(s) — a frozen install succeeds.
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
    "regenerate it with the documented procedure (AGENTS.md, 'Website (www/) deps') and commit www/bun.lock alongside the root bun.lock; it is what an isolated build of www/ installs" ||
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
