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
#   6. The bundled PostgreSQL / MariaDB tool inputs are pinned and
#      cryptographically verified (digest or exact commit), a mismatch fails
#      the build, cached archives are verified rather than trusted, and the
#      packaged tool manifests are checked before anything is uploaded
#      (ticket 44, "Release inputs are verified").
#   7. The Homebrew cask renderer validates its metadata — version and
#      checksums — against the release tag and the published DMGs, and refuses
#      anything that could alter the cask's structure (ticket 46, "Cask
#      rendering validates inputs").
#   8. macOS signing/notarization fails CLOSED: a release without working Apple
#      credentials stops before it builds, the built .app and .dmg are verified
#      (codesign/stapler/spctl) after signing and stapling, and only verified
#      artifacts are uploaded (ticket 45, "macOS signing fails closed").
#   9. Dependency automation and cross-platform coverage: Dependabot is
#      configured for every graph Gridline resolves (both Bun lockfiles + cargo),
#      the advisory and lockfile gates are wired into the pull-request pipeline
#      and cannot be swallowed, and the CI platform matrix covers every target
#      release.yml builds (ticket 48, "Dependency automation and cross-platform
#      checks").
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

# --------------------------------------------------------------------------
# 6. Bundled tool inputs: pinned, verified, fail closed, gated before upload.
# --------------------------------------------------------------------------
inputs_file="scripts/tool-inputs.env"
fetch_script="scripts/verified-fetch.sh"
manifest_script="scripts/verify-bundled-tools.sh"
release_wf=".github/workflows/release.yml"

inputs_ok=1
for f in "$inputs_file" "$fetch_script" "$manifest_script" "$release_wf"; do
  if [ ! -f "$f" ]; then
    fail "missing $f (bundled tool inputs cannot be pinned or verified)"
    inputs_ok=0
  fi
done
for f in "$fetch_script" "$manifest_script"; do
  [ -f "$f" ] || continue
  [ -x "$f" ] || { fail "$f is not executable"; inputs_ok=0; }
  bash -n "$f" 2>/dev/null || { fail "$f has a syntax error"; inputs_ok=0; }
done
if [ -f "$inputs_file" ]; then
  bash -n "$inputs_file" 2>/dev/null || { fail "$inputs_file is not valid shell"; inputs_ok=0; }

  # Every declared digest is a full SHA-256, and every input URL is https.
  bad_pins="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*_SHA(1|256|512)=' "$inputs_file" |
    grep -Ev '="[0-9a-f]{64}"' || true)"
  if [ -n "$bad_pins" ]; then
    fail "a tool-input digest is not a full lowercase SHA-256:"
    printf '%s\n' "$bad_pins" >&2
    inputs_ok=0
  fi
  bad_urls="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*_URL=' "$inputs_file" |
    grep -Ev '="https://' || true)"
  if [ -n "$bad_urls" ]; then
    fail "a tool-input URL is not https (the transport must be authenticated too):"
    printf '%s\n' "$bad_urls" >&2
    inputs_ok=0
  fi

  # Both toolchains need a version pin, and the git-sourced one additionally an
  # exact commit (a tag alone is a moving target).
  for pin in PG_TOOLS_VERSION MARIADB_TOOLS_VERSION; do
    if grep -qE "^${pin}=\"[^\"]+\"" "$inputs_file"; then
      : # present
    else
      fail "$inputs_file has no ${pin} pin"
      inputs_ok=0
    fi
  done
  if grep -qE '^MARIADB_GIT_COMMIT="[0-9a-f]{40}"$' "$inputs_file"; then
    : # present
  else
    fail "$inputs_file has no exact 40-character MARIADB_GIT_COMMIT pin"
    inputs_ok=0
  fi

  # No floating pins: a pin has to identify one immutable artifact.
  floating="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*_(VERSION|TAG|COMMIT)=' "$inputs_file" |
    grep -Ei '(latest|current|master|head|main|nightly|edge|stable)' || true)"
  if [ -n "$floating" ]; then
    fail "a tool-input pin follows a moving target instead of an immutable revision:"
    printf '%s\n' "$floating" >&2
    inputs_ok=0
  fi
fi

