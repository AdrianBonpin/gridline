#!/usr/bin/env bash
#
# Release-pipeline hygiene checks.
#
# Enforces the properties that a workflow file can guarantee (ticket 43, "One
# release pipeline with least trust"):
#
#   1. There is exactly ONE release pipeline: no workflow lives under `.gitea/`,
#      and no GitHub workflow talks to the Gitea host. Code mirroring (script +
#      git hooks) is a separate concern and is exercised end to end below.
#   2. Every third-party action is pinned to a full commit SHA.
#   3. Tokens are default-deny at workflow level and granted per job.
#   4. Ref/tag metadata (and secrets) never get interpolated into a `run:`
#      body — they are passed through `env:` and compared as data.
#   5. CI itself runs this script, so a regression fails the pull request.
#
# Ref protection, immutable releases and required checks are REPOSITORY
# SETTINGS, not files; they cannot be asserted here. See AGENTS.md
# "Release ref protection" for the exact settings an owner must apply.
#
# Usage: scripts/check-workflows.sh        (exit 0 = all checks passed)

set -uo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root" || exit 1

status=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; status=1; }

workflows=()
while IFS= read -r wf; do
  [ -n "$wf" ] && workflows+=("$wf")
done < <(ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null)

if [ ${#workflows[@]} -eq 0 ]; then
  fail "no workflows found under .github/workflows"
fi

# --------------------------------------------------------------------------
# 1. One release pipeline; mirroring is code-only and still works.
# --------------------------------------------------------------------------
gitea_workflows="$(find .gitea -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null || true)"
if [ -n "$gitea_workflows" ]; then
  fail "a workflow still lives under .gitea/ (the mirror must not build releases): ${gitea_workflows//$'\n'/ }"
else
  pass "no release workflow under .gitea/ (Gitea is a code mirror only)"
fi

if grep -l 'git\.ranio\.xyz' "${workflows[@]}" >/dev/null 2>&1; then
  fail "a GitHub workflow references the Gitea host (git.ranio.xyz); releases are GitHub-only"
else
  pass "no GitHub workflow references the Gitea host"
fi

# Mirroring must survive the removal. Structure check first: the script and the
# hooks that call it are still present, executable and syntactically valid.
mirror_files=(
  scripts/mirror-gitea.sh
  scripts/install-git-hooks.sh
  scripts/hooks/pre-push
  scripts/hooks/post-merge
)
mirror_ok=1
for f in "${mirror_files[@]}"; do
  if [ ! -f "$f" ]; then
    fail "missing mirroring file: $f"
    mirror_ok=0
    continue
  fi
  [ -x "$f" ] || { fail "mirroring file is not executable: $f"; mirror_ok=0; }
  bash -n "$f" 2>/dev/null || { fail "mirroring file has a syntax error: $f"; mirror_ok=0; }
done
for hook in scripts/hooks/pre-push scripts/hooks/post-merge; do
  grep -q 'mirror-gitea\.sh' "$hook" 2>/dev/null ||
    { fail "$hook no longer invokes scripts/mirror-gitea.sh"; mirror_ok=0; }
done
if grep -rq '\.gitea/workflows' scripts/ --exclude=check-workflows.sh 2>/dev/null; then
  fail "a script under scripts/ still depends on the removed .gitea/workflows release pipeline"
  mirror_ok=0
fi
[ "$mirror_ok" = "1" ] && pass "mirroring script + git hooks are present, executable and wired"

# Behavioural check: mirror a throwaway repository to a local bare "Gitea"
# remote, once directly and once through the pre-push hook. No network.
mirror_behaviour() {
  local tmp rc
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/gridline-mirror-check.XXXXXX")" || return 1
  # Explicit `|| exit 1` on every step: `set -e` is unreliable inside a function
  # whose status is being tested, so the checks below do not depend on it.
  (
    set -uo pipefail
    git init -q --bare "$tmp/mirror.git" || exit 1
    git init -q "$tmp/work" || exit 1
    cd "$tmp/work" || exit 1
    cp -R "$repo_root/scripts" ./scripts || exit 1
    git config user.email "check@gridline.invalid" || exit 1
    git config user.name "gridline workflow check" || exit 1
    git add -A || exit 1
    git commit -q -m base || exit 1
    git branch -M prod || exit 1
    git tag v9.9.9 || exit 1
    git remote add origin "$tmp/mirror.git" || exit 1
    # Direct invocation (what `scripts/install-git-hooks.sh` enables by hand).
    bash scripts/mirror-gitea.sh >/dev/null 2>&1 || exit 1
    git --git-dir="$tmp/mirror.git" show-ref --verify --quiet refs/heads/prod || exit 1
    git --git-dir="$tmp/mirror.git" show-ref --verify --quiet refs/tags/v9.9.9 || exit 1
    # The same through the installed pre-push hook on a GitHub push.
    git commit -q --allow-empty -m second || exit 1
    git tag v9.9.10 || exit 1
    printf 'refs/heads/prod %s refs/heads/prod %s\nrefs/tags/v9.9.10 %s refs/tags/v9.9.10 %s\n' \
      "$(git rev-parse HEAD)" "1111111111111111111111111111111111111111" \
      "$(git rev-parse v9.9.10)" "2222222222222222222222222222222222222222" |
      sh scripts/hooks/pre-push origin "https://github.com/AdrianBonpin/gridline.git" >/dev/null 2>&1 || exit 1
    git --git-dir="$tmp/mirror.git" show-ref --verify --quiet refs/tags/v9.9.10 || exit 1
    [ "$(git --git-dir="$tmp/mirror.git" rev-parse refs/heads/prod)" = "$(git rev-parse HEAD)" ] || exit 1
  )
  rc=$?
  rm -rf "$tmp"
  return "$rc"
}

mirror_behaviour
if [ $? -eq 0 ]; then
  pass "mirroring still copies prod + tags to the Gitea remote (script and pre-push hook)"
else
  fail "mirroring no longer works (run scripts/mirror-gitea.sh in a scratch clone to debug)"
fi

# --------------------------------------------------------------------------
# 2. Third-party actions are pinned to immutable revisions.
# --------------------------------------------------------------------------
unpinned="$(grep -hn '^[[:space:]]*\(-[[:space:]]*\)\{0,1\}uses:' "${workflows[@]}" 2>/dev/null |
  grep -v 'uses:[[:space:]]*\./' |
  grep -v 'uses:[[:space:]]*docker://' |
  grep -Ev '@[0-9a-f]{40}([[:space:]]|$)' || true)"
if [ -n "$unpinned" ]; then
  fail "actions not pinned to a 40-character commit SHA:"
  printf '%s\n' "$unpinned" >&2
else
  pass "every third-party action is pinned to a full commit SHA"
fi

# --------------------------------------------------------------------------
# 3. Least-privilege tokens: default-deny, per-job grants.
# --------------------------------------------------------------------------
if grep -q 'write-all' "${workflows[@]}" 2>/dev/null; then
  fail "a workflow grants 'write-all'; grant the specific scopes per job instead"
fi

perms_ok=1
for wf in "${workflows[@]}"; do
  top_perms="$(awk '
    /^permissions:/ { inb = 1 }
    inb && /^[^[:space:]#]/ && !/^permissions:/ { inb = 0 }
    inb { print }
  ' "$wf")"
  if printf '%s\n' "$top_perms" | grep -q 'write'; then
    fail "$wf grants write permissions at workflow level; move them to the job that needs them"
    perms_ok=0
  fi
  # Every job must declare its own permissions block.
  missing="$(awk '
    /^jobs:[[:space:]]*$/ { injobs = 1; cur = ""; next }
    injobs && /^[^[:space:]#]/ { injobs = 0; cur = "" }
    injobs && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ {
      cur = $0
      sub(/^ +/, "", cur)
      sub(/:.*/, "", cur)
      declared[cur] = 0
      next
    }
    injobs && cur != "" && /^    permissions:/ { declared[cur] = 1 }
    END { for (job in declared) if (declared[job] == 0) print job }
  ' "$wf")"
  if [ -n "$missing" ]; then
    fail "$wf has job(s) without a job-level permissions block: ${missing//$'\n'/ }"
    perms_ok=0
  fi
done
[ "$perms_ok" = "1" ] && pass "workflow tokens are default-deny and each job grants only what it uses"

# --------------------------------------------------------------------------
# 4. No expression interpolation inside `run:` bodies.
# --------------------------------------------------------------------------
script_injections="$(awk '
  function indent(s,  n) { n = 0; while (substr(s, n + 1, 1) == " ") n++; return n }
  {
    if (inrun) {
      if ($0 ~ /^[[:space:]]*$/) next
      if (indent($0) > run_indent) {
        if ($0 ~ /\$\{\{/) printf "%s:%d: %s\n", FILENAME, FNR, $0
        next
      }
      inrun = 0
    }
    if ($0 ~ /^[[:space:]]*(-[[:space:]]+)?run:[[:space:]]*[|>]/) {
      inrun = 1
      run_indent = indent($0)
      next
    }
    if ($0 ~ /^[[:space:]]*(-[[:space:]]+)?run:/ && $0 ~ /\$\{\{/) {
      printf "%s:%d: %s\n", FILENAME, FNR, $0
    }
  }
' "${workflows[@]}")"
if [ -n "$script_injections" ]; then
  fail "a \${{ }} expression is interpolated into a run: body; pass it via env: instead:"
  printf '%s\n' "$script_injections" >&2
else
  pass "no \${{ }} expression is interpolated into a run: body"
fi

# --------------------------------------------------------------------------
# 5. Guardrails: safe triggers, and CI enforces this script.
# --------------------------------------------------------------------------
if grep -qE '^[[:space:]]*pull_request_target[[:space:]]*:' "${workflows[@]}" 2>/dev/null; then
  fail "pull_request_target is used; it gives a fork PR a writable token"
else
  pass "no workflow uses pull_request_target"
fi

if grep -q 'scripts/check-workflows\.sh' .github/workflows/ci.yml 2>/dev/null; then
  pass "ci.yml runs scripts/check-workflows.sh"
else
  fail "ci.yml does not run scripts/check-workflows.sh, so these checks are not enforced"
fi

# Documentation must not advertise a release path that no longer exists (a
# mention that `.gitea/workflows/` is empty is fine; naming a workflow in it is
# not).
if grep -qE '\.gitea/workflows/[A-Za-z0-9_.-]' README.md AGENTS.md 2>/dev/null; then
  fail "README.md/AGENTS.md still describe the removed Gitea release workflow"
else
  pass "README.md and AGENTS.md describe a single release pipeline"
fi

if [ "$status" -eq 0 ]; then
  printf '\ncheck-workflows: all checks passed\n'
else
  printf '\ncheck-workflows: FAILED\n' >&2
fi
exit "$status"
