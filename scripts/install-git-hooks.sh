#!/usr/bin/env bash
#
# Install the repo's git hooks (once per clone).
#
# Points `core.hooksPath` at `scripts/hooks/` so the hook files are versioned
# with the repo instead of copied into `.git/hooks` (a stale copy can't drift
# out of date this way). Currently:
#
#   pre-push   — mirror prod + tags to the Gitea fallback (git.ranio.xyz)
#   post-merge — same, after a `git pull`/merge while on prod
#
# The mirror itself lives in `scripts/mirror-gitea.sh`; run it by hand any time
# with `scripts/mirror-gitea.sh`. Gitea is a just-in-case copy: GitHub is the
# source of truth, and a Gitea outage never blocks a push.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "install-git-hooks: not inside a git repository" >&2
  exit 1
}
cd "$repo_root"

if [ ! -d scripts/hooks ]; then
  echo "install-git-hooks: scripts/hooks/ is missing — run this from the repo root" >&2
  exit 1
fi

chmod +x scripts/hooks/* scripts/mirror-gitea.sh 2>/dev/null || true
git config core.hooksPath scripts/hooks

gitea_remote="${GRIDLINE_GITEA_REMOTE:-origin}"
echo "install-git-hooks: core.hooksPath -> scripts/hooks"
for hook in scripts/hooks/*; do
  echo "install-git-hooks:   $(basename "$hook")"
done
echo "install-git-hooks: prod + tags mirror to the '$gitea_remote' remote on push/pull"