# The workflow may not download tool inputs itself: no upstream host, no direct
# curl, no inline digest. Everything goes through scripts/tool-inputs.env +
# scripts/verified-fetch.sh, which is the only code that verifies a digest.
if [ -f "$release_wf" ]; then
  tool_region="$(awk '
    /name: Build PostgreSQL client tools \(bundled\)/ { inregion = 1 }
    /name: Build and upload to GitHub Release/ { inregion = 0 }
    inregion { print }
  ' "$release_wf")"
  if [ -z "$tool_region" ]; then
    fail "release.yml has no identifiable bundled-tool build region"
    inputs_ok=0
  else
    upstream="$(printf '%s\n' "$tool_region" |
      grep -E 'ftp\.postgresql\.org|get\.enterprisedb\.com|archive\.mariadb\.org|github\.com/MariaDB' || true)"
    if [ -n "$upstream" ]; then
      fail "release.yml names an upstream tool host directly; pin it in scripts/tool-inputs.env:"
      printf '%s\n' "$upstream" >&2
      inputs_ok=0
    fi
    if printf '%s\n' "$tool_region" | grep -q '\bcurl\b'; then
      fail "release.yml downloads a tool input with curl instead of scripts/verified-fetch.sh"
      inputs_ok=0
    fi
    if printf '%s\n' "$tool_region" | grep -Eq '[0-9a-f]{64}'; then
      fail "release.yml contains an inline digest; the pins belong in scripts/tool-inputs.env"
      inputs_ok=0
    fi

    # Each pinned input is actually retrieved through the verifier.
    for var in PG_SOURCE_URL PG_WINDOWS_PACKAGE_URL MARIADB_WINDOWS_PACKAGE_URL; do
      printf '%s\n' "$tool_region" | grep -q "${var}" ||
        { fail "release.yml never fetches \$${var} through scripts/verified-fetch.sh"; inputs_ok=0; }
    done
    printf '%s\n' "$tool_region" | grep -q 'MARIADB_GIT_COMMIT' ||
      { fail "release.yml does not verify MARIADB_GIT_COMMIT before building"; inputs_ok=0; }
    fetches="$(printf '%s\n' "$tool_region" | grep -c 'verified-fetch\.sh" fetch' || true)"
    if [ "${fetches:-0}" -lt 3 ]; then
      fail "release.yml performs only ${fetches:-0} verified fetch(es); every platform's inputs must be verified"
      inputs_ok=0
    fi
    printf '%s\n' "$tool_region" | grep -q 'verified-fetch\.sh" commit' ||
      { fail "release.yml does not verify the pinned git commit of a source-built tool"; inputs_ok=0; }

    # Fail closed: no success-swallowing on a verification call.
    swallowed="$(printf '%s\n' "$tool_region" | grep 'verified-fetch' |
      grep -E '\|\|[[:space:]]*(true|:|echo|exit 0)' || true)"
    if [ -n "$swallowed" ]; then
      fail "a tool-input verification is allowed to fail without stopping the build:"
      printf '%s\n' "$swallowed" >&2
      inputs_ok=0
    fi
    steps_with_errexit="$(printf '%s\n' "$tool_region" | grep -c 'set -euo pipefail' || true)"
    if [ "${steps_with_errexit:-0}" -lt 3 ]; then
      fail "a bundled-tool step does not run under 'set -euo pipefail', so a failed check cannot stop the build"
      inputs_ok=0
    fi

    # Cached archives: the cache exists AND its contents are re-verified.
    grep -q "hashFiles('scripts/tool-inputs.env')" "$release_wf" ||
      { fail "the tool-input cache key does not include scripts/tool-inputs.env"; inputs_ok=0; }
    grep -q 'path: \${{ runner.temp }}/gridline-tool-inputs' "$release_wf" ||
      { fail "no cache step for the pinned tool inputs (path: \${{ runner.temp }}/gridline-tool-inputs)"; inputs_ok=0; }
    printf '%s\n' "$tool_region" | grep -q 'TOOL_INPUT_CACHE' ||
      { fail "the tool build steps do not read the tool-input cache directory, so a restore would be unused"; inputs_ok=0; }
    # A archive taken from the cache must be handed to the verifier, never
    # expanded straight out of the cache directory.
    direct_cache_use="$(printf '%s\n' "$tool_region" |
      grep -E '^[[:space:]]*(sudo[[:space:]]+)?(unzip|tar)[[:space:]]' |
      grep 'TOOL_INPUT_CACHE' || true)"
    if [ -n "$direct_cache_use" ]; then
      fail "a cached archive is expanded without being verified first:"
      printf '%s\n' "$direct_cache_use" >&2
      inputs_ok=0
    fi
    for var in PG_TARBALL PG_ZIP MARIADB_ZIP; do
      printf '%s\n' "$tool_region" | grep -q "verified-fetch\.sh\" fetch .*\"\$${var}\"" ||
        { fail "\$${var} is not fetched through scripts/verified-fetch.sh"; inputs_ok=0; }
    done

    # The packaged manifests are checked BEFORE the upload step.
    gate_line="$(grep -n 'name: Verify bundled tool manifests' "$release_wf" | head -n 1 | cut -d: -f1)"
    upload_line="$(grep -n 'uses: tauri-apps/tauri-action@' "$release_wf" | head -n 1 | cut -d: -f1)"
    if [ -z "$gate_line" ]; then
      fail "release.yml has no 'Verify bundled tool manifests' step"
      inputs_ok=0
    elif [ -z "$upload_line" ] || [ "$gate_line" -ge "$upload_line" ]; then
      fail "'Verify bundled tool manifests' does not run before the upload step"
      inputs_ok=0
    elif ! printf '%s\n' "$tool_region" | grep -q 'verify-bundled-tools\.sh'; then
      fail "the manifest gate step does not run scripts/verify-bundled-tools.sh"
      inputs_ok=0
    fi
  fi
fi
[ "$inputs_ok" = "1" ] && pass "bundled tool inputs are pinned, verified and gated before upload"

# Behavioural check: the verifier accepts pinned bytes and refuses everything
# else — a tampered file, a poisoned cache entry, a non-https source, a moved
# git tag. No network: the download path is never reached.
fetch_behaviour() {
  local tmp rc
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/gridline-fetch-check.XXXXXX")" || return 1
  (
    set -uo pipefail
    cd "$tmp" || exit 1
    fetch="$repo_root/scripts/verified-fetch.sh"
    printf 'pinned payload\n' > good.bin || exit 1
    good="$("$fetch" sha256 good.bin)" || exit 1
    [ -n "$good" ] || exit 1
    # A file whose digest matches the pin verifies.
    "$fetch" check good.bin "$good" >/dev/null || exit 1
    # A tampered file is rejected.
    printf 'tampered payload\n' > bad.bin || exit 1
    if "$fetch" check bad.bin "$good" >/dev/null 2>&1; then exit 1; fi
    # A missing file is rejected.
    if "$fetch" check absent.bin "$good" >/dev/null 2>&1; then exit 1; fi
    # A cached archive with the right digest is used (cache hit, no download).
    mkdir -p cache || exit 1
    cp good.bin cache/pinned.bin || exit 1
    "$fetch" fetch https://example.invalid/pinned.bin "$good" cache/pinned.bin >/dev/null || exit 1
    # A poisoned cache entry is refused, not trusted and not silently replaced.
    printf 'poisoned\n' > cache/poisoned.bin || exit 1
    if "$fetch" fetch https://example.invalid/poisoned.bin "$good" cache/poisoned.bin >/dev/null 2>&1; then exit 1; fi
    [ "$(cat cache/poisoned.bin)" = "poisoned" ] || exit 1
    # A plain-http source is refused before anything is downloaded.
    if "$fetch" fetch http://example.invalid/x.bin "$good" cache/x.bin >/dev/null 2>&1; then exit 1; fi
    [ ! -e cache/x.bin ] || exit 1
    # The pinned git commit is verified; any other commit is refused.
    mkdir repo || exit 1
    git -C repo init -q || exit 1
    git -C repo -c user.email=check@gridline.invalid -c user.name=check \
      commit -q --allow-empty -m one || exit 1
    sha="$(git -C repo rev-parse HEAD)" || exit 1
    "$fetch" commit repo "$sha" >/dev/null || exit 1
    if "$fetch" commit repo 1111111111111111111111111111111111111111 >/dev/null 2>&1; then exit 1; fi
  )
  rc=$?
  rm -rf "$tmp"
  return "$rc"
}

