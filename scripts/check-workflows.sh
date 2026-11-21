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

if [ "$status" -eq 0 ]; then
  printf '\ncheck-workflows: all checks passed\n'
else
  printf '\ncheck-workflows: FAILED\n' >&2
fi
exit "$status"
