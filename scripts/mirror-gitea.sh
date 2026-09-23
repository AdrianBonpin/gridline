#!/usr/bin/env bash
#
# Keep the Gitea "just in case" mirror (git.ranio.xyz) in step with GitHub.
#
# GitHub (`AdrianBonpin/gridline`, remote `github`) is the source of truth; the
# Gitea remote (`origin`) exists only as a fallback copy of the code, so this
# mirrors the trunk branch and every tag — not feature branches.
#
# Run it manually after a merge that happened on GitHub, or let the repo's git
# hooks call it (`scripts/install-git-hooks.sh` wires up `core.hooksPath`):
#   * pre-push   — before pushing prod/tags to GitHub
#   * post-merge — after `git pull`/merge while on prod
#
# Exit status is non-zero when the mirror could not be updated, so callers can
# decide whether that is fatal. The hooks treat it as a warning: a Gitea outage
# must never block a push to GitHub.
#
# Usage:
#   scripts/mirror-gitea.sh                 # mirror prod + all tags
#   GRIDLINE_GITEA_REMOTE=mirror scripts/…  # use another remote name
#   scripts/mirror-gitea.sh --branches      # also mirror every local branch

set -uo pipefail

GITEA_REMOTE="${GRIDLINE_GITEA_REMOTE:-origin}"
MIRROR_BRANCHES=0
TRUNK_BRANCH="${GRIDLINE_TRUNK_BRANCH:-prod}"

for arg in "$@"; do
  case "$arg" in
    --branches) MIRROR_BRANCHES=1 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "mirror-gitea: unknown argument '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "mirror-gitea: not inside a git repository" >&2
  exit 1
}
cd "$repo_root" || exit 1

url="$(git remote get-url "$GITEA_REMOTE" 2>/dev/null || true)"
if [ -z "$url" ]; then
  echo "mirror-gitea: remote '$GITEA_REMOTE' not found — nothing to mirror" >&2
  exit 1
fi

# Safety: never push to GitHub through this script (it is the source, and a
# mis-pointed remote could otherwise rewrite the wrong repository).
case "$url" in
  *github.com*)
    echo "mirror-gitea: '$GITEA_REMOTE' points at GitHub ($url) — refusing to mirror" >&2
    exit 1
    ;;
esac

status=0
note() { printf 'mirror-gitea: %s\n' "$1" >&2; }

# Trunk branch. Only mirror it when it exists locally; a fresh clone with just
# the feature branch checked out still mirrors the tags below.
if git show-ref --verify --quiet "refs/heads/$TRUNK_BRANCH"; then
  if ! git push "$GITEA_REMOTE" "refs/heads/$TRUNK_BRANCH:refs/heads/$TRUNK_BRANCH"; then
    status=1
    note "could not update $TRUNK_BRANCH"
  fi
fi

# Every local tag, so release tags appear on the mirror too (`--tags` is
# idempotent — already-present tags are skipped).
if [ -n "$(git tag --list)" ]; then
  if ! git push "$GITEA_REMOTE" --tags; then
    status=1
    note "could not update tags"
  fi
fi

# Optional: every local branch (off by default — feature branches are ephemeral).
if [ "$MIRROR_BRANCHES" = "1" ]; then
  if ! git push "$GITEA_REMOTE" --all; then
    status=1
    note "could not update branches"
  fi
fi

if [ "$status" = "0" ]; then
  note "mirror up to date ($url)"
fi
exit "$status"