fetch_behaviour
if [ $? -eq 0 ]; then
  pass "verified-fetch accepts pinned bytes and refuses tampering, poisoned caches, non-https sources and moved tags"
else
  fail "scripts/verified-fetch.sh no longer verifies its inputs (run it by hand to debug)"
fi

# Behavioural check: the packaged-manifest gate passes an honest bundle and
# fails a tampered binary, a missing tool, an unexpected extra file, and a tool
# that reports a different version. All against synthetic tools, no toolchain.
manifest_behaviour() {
  local tmp rc
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/gridline-manifest-check.XXXXXX")" || return 1
  (
    set -uo pipefail
    cd "$tmp" || exit 1
    fetch="$repo_root/scripts/verified-fetch.sh"
    verify="$repo_root/scripts/verify-bundled-tools.sh"
    resources="$tmp/resources"
    conf="$tmp/tauri.conf.json"
    mkdir -p "$resources/pg_tools" "$resources/mysql_tools" || exit 1
    printf '{"bundle":{"resources":["resources/pg_tools/*","resources/mysql_tools/*"]}}\n' > "$conf" || exit 1

    write_tool() { # <path> <version line>
      printf '#!/bin/sh\necho "%s"\n' "$2" > "$1" || return 1
      chmod +x "$1"
    }
    # Manifest exactly like the build step: `sha256sum *` over the directory.
    write_manifest() { # <dir>
      local d="$1" f
      : > "$d/checksums.txt.new" || return 1
      for f in "$d"/*; do
        [ -f "$f" ] || continue
        [ "$(basename "$f")" = "checksums.txt.new" ] && continue
        printf '%s  %s\n' "$("$fetch" sha256 "$f")" "$(basename "$f")" >> "$d/checksums.txt.new" || return 1
      done
      mv "$d/checksums.txt.new" "$d/checksums.txt"
    }
    build_bundle() {
      local t
      for t in pg_dump pg_restore psql; do
        write_tool "$resources/pg_tools/$t" "$t (PostgreSQL) 16.4" || return 1
      done
      for t in mariadb-dump mariadb; do
        write_tool "$resources/mysql_tools/$t" "$t  Ver 10.19  Distrib 11.4.5-MariaDB, for test" || return 1
      done
      write_manifest "$resources/pg_tools" || return 1
      write_manifest "$resources/mysql_tools"
    }

    build_bundle || exit 1
    # An honest bundle passes.
    "$verify" --resources "$resources" --conf "$conf" >/dev/null || exit 1

    # A binary swapped after the manifest was written fails.
    out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)" || true
    printf '#!/bin/sh\necho "pg_dump (PostgreSQL) 16.4"\necho swapped\n' > "$resources/pg_tools/pg_dump"
    if out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)"; then exit 1; fi
    printf '%s' "$out" | grep -q 'does not match its manifest digest' || exit 1

    # A missing required tool fails.
    build_bundle || exit 1
    rm -f "$resources/pg_tools/psql"
    if out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)"; then exit 1; fi
    printf '%s' "$out" | grep -q 'required tool psql is not bundled' || exit 1

    # An unexpected extra executable fails.
    build_bundle || exit 1
    write_tool "$resources/pg_tools/pg_smuggled" "pg_smuggled" || exit 1
    if out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)"; then exit 1; fi
    printf '%s' "$out" | grep -q 'is in the bundle but not in checksums.txt' || exit 1

    # A tool built from a different source (wrong reported version) fails, even
    # when the manifest was regenerated over it.
    build_bundle || exit 1
    write_tool "$resources/pg_tools/pg_dump" "pg_dump (PostgreSQL) 15.1" || exit 1
    write_manifest "$resources/pg_tools" || exit 1
    if out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)"; then exit 1; fi
    printf '%s' "$out" | grep -q 'does not report pinned version 16.4' || exit 1

    # A bundle config that would not ship the verified tools fails.
    build_bundle || exit 1
    printf '{"bundle":{"resources":["resources/pg_tools/*"]}}\n' > "$conf"
    if out="$("$verify" --resources "$resources" --conf "$conf" 2>&1)"; then exit 1; fi
    printf '%s' "$out" | grep -q 'does not bundle resources/mysql_tools' || exit 1
  )
  rc=$?
  rm -rf "$tmp"
  return "$rc"
}

manifest_behaviour
if [ $? -eq 0 ]; then
  pass "the manifest gate passes an honest bundle and fails tampered, missing, extra or wrong-version tools"
else
  fail "scripts/verify-bundled-tools.sh no longer gates the packaged manifests (run it by hand to debug)"
fi

# --------------------------------------------------------------------------
# 7. Cask rendering validates its inputs (ticket 46).
# --------------------------------------------------------------------------
cask_ok=1
for f in scripts/render-cask.sh scripts/render-cask.test.sh packaging/homebrew/gridline.rb.template; do
  if [ ! -f "$f" ]; then
    fail "missing $f (the Homebrew cask can no longer be validated)"
    cask_ok=0
  fi
done
for f in scripts/render-cask.sh scripts/render-cask.test.sh; do
  [ -f "$f" ] || continue
  [ -x "$f" ] || { fail "$f is not executable"; cask_ok=0; }
  bash -n "$f" 2>/dev/null || { fail "$f has a syntax error"; cask_ok=0; }
done
# The release pipeline must hand the renderer the release tag and the DMGs it
# downloaded, so the published cask can only describe the published artifacts.
for flag in --tag '"$RELEASE_TAG"' --dmg-arm --dmg-intel; do
  grep -q -F -- "$flag" "$release_wf" 2>/dev/null ||
    { fail "release.yml does not pass $flag to scripts/render-cask.sh"; cask_ok=0; }
done
[ "$cask_ok" = "1" ] && pass "cask rendering is wired to the release tag and the downloaded DMGs"

# Behavioural check: valid metadata renders the template unchanged apart from
# the three values; hostile or inconsistent metadata fails closed with no
# partial cask on stdout.
cask_behaviour() {
  local out rc
  out="$(mktemp "${TMPDIR:-/tmp}/gridline-cask-check.XXXXXX")" || return 1
  scripts/render-cask.test.sh >"$out" 2>&1
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf -- '--- scripts/render-cask.test.sh (failures) ---\n' >&2
    grep '^FAIL' "$out" >&2 || cat "$out" >&2
  fi
  rm -f "$out"
  return "$rc"
}

cask_behaviour
if [ $? -eq 0 ]; then
  pass "cask rendering accepts valid metadata and refuses hostile or inconsistent inputs"
else
  fail "scripts/render-cask.sh no longer validates its inputs (run scripts/render-cask.test.sh)"
fi

# --------------------------------------------------------------------------
# 8. macOS signing/notarization fails closed (ticket 45).
# --------------------------------------------------------------------------
mac_script="scripts/release-mac.sh"
mac_verify_script="scripts/verify-macos-artifacts.sh"
mac_creds_script="scripts/require-macos-signing-credentials.sh"
mac_ok=1

# step_region <workflow> <step name fragment> — the lines of one workflow step:
# from its `- name:` line up to (but excluding) the next step.
step_region() {
  awk -v want="$2" '
    /^      - name:/ {
      if (started) exit
      if (index($0, "name: " want) > 0) started = 1
    }
    started { print }
  ' "$1"
}

for f in "$mac_verify_script" "$mac_creds_script" "$mac_script"; do
  if [ ! -f "$f" ]; then
    fail "missing $f (macOS signing/notarization cannot be enforced or verified)"
    mac_ok=0
    continue
  fi
  [ -x "$f" ] || { fail "$f is not executable"; mac_ok=0; }
  bash -n "$f" 2>/dev/null || { fail "$f has a syntax error"; mac_ok=0; }
done

# 8a. Credentials are REQUIRED on macOS runners, before anything is built.
mac_secrets="APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY KEYCHAIN_PASSWORD APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_CONTENT"
gate_region="$(step_region "$release_wf" 'Require Apple signing and notarization secrets')"
if [ -z "$gate_region" ]; then
  fail "release.yml has no 'Require Apple signing and notarization secrets' step, so a macOS release can be built ad-hoc signed"
  mac_ok=0
else
  printf '%s\n' "$gate_region" | grep -q 'require-macos-signing-credentials\.sh' ||
    { fail "the macOS credential gate does not run scripts/require-macos-signing-credentials.sh"; mac_ok=0; }
  for secret in $mac_secrets; do
    printf '%s\n' "$gate_region" | grep -q "secrets\.${secret}" ||
      { fail "the macOS credential gate does not require the ${secret} secret"; mac_ok=0; }
  done
  printf '%s\n' "$gate_region" | grep -q "startsWith(matrix.platform, 'macos')" ||
    { fail "the macOS credential gate is not restricted to macOS runners (it would fail the Linux/Windows jobs)"; mac_ok=0; }
fi

# No step may downgrade absent Apple credentials to a notice/warning, and no
# step may be allowed to fail without failing the job.
downgrades="$(grep -n '::notice::\|::warning::' "$release_wf" 2>/dev/null |
  grep -i 'apple\|macos\|notariz\|ad-hoc\|sign' || true)"
if [ -n "$downgrades" ]; then
  fail "release.yml downgrades macOS signing/notarization to a notice or warning instead of failing:"
  printf '%s\n' "$downgrades" >&2
  mac_ok=0
fi
if grep -q 'continue-on-error' "$release_wf" 2>/dev/null; then
  fail "release.yml uses continue-on-error, so a failed step can still publish"
  mac_ok=0
fi

# 8b. The macOS build must NOT upload: verification has to come first.
mac_build_name='Build macOS bundles (no release upload)'
mac_build_region="$(step_region "$release_wf" "$mac_build_name")"
if [ -z "$mac_build_region" ]; then
  fail "release.yml has no '${mac_build_name}' step, so macOS is built and uploaded in one step and cannot be verified first"
  mac_ok=0
else
  printf '%s\n' "$mac_build_region" | grep -q 'uses: tauri-apps/tauri-action@' ||
    { fail "the macOS build step no longer builds with tauri-action"; mac_ok=0; }
  # Keys, not comments: the step may *explain* why there is no tagName.
  if printf '%s\n' "$mac_build_region" | sed 's/#.*//' |
    grep -Eq '(^|[[:space:]])(tagName|releaseName|releaseId)[[:space:]]*:'; then
    fail "the macOS build step can upload (tagName/releaseName/releaseId is set); it must build only"
    mac_ok=0
  fi
  printf '%s\n' "$mac_build_region" | grep -q "startsWith(matrix.platform, 'macos')" ||
    { fail "the macOS-only build step is not restricted to macOS runners"; mac_ok=0; }
fi

# 8c. Verification covers the .app AND the .dmg, and cannot be swallowed.
mac_verify_region="$(step_region "$release_wf" 'Verify signed and notarized macOS artifacts')"
if [ -z "$mac_verify_region" ]; then
  fail "release.yml has no 'Verify signed and notarized macOS artifacts' step"
  mac_ok=0
else
  printf '%s\n' "$mac_verify_region" | grep -q 'verify-macos-artifacts\.sh' ||
    { fail "the macOS verification step does not run scripts/verify-macos-artifacts.sh"; mac_ok=0; }
  printf '%s\n' "$mac_verify_region" | grep -q "startsWith(matrix.platform, 'macos')" ||
    { fail "the macOS verification step is not restricted to macOS runners"; mac_ok=0; }
  printf '%s\n' "$mac_verify_region" | grep -q 'id: verify_macos' ||
    { fail "the macOS verification step publishes no output, so the upload cannot use the verified list"; mac_ok=0; }
  swallowed="$(printf '%s\n' "$mac_verify_region" |
    grep -E 'codesign|spctl|stapler|notarytool|verify-macos-artifacts' |
    grep -E '\|\|[[:space:]]*(true|:|echo|exit 0)|continue-on-error' || true)"
  if [ -n "$swallowed" ]; then
    fail "a macOS signature/notarization check is allowed to fail without stopping the job:"
    printf '%s\n' "$swallowed" >&2
    mac_ok=0
  fi
fi

# The verifier itself must check both artifact kinds, not just the .app.
if [ -f "$mac_verify_script" ]; then
  for needle in \
    'codesign --verify' \
    'Authority=Developer ID Application' \
    'Signature=adhoc' \
    'xcrun stapler staple' \
    'xcrun stapler validate' \
    'xcrun notarytool submit' \
    '--type execute' \
    '--type open'; do
    grep -qF -- "$needle" "$mac_verify_script" ||
      { fail "scripts/verify-macos-artifacts.sh does not check '${needle}'"; mac_ok=0; }
  done
  swallowed="$(grep -E 'codesign|spctl|stapler|notarytool' "$mac_verify_script" |
    grep -E '\|\|[[:space:]]*(true|:|echo|exit 0)' || true)"
  if [ -n "$swallowed" ]; then
    fail "scripts/verify-macos-artifacts.sh swallows a verification failure:"
    printf '%s\n' "$swallowed" >&2
    mac_ok=0
  fi
fi

# 8d. Nothing is uploaded before verification, and the upload uses only the
# verified paths.
mac_upload_region="$(step_region "$release_wf" 'Upload verified macOS installers')"
mac_build_line="$(grep -n "name: ${mac_build_name}" "$release_wf" | head -n 1 | cut -d: -f1)"
mac_verify_line="$(grep -n 'name: Verify signed and notarized macOS artifacts' "$release_wf" | head -n 1 | cut -d: -f1)"
mac_upload_line="$(grep -n 'name: Upload verified macOS installers' "$release_wf" | head -n 1 | cut -d: -f1)"
if [ -z "$mac_upload_region" ]; then
  fail "release.yml has no 'Upload verified macOS installers' step, so verified macOS artifacts are never published"
  mac_ok=0
else
  printf '%s\n' "$mac_upload_region" | grep -q 'steps.verify_macos.outputs.assets' ||
    { fail "the macOS upload step does not upload exactly the paths the verifier accepted"; mac_ok=0; }
  printf '%s\n' "$mac_upload_region" | grep -q "startsWith(matrix.platform, 'macos')" ||
    { fail "the macOS upload step is not restricted to macOS runners"; mac_ok=0; }
  if [ -z "$mac_build_line" ] || [ -z "$mac_verify_line" ] || [ -z "$mac_upload_line" ]; then
    fail "could not locate the macOS build/verify/upload steps to check their order"
    mac_ok=0
  elif [ "$mac_build_line" -ge "$mac_verify_line" ] || [ "$mac_verify_line" -ge "$mac_upload_line" ]; then
    fail "the macOS upload step does not run after verification"
    mac_ok=0
  fi
fi

# The combined build+upload step is what makes an unverified artifact possible,
# so it must never run on a macOS runner.
coupled_region="$(step_region "$release_wf" 'Build and upload to GitHub Release')"
if [ -z "$coupled_region" ]; then
  fail "release.yml no longer has the non-macOS 'Build and upload to GitHub Release' step"
  mac_ok=0
elif ! printf '%s\n' "$coupled_region" | grep -q "!startsWith(matrix.platform, 'macos')"; then
  fail "the build+upload step is not excluded from macOS runners, so macOS could be uploaded unverified"
  mac_ok=0
fi

# 8e. The documented local fallback makes the same guarantees.
if [ -f "$mac_script" ]; then
  if grep -q 'GRIDLINE_SKIP_NOTARIZE' "$mac_script"; then
    fail "scripts/release-mac.sh still has a skip-notarization escape hatch"
    mac_ok=0
  fi
  grep -q 'require-macos-signing-credentials\.sh' "$mac_script" ||
    { fail "scripts/release-mac.sh does not require notarization credentials"; mac_ok=0; }
  grep -q 'verify-macos-artifacts\.sh' "$mac_script" ||
    { fail "scripts/release-mac.sh does not verify the signed artifacts before uploading"; mac_ok=0; }
  creds_line="$(grep -n 'require-macos-signing-credentials\.sh' "$mac_script" | head -n 1 | cut -d: -f1)"
  build_line="$(grep -n 'tauri build' "$mac_script" | head -n 1 | cut -d: -f1)"
  if [ -n "$creds_line" ] && [ -n "$build_line" ] && [ "$creds_line" -ge "$build_line" ]; then
    fail "scripts/release-mac.sh only demands credentials after the build, so a broken setup wastes a full build"
    mac_ok=0
  fi
fi

# 8f. Published claims match the pipeline: nothing may describe a notarized
# macOS artifact that is nevertheless ad-hoc signed (the old fail-open path).
mac_claims="$(grep -Ein 'ad-hoc|adhoc' README.md AGENTS.md SECURITY.md 2>/dev/null |
  grep -i 'notariz' || true)"
if [ -n "$mac_claims" ]; then
  fail "documentation still describes an ad-hoc/unnotarized macOS release next to a notarization claim:"
  printf '%s\n' "$mac_claims" >&2
  mac_ok=0
fi

[ "$mac_ok" = "1" ] && pass "macOS signing/notarization fails closed: credentials are required, .app + .dmg are verified and only verified artifacts are uploaded"

# Behavioural check: the credential gate accepts a complete set and refuses an
# incomplete one without leaking a value.
mac_creds_behaviour() {
  local out
  (
    set -uo pipefail
    creds="$repo_root/scripts/require-macos-signing-credentials.sh"
    [ -x "$creds" ] || exit 1

    # Every secret set: passes.
    env APPLE_CERTIFICATE=c APPLE_CERTIFICATE_PASSWORD=p \
      APPLE_SIGNING_IDENTITY="Developer ID Application: T (TEAMID)" \
      KEYCHAIN_PASSWORD=k APPLE_API_KEY=a APPLE_API_ISSUER=i \
      APPLE_API_KEY_CONTENT=key "$creds" >/dev/null || exit 1

    # One secret missing: fails, names it, and never prints a value.
    out="$(env -u APPLE_API_ISSUER APPLE_CERTIFICATE=certificate-value \
      APPLE_CERTIFICATE_PASSWORD=p APPLE_SIGNING_IDENTITY=identity \
      KEYCHAIN_PASSWORD=k APPLE_API_KEY=a APPLE_API_KEY_CONTENT=key "$creds" 2>&1)" && exit 1
    printf '%s' "$out" | grep -q 'APPLE_API_ISSUER' || exit 1
    if printf '%s' "$out" | grep -q 'certificate-value'; then exit 1; fi

    # Nothing set at all: fails.
    if env -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD \
      -u APPLE_SIGNING_IDENTITY -u KEYCHAIN_PASSWORD -u APPLE_API_KEY \
      -u APPLE_API_ISSUER -u APPLE_API_KEY_CONTENT "$creds" >/dev/null 2>&1; then
      exit 1
    fi

    # An explicit set works, and a missing member of it fails.
    env GRIDLINE_TEST_CRED=1 "$creds" GRIDLINE_TEST_CRED >/dev/null || exit 1
    if env GRIDLINE_TEST_CRED=1 "$creds" GRIDLINE_TEST_CRED GRIDLINE_TEST_OTHER >/dev/null 2>&1; then
      exit 1
    fi

    # Anything that is not a variable name is refused, not evaluated.
    if env GRIDLINE_TEST_CRED=1 "$creds" 'GRIDLINE_TEST_CRED; echo pwned' >/dev/null 2>&1; then
      exit 1
    fi
  )
  local rc=$?
  return "$rc"
}

mac_creds_behaviour
if [ $? -eq 0 ]; then
  pass "the macOS credential gate passes a complete set and refuses an incomplete one without printing values"
else
  fail "scripts/require-macos-signing-credentials.sh no longer fails closed (run it by hand to debug)"
fi

# Behavioural check: the artifact verifier accepts a properly signed, stapled
# and accepted pair and refuses an ad-hoc signature, a broken signature, a
# missing hardened runtime/timestamp, an unstapled app, a missing disk image,
# a rejected Gatekeeper assessment and a failed notarization. Synthetic
# artifacts and fake macOS tools, so this runs on the Linux CI runner too.
macos_verify_behaviour() {
  local tmp rc
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/gridline-macos-verify-check.XXXXXX")" || return 1
  (
    set -uo pipefail
    cd "$tmp" || exit 1
    verify="$repo_root/scripts/verify-macos-artifacts.sh"
    [ -x "$verify" ] || exit 1

    mkdir -p bin bundle/macos/Gridline.app bundle/dmg || exit 1
    : > key.p8 || exit 1
    printf '{\n  "productName": "Gridline",\n  "version": "0.0.0"\n}\n' > conf.json || exit 1
    : > bundle/dmg/Gridline_0.0.0_aarch64.dmg || exit 1

    # Fake macOS toolchain. Behaviour is driven by environment variables so one
    # fake can stand in for a correct signature and every broken one.
    cat > bin/codesign <<'FAKE_CODESIGN'
#!/bin/sh
case "$1" in
  --verify) exit "${FAKE_CODESIGN_VERIFY:-0}" ;;
  --display)
    echo "Executable=$3/Contents/MacOS/Gridline"
    if [ "${FAKE_CODESIGN_ADHOC:-0}" = "1" ]; then
      echo "Signature=adhoc"
      echo "flags=0x0(none)"
      exit 0
    fi
    echo "Authority=Developer ID Application: Gridline Test (TEAMID123)"
    echo "Authority=Developer ID Certification Authority"
    echo "Authority=Apple Root CA"
    if [ "${FAKE_CODESIGN_TIMESTAMP:-1}" = "1" ]; then
      echo "Timestamp=Jan 1, 2026 at 00:00:00"
    fi
    if [ "${FAKE_CODESIGN_RUNTIME:-1}" = "1" ]; then
      echo "flags=0x10000(runtime)"
    else
      echo "flags=0x0(none)"
    fi
    exit 0 ;;
esac
exit 0
FAKE_CODESIGN

    cat > bin/xcrun <<'FAKE_XCRUN'
#!/bin/sh
case "$1 $2" in
  "stapler validate") exit "${FAKE_STAPLER_VALIDATE:-0}" ;;
  "stapler staple") exit "${FAKE_STAPLER_STAPLE:-0}" ;;
  "notarytool submit") exit "${FAKE_NOTARYTOOL:-0}" ;;
esac
exit 1
FAKE_XCRUN

    cat > bin/spctl <<'FAKE_SPCTL'
#!/bin/sh
exit "${FAKE_SPCTL:-0}"
FAKE_SPCTL
    chmod +x bin/codesign bin/xcrun bin/spctl || exit 1

    run_verify() {
      env PATH="$tmp/bin:$PATH" \
        GRIDLINE_MACOS_VERIFY_ATTEMPTS=1 GRIDLINE_MACOS_VERIFY_DELAY=0 \
        APPLE_API_KEY=keyid APPLE_API_ISSUER=issuer APPLE_API_KEY_PATH="$tmp/key.p8" \
        "$@" \
        "$verify" --target aarch64-apple-darwin --bundle "$tmp/bundle" --conf "$tmp/conf.json"
    }

    # Honest artifacts: passes and prints exactly the disk image.
    out="$(run_verify 2>/dev/null)" || exit 1
    printf '%s\n' "$out" | grep -q 'bundle/dmg/Gridline_0.0.0_aarch64.dmg' || exit 1

    # Ad-hoc signature (valid signature, wrong identity): refused.
    out="$(run_verify FAKE_CODESIGN_ADHOC=1 2>&1)" && exit 1
    printf '%s' "$out" | grep -q 'Developer ID Application identity' || exit 1

    # Broken signature: refused.
    if run_verify FAKE_CODESIGN_VERIFY=1 >/dev/null 2>&1; then exit 1; fi

    # No hardened runtime: refused.
    out="$(run_verify FAKE_CODESIGN_RUNTIME=0 2>&1)" && exit 1
    printf '%s' "$out" | grep -q 'hardened runtime' || exit 1

    # No secure timestamp: refused.
    out="$(run_verify FAKE_CODESIGN_TIMESTAMP=0 2>&1)" && exit 1
    printf '%s' "$out" | grep -q 'timestamp' || exit 1

    # .app without a stapled ticket: refused.
    if run_verify FAKE_STAPLER_VALIDATE=1 >/dev/null 2>&1; then exit 1; fi

    # Gatekeeper rejecting the .app: refused.
    if run_verify FAKE_SPCTL=1 >/dev/null 2>&1; then exit 1; fi

    # Failed notarization of the disk image: refused.
    if run_verify FAKE_NOTARYTOOL=1 >/dev/null 2>&1; then exit 1; fi

    # Disk image that could not be stapled: refused.
    if run_verify FAKE_STAPLER_STAPLE=1 >/dev/null 2>&1; then exit 1; fi

    # Missing disk image: refused.
    mv bundle/dmg/Gridline_0.0.0_aarch64.dmg dmg.moved || exit 1
    if run_verify >/dev/null 2>&1; then exit 1; fi
    mv dmg.moved bundle/dmg/Gridline_0.0.0_aarch64.dmg || exit 1

    # Missing application bundle: refused.
    mv bundle/macos/Gridline.app app.moved || exit 1
    if run_verify >/dev/null 2>&1; then exit 1; fi
    mv app.moved bundle/macos/Gridline.app || exit 1

    # Missing notarization credentials: refused (never skip notarization).
    if env -u APPLE_API_KEY -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH \
      PATH="$tmp/bin:$PATH" GRIDLINE_MACOS_VERIFY_ATTEMPTS=1 \
      GRIDLINE_MACOS_VERIFY_DELAY=0 \
      "$verify" --target aarch64-apple-darwin --bundle "$tmp/bundle" --conf "$tmp/conf.json" \
      >/dev/null 2>&1; then
      exit 1
    fi

    # An unexpected target triple is a usage error, not a silent pass.
    if env PATH="$tmp/bin:$PATH" GRIDLINE_MACOS_VERIFY_ATTEMPTS=1 \
      GRIDLINE_MACOS_VERIFY_DELAY=0 \
      APPLE_API_KEY=keyid APPLE_API_ISSUER=issuer APPLE_API_KEY_PATH="$tmp/key.p8" \
      "$verify" --target armv7-apple-ios --bundle "$tmp/bundle" --conf "$tmp/conf.json" \
      >/dev/null 2>&1; then
      exit 1
    fi
  )
  rc=$?
  rm -rf "$tmp"
  return "$rc"
}

macos_verify_behaviour
if [ $? -eq 0 ]; then
  pass "the macOS verifier accepts signed/notarized/stapled artifacts and refuses ad-hoc, unstapled, rejected or unnotarized ones"
else
  fail "scripts/verify-macos-artifacts.sh no longer fails closed (run it by hand to debug)"
fi

# --------------------------------------------------------------------------
# 9. Dependency automation and cross-platform coverage (ticket 48).
# --------------------------------------------------------------------------
# Dependency updates are only automated if Dependabot is told about every graph
# Gridline resolves. Those entries are not otherwise observable (a missing one
# just means silent staleness), so they are asserted here: one entry per
# lockfile — the workspace `bun.lock`, the standalone `www/bun.lock` the website
# deploy resolves, and `desktop/src-tauri/Cargo.lock`.
dep_ok=1
dependabot=".github/dependabot.yml"
lockfile_script="scripts/check-lockfiles.sh"
ci_wf=".github/workflows/ci.yml"

if [ ! -f "$dependabot" ]; then
  fail "missing $dependabot: dependency updates are not automated"
  dep_ok=0
else
  grep -q '^version:[[:space:]]*2' "$dependabot" ||
    { fail "$dependabot is not a version 2 Dependabot configuration"; dep_ok=0; }

  # Normalised "<ecosystem> <directory>" pairs, one per `updates:` entry.
  dep_pairs="$(awk '
    /^[[:space:]]*-[[:space:]]*package-ecosystem:/ {
      eco = $0
      sub(/.*package-ecosystem:[[:space:]]*/, "", eco)
      gsub(/["\047]/, "", eco)
    }
    /^[[:space:]]*directory:/ {
      dir = $0
      sub(/.*directory:[[:space:]]*/, "", dir)
      gsub(/["\047]/, "", dir)
      if (eco != "") print eco " " dir
    }
  ' "$dependabot")"

  for pair in "bun /" "bun /www" "cargo /desktop/src-tauri"; do
    if printf '%s\n' "$dep_pairs" | grep -qxF -- "$pair"; then
      :
    else
      fail "$dependabot has no entry for '${pair}' (package-ecosystem + directory), so that lockfile is not updated automatically"
      dep_ok=0
    fi
  done

  # Dependabot only updates the text `bun.lock`; a legacy binary lockfile would
  # silently drop the coverage asserted above.
  for lockfile in bun.lock www/bun.lock; do
    [ -f "$lockfile" ] ||
      { fail "missing $lockfile, so its Dependabot entry covers nothing"; dep_ok=0; }
  done
  for legacy in bun.lockb www/bun.lockb; do
    if [ -e "$legacy" ]; then
      fail "$legacy is a legacy binary Bun lockfile; Dependabot cannot update it"
      dep_ok=0
    fi
  done
fi

# The gates must be RUN, not reimplemented: the advisory audit and the lockfile
# check are single scripts that CI calls.
if [ ! -f "$ci_wf" ]; then
  fail "missing $ci_wf, so no gate is wired into pull requests"
  dep_ok=0
else
  grep -qE '^[[:space:]]*run:[[:space:]]*\./scripts/check-advisories\.py' "$ci_wf" ||
    { fail "ci.yml does not run scripts/check-advisories.py, so advisories are not gated"; dep_ok=0; }
  grep -qE '^[[:space:]]*run:[[:space:]]*\./scripts/check-lockfiles\.sh' "$ci_wf" ||
    { fail "ci.yml does not run scripts/check-lockfiles.sh, so the lockfile procedure is unverified"; dep_ok=0; }
  if grep -q 'continue-on-error' "$ci_wf"; then
    fail "ci.yml uses continue-on-error, so a failing gate (advisories, lockfiles, tests) could still pass"
    dep_ok=0
  fi
  # Nightly coverage: an advisory published after a run, or platform divergence,
  # has to surface during the cycle rather than at tag time.
  grep -qE '^[[:space:]]*schedule:' "$ci_wf" ||
    { fail "ci.yml has no schedule trigger, so advisories published after a run are never re-checked"; dep_ok=0; }
fi

if [ ! -f "$lockfile_script" ]; then
  fail "missing $lockfile_script (neither Bun lockfile would be verified)"
  dep_ok=0
else
  [ -x "$lockfile_script" ] || { fail "$lockfile_script is not executable"; dep_ok=0; }
  bash -n "$lockfile_script" 2>/dev/null || { fail "$lockfile_script has a syntax error"; dep_ok=0; }
fi

# The platform matrix has to cover exactly the targets the release builds: a
# platform release.yml ships but CI never compiles is discovered at tag time.
platform_job=""
if [ -f "$ci_wf" ]; then
  platform_job="$(awk '
    /^  platform:[[:space:]]*$/ { injob = 1 }
    injob && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ && $0 !~ /^  platform:[[:space:]]*$/ { injob = 0 }
    injob { print }
  ' "$ci_wf")"
fi

if [ -z "$platform_job" ]; then
  fail "ci.yml has no 'platform' job, so nothing proves the release targets compile and their tests pass"
  dep_ok=0
else
  release_platforms="$(grep -E '^[[:space:]]*-[[:space:]]*platform:[[:space:]]*[^[:space:]]+' "$release_wf" 2>/dev/null |
    sed 's/.*platform:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//') "
  ci_platforms="$(printf '%s\n' "$platform_job" |
    grep -E '^[[:space:]]*-[[:space:]]*platform:[[:space:]]*[^[:space:]]+' |
    sed 's/.*platform:[[:space:]]*//; s/[[:space:]]*#.*$//; s/[[:space:]]*$//')"
  if [ -z "$release_platforms" ]; then
    fail "could not read the release matrix platforms from ${release_wf}"
    dep_ok=0
  else
    for p in $release_platforms; do
      if printf '%s\n' "$ci_platforms" | grep -qxF -- "$p"; then
        :
      else
        fail "release.yml builds '${p}' but the ci.yml 'platform' matrix never checks it"
        dep_ok=0
      fi
    done
  fi
  for needle in 'cargo test' 'bun run test' 'bun run --filter gridline-desktop build'; do
    printf '%s\n' "$platform_job" | grep -qF -- "$needle" ||
      { fail "the ci.yml 'platform' job does not run '${needle}' on every target"; dep_ok=0; }
  done
  printf '%s\n' "$platform_job" | grep -qF -- 'runs-on: ${{ matrix.platform }}' ||
    { fail "the ci.yml 'platform' job is not a matrix over platforms"; dep_ok=0; }
fi

[ "$dep_ok" = "1" ] && pass "dependency automation covers both Bun lockfiles and cargo, the advisory + lockfile gates are wired, and CI builds every release platform"

if [ "$status" -eq 0 ]; then
  printf '\ncheck-workflows: all checks passed\n'
else
  printf '\ncheck-workflows: FAILED\n' >&2
fi
exit "$status"
