#!/usr/bin/env bash
#
# Test harness for scripts/render-cask.sh.
#
# Ticket 46, "Cask rendering validates inputs". The cask renderer turns release
# metadata (a version tag and two DMG digests) into a Ruby file that Homebrew
# loads and executes as a formula, and that file is pushed to the tap repo. So
# the renderer has to be a *validated, structure-preserving* transform:
#
#   1. Only well-formed metadata is accepted: a plain semver-shaped version and
#      two lowercase SHA-256 digests.
#   2. Hostile metadata (quotes, backticks, `$(...)`, newlines, URL- or
#      path-shaped strings, `sed` replacement hazards like `&` and `\1`) fails
#      the render with a clear error and a non-zero exit — and never emits a
#      partial cask on stdout, so a broken file cannot be pushed to the tap.
#   3. The rendered cask is the template byte-for-byte except for the three
#      substituted values, so metadata cannot add, move, or rewrite structure
#      (no heredoc/quoting/Ruby interpolation escape, no redirected download
#      URL). Proven by "unrendering" the output and diffing it against the
#      template, plus per-line assertions on the substituted lines.
#   4. The rendered version and checksums provably belong to the published
#      artifacts: a version that disagrees with the release tag, or a checksum
#      that is not the digest of the DMG the release actually published, is
#      refused. The workflow/cask asset-naming agreement is asserted here too.
#
# Usage: scripts/render-cask.test.sh        (exit 0 = every case passed)

set -uo pipefail

self_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$self_dir/.." && pwd)"
render="$self_dir/render-cask.sh"
template="$repo_root/packaging/homebrew/gridline.rb.template"
release_wf="$repo_root/.github/workflows/release.yml"

# Two distinct, well-formed digests.
ARM="1111111111111111111111111111111111111111111111111111111111111111"
INTEL="2222222222222222222222222222222222222222222222222222222222222222"

work="$(mktemp -d "${TMPDIR:-/tmp}/gridline-cask-test.XXXXXX")" || {
  echo "render-cask.test: cannot create a temporary directory" >&2
  exit 1
}
trap 'rm -rf "$work"' EXIT

cases=0
failures=0
pass() { cases=$((cases + 1)); printf 'ok   %s\n' "$1"; }
fail() {
  cases=$((cases + 1))
  failures=$((failures + 1))
  printf 'FAIL %s\n' "$1" >&2
  shift
  [ "$#" -gt 0 ] && printf '     %s\n' "$*" >&2
  return 0
}

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

# expect_ok <description> <render-cask args...>
expect_ok() {
  local desc="$1"
  shift
  local out="$work/ok.out" err="$work/ok.err" rc
  "$render" "$@" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$desc" "expected success, got exit $rc: $(head -n 3 "$err")"
  elif [ ! -s "$out" ]; then
    fail "$desc" "expected a rendered cask on stdout, got nothing"
  else
    pass "$desc"
  fi
}

# expect_reject <description> <error substring> <render-cask args...>
# A rejected input must exit non-zero, mention why, and emit NOTHING on stdout.
expect_reject() {
  local desc="$1" needle="$2"
  shift 2
  local out="$work/rej.out" err="$work/rej.err" rc
  : >"$out"
  "$render" "$@" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    fail "$desc" "expected a non-zero exit for hostile/invalid input, got 0"
  elif [ -s "$out" ]; then
    fail "$desc" "failed (exit $rc) but still wrote $(wc -c <"$out" | tr -d ' ') bytes of cask to stdout"
  elif ! grep -qi -- "$needle" "$err"; then
    fail "$desc" "exit $rc but stderr does not mention '$needle': $(head -n 3 "$err")"
  else
    pass "$desc"
  fi
}

# normalize <file>
# Line-for-line copy of a file, used to compare against a render (which always
# ends with a newline) without a cosmetic trailing-newline difference.
normalize() {
  local file="$1" line
  while IFS= read -r line || [ -n "$line" ]; do
    printf '%s\n' "$line"
  done <"$file"
}

# unrender <rendered file> <version> <arm> <intel>
# Put the placeholders back, so the result can be compared with the template.
# Bash pattern expansion is used (glob syntax: `.` and `-` are literal, and
# neither a validated version nor a digest can contain `*`, `?` or `[`).
unrender() {
  local file="$1" version="$2" arm="$3" intel="$4" line
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$version/@VERSION@}"
    line="${line//$arm/@ARM_SHA256@}"
    line="${line//$intel/@INTEL_SHA256@}"
    printf '%s\n' "$line"
  done <"$file"
}

# structure <description> <version> [extra render-cask options...]
# Renders and asserts the structural invariants against the real template.
expect_structure() {
  local desc="$1" version="$2"
  shift 2
  local out="$work/struct.rb" err="$work/struct.err" rc
  local url_line t_lines r_lines version_hits

  "$render" "$@" "$version" "$ARM" "$INTEL" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "$desc: renders" "exit $rc: $(head -n 3 "$err")"
    return 0
  fi

  # 1. Byte-for-byte, the output is the template with only the three values
  #    substituted. Any added/removed/moved line fails this diff.
  unrender "$out" "$version" "$ARM" "$INTEL" >"$work/struct.unrendered"
  normalize "$template" >"$work/struct.template"
  if diff -u "$work/struct.template" "$work/struct.unrendered" >"$work/struct.diff" 2>&1; then
    pass "$desc: output is the template with only the values substituted"
  else
    fail "$desc: metadata changed the cask structure" "$(head -n 15 "$work/struct.diff")"
  fi

  # 2. Same number of lines as the template (a newline in metadata would add
  #    one; `grep -c ''` counts an unterminated final line).
  t_lines="$(grep -c '' "$template")"
  r_lines="$(grep -c '' "$out")"
  if [ "$t_lines" = "$r_lines" ]; then
    pass "$desc: line count matches the template ($r_lines)"
  else
    fail "$desc: line count drifted from the template" "template=$t_lines rendered=$r_lines"
  fi

  # 3. The version appears exactly once, on the `version` line, quoted.
  version_hits="$(grep -cF -- "$version" "$out")"
  if [ "$version_hits" = "1" ] && grep -Fxq "  version \"$version\"" "$out"; then
    pass "$desc: version appears once, on the version line"
  else
    fail "$desc: version is not confined to the version line" "occurrences=$version_hits"
  fi

  # 4. The checksums land on the sha256 arm/intel lines, unquoted-unchanged.
  if grep -Fq "sha256 arm:   \"$ARM\"," "$out" && grep -Fq "intel: \"$INTEL\"" "$out"; then
    pass "$desc: checksums land on the sha256 arm/intel lines"
  else
    fail "$desc: checksums are not on the sha256 lines" "$(grep -n 'sha256' "$out")"
  fi

  # 5. The download URL line is untouched by metadata (no redirect).
  url_line="$(grep -m 1 '^  url "' "$template")"
  if [ -n "$url_line" ] && [ "$(grep -cF -- "$url_line" "$out")" = "1" ]; then
    pass "$desc: download URL line is identical to the template"
  else
    fail "$desc: download URL line was altered" "template: $url_line / rendered: $(grep -m 1 '^  url "' "$out")"
  fi

  # 6. No placeholder survived, and no foreign host was introduced.
  if grep -qF '@VERSION@' "$out" || grep -qF '@ARM_SHA256@' "$out" ||
    grep -qF '@INTEL_SHA256@' "$out"; then
    fail "$desc: an unsubstituted placeholder was shipped" "$(grep -nF '@' "$out" | head -n 5)"
  else
    pass "$desc: no template placeholder is left in the output"
  fi
  if [ "$(grep -c 'https://' "$out")" = "$(grep -c 'https://github.com/AdrianBonpin/' "$out")" ]; then
    pass "$desc: every URL still points at the Gridline release host"
  else
    fail "$desc: a non-Gridline URL appeared in the cask" "$(grep -n 'https://' "$out")"
  fi
}

# --------------------------------------------------------------------------
# Preconditions: the pieces under test exist and are executable.
# --------------------------------------------------------------------------
if [ -x "$render" ]; then
  pass "scripts/render-cask.sh is present and executable"
else
  fail "scripts/render-cask.sh is missing or not executable"
fi
if [ -f "$template" ]; then
  pass "the cask template is present"
else
  fail "the cask template is missing" "$template"
fi
if [ -f "$release_wf" ]; then
  pass "release.yml is present"
else
  fail "release.yml is missing" "$release_wf"
fi

# --------------------------------------------------------------------------
# Valid input renders, and renders without touching the structure.
# --------------------------------------------------------------------------
expect_ok "a canonical version and two digests render" 0.8.4 "$ARM" "$INTEL"
expect_structure "0.8.4" 0.8.4
expect_structure "a pre-release version (0.9.0-rc.1)" 0.9.0-rc.1
expect_structure "a many-digit version (10.20.300)" 10.20.300
expect_structure "the current release line (0.10.0)" 0.10.0

# --------------------------------------------------------------------------
# Malformed versions are refused with a clear error and no output.
# --------------------------------------------------------------------------
expect_reject "a version with an embedded quote is refused" \
  "invalid version" '0.8."4' "$ARM" "$INTEL"
expect_reject "a version that closes the Ruby string and injects a cask line is refused" \
  "invalid version" $'0.8.4"\n  url "https://evil.example/Gridline_0.8.4_aarch64.dmg"' "$ARM" "$INTEL"
expect_reject "a version containing a newline is refused" \
  "invalid version" $'0.8.4\n  url "https://evil.example/x.dmg"' "$ARM" "$INTEL"
expect_reject "a version containing a backtick command substitution is refused" \
  "invalid version" '0.8.4`id`' "$ARM" "$INTEL"
expect_reject "a version containing \$(...) is refused" \
  "invalid version" '0.8.4$(id)' "$ARM" "$INTEL"
expect_reject "a version containing a sed replacement hazard (&) is refused" \
  "invalid version" '0.8.4&0.8.5' "$ARM" "$INTEL"
expect_reject "a version containing a sed backreference (\\1) is refused" \
  "invalid version" '0.8.4\1' "$ARM" "$INTEL"
expect_reject "a URL-shaped version is refused (it cannot redirect the download)" \
  "invalid version" 'https://evil.example/Gridline_0.8.4_aarch64.dmg' "$ARM" "$INTEL"
expect_reject "a path-shaped version is refused" \
  "invalid version" '../../Casks/gridline' "$ARM" "$INTEL"
expect_reject "a version with a shell separator is refused" \
  "invalid version" '0.8.4; echo pwned' "$ARM" "$INTEL"
expect_reject "a version with whitespace is refused" \
  "invalid version" '0.8.4 0.8.5' "$ARM" "$INTEL"
expect_reject "a version with a leading v is refused" \
  "invalid version" 'v0.8.4' "$ARM" "$INTEL"
expect_reject "a two-component version is refused" \
  "invalid version" '0.8' "$ARM" "$INTEL"
expect_reject "a version with a Ruby interpolation escape is refused" \
  "invalid version" '0.8.4#{ENV["HOME"]}' "$ARM" "$INTEL"
expect_reject "an empty version is refused" \
  "empty version" '' "$ARM" "$INTEL"

# --------------------------------------------------------------------------
# Malformed checksums are refused with a clear error and no output.
# --------------------------------------------------------------------------
expect_reject "a 63-character checksum is refused" \
  "invalid sha256" 0.8.4 "${ARM:0:63}" "$INTEL"
expect_reject "a 65-character checksum is refused" \
  "invalid sha256" 0.8.4 "${ARM}1" "$INTEL"
# An all-uppercase digest caught a locale-dependent bracket range
# (`[0-9a-f]` accepting `A`-`F` under UTF-8 collation), so keep both shapes.
ALL_UPPER="$(printf 'A%.0s' {1..64})"
MIXED_CASE="$(printf 'ABCDEF01%.0s' {1..8})"
expect_reject "an all-uppercase checksum is refused" \
  "invalid sha256" 0.8.4 "$ALL_UPPER" "$INTEL"
expect_reject "a mixed-case hex checksum is refused" \
  "invalid sha256" 0.8.4 "$MIXED_CASE" "$INTEL"
expect_reject "a non-hex checksum is refused" \
  "invalid sha256" 0.8.4 "zzzz${ARM:4}" "$INTEL"
expect_reject "a checksum with a command substitution is refused" \
  "invalid sha256" 0.8.4 '$(id)' "$INTEL"
expect_reject "a checksum with a newline is refused" \
  "invalid sha256" 0.8.4 "${ARM}"$'\n'"${INTEL}" "$INTEL"
expect_reject "a checksum with a quote is refused" \
  "invalid sha256" 0.8.4 "$ARM\"" "$INTEL"
expect_reject "an empty checksum is refused" \
  "invalid sha256" 0.8.4 '' "$INTEL"
expect_reject "an empty Intel checksum is refused" \
  "invalid sha256" 0.8.4 "$ARM" ''
expect_reject "identical arm and Intel digests are refused" \
  "same digest" 0.8.4 "$ARM" "$ARM"

# --------------------------------------------------------------------------
# Argument handling: usage errors, and no cask on stdout.
# --------------------------------------------------------------------------
expect_reject "no arguments is a usage error" "usage"
expect_reject "two arguments is a usage error" "usage" 0.8.4 "$ARM"
expect_reject "four positional arguments is a usage error" "usage" 0.8.4 "$ARM" "$INTEL" extra
expect_reject "an unknown option is a usage error" "unknown argument" --bogus 0.8.4 "$ARM" "$INTEL"
expect_reject "an option missing its value is a usage error" "needs a value" --tag

# --------------------------------------------------------------------------
# Hostile metadata cannot cause a side effect (nothing is ever eval'd).
# --------------------------------------------------------------------------
(
  cd "$work" || exit 1
  "$render" '$(touch pwned-version)' "$ARM" "$INTEL" >/dev/null 2>&1
  "$render" 0.8.4 '$(touch pwned-arm)' "$INTEL" >/dev/null 2>&1
  exit 0
)
if [ -e "$work/pwned-version" ] || [ -e "$work/pwned-arm" ]; then
  fail "hostile metadata executed code" "$(ls -1 "$work" | grep pwned)"
else
  pass "hostile metadata is inert (no command substitution was evaluated)"
fi

# --------------------------------------------------------------------------
# The published cask must match the published artifacts (criterion 4).
# --------------------------------------------------------------------------
tag_ok() { # <description> <expected-reject-needle (empty = expect success)> <tag> <version>
  if [ -z "$2" ]; then
    expect_ok "$1" --tag "$3" "$4" "$ARM" "$INTEL"
  else
    expect_reject "$1" "$2" --tag "$3" "$4" "$ARM" "$INTEL"
  fi
}
tag_ok "a version that matches its release tag renders" "" v0.8.4 0.8.4
tag_ok "a version that disagrees with its release tag is refused" "does not match release tag" v0.8.5 0.8.4
tag_ok "a tag without the v prefix is refused" "does not start with" 0.8.4 0.8.4
tag_ok "a tag that only shares a prefix is refused" "does not match release tag" v0.8.40 0.8.4

# The DMGs the release downloaded: the rendered checksums must be their
# digests, otherwise the cask would point at bytes it does not describe.
printf 'apple silicon dmg\n' >"$work/arm.dmg"
printf 'intel dmg\n' >"$work/intel.dmg"
ARM_REAL="$("$self_dir/verified-fetch.sh" sha256 "$work/arm.dmg")"
INTEL_REAL="$(bash "$self_dir/verified-fetch.sh" sha256 "$work/intel.dmg")"

if [ -n "$ARM_REAL" ] && [ -n "$INTEL_REAL" ]; then
  pass "the harness can hash artifacts with scripts/verified-fetch.sh"
  expect_ok "the published DMG digests render with the artifacts attached" \
    --dmg-arm "$work/arm.dmg" --dmg-intel "$work/intel.dmg" 0.8.4 "$ARM_REAL" "$INTEL_REAL"
  expect_reject "a checksum that is not the published DMG's digest is refused" \
    "mismatch" --dmg-arm "$work/arm.dmg" --dmg-intel "$work/intel.dmg" 0.8.4 "$ARM" "$INTEL"
  expect_reject "the arm and Intel digests swapped is refused" \
    "mismatch" --dmg-arm "$work/arm.dmg" --dmg-intel "$work/intel.dmg" 0.8.4 "$INTEL_REAL" "$ARM_REAL"
  expect_reject "a missing artifact file is refused" \
    "does not exist" --dmg-arm "$work/absent.dmg" --dmg-intel "$work/intel.dmg" 0.8.4 "$ARM_REAL" "$INTEL_REAL"
else
  fail "could not hash the artifact fixtures" "verified-fetch.sh sha256 returned no digest"
fi

# The workflow derives the cask version from the tag and the checksums from the
# published DMGs, so the naming schemes have to agree end to end.
if grep -Fq 'arch arm: "aarch64", intel: "x64"' "$template" &&
  grep -Fq 'Gridline_#{version}_#{arch}.dmg' "$template"; then
  pass "the cask's arch values and asset pattern match the published asset names"
else
  fail "the cask no longer references the published Gridline_<version>_<arch>.dmg assets"
fi
if grep -Fq 'gh release download "$RELEASE_TAG" -p "Gridline_${VERSION}_aarch64.dmg"' "$release_wf" &&
  grep -Fq 'gh release download "$RELEASE_TAG" -p "Gridline_${VERSION}_x64.dmg"' "$release_wf"; then
  pass "release.yml hashes the published aarch64/x64 DMGs for the cask"
else
  fail "release.yml no longer hashes the published DMGs named like the cask URL"
fi
if grep -Fq -- '--dmg-arm' "$release_wf" &&
  grep -Fq -- '--dmg-intel' "$release_wf" &&
  grep -Fq -- '--tag "$RELEASE_TAG"' "$release_wf"; then
  pass "release.yml binds the rendered cask to the release tag and the downloaded DMGs"
else
  fail "release.yml does not bind the cask render to the release tag and DMGs" \
    "expected --tag \"\$RELEASE_TAG\", --dmg-arm and --dmg-intel in the render step"
fi

# --------------------------------------------------------------------------
# Template drift fails closed: a template the renderer cannot substitute
# exactly once must not ship a half-rendered cask.
# --------------------------------------------------------------------------
scratch="$work/scratch"
mkdir -p "$scratch/scripts" "$scratch/packaging/homebrew" || exit 1
cp "$render" "$scratch/scripts/render-cask.sh" || exit 1
cp "$self_dir/verified-fetch.sh" "$scratch/scripts/verified-fetch.sh" || exit 1

drift_case() { # <description> <sed-ish description> ; template rewritten by caller
  local desc="$1"
  local out="$work/drift.out" err="$work/drift.err" rc
  "$scratch/scripts/render-cask.sh" 0.8.4 "$ARM" "$INTEL" >"$out" 2>"$err"
  rc=$?
  if [ "$rc" -ne 0 ] && [ ! -s "$out" ] && grep -qi 'template' "$err"; then
    pass "$desc"
  else
    fail "$desc" "exit $rc; stdout $(wc -c <"$out" | tr -d ' ') bytes; stderr: $(head -n 3 "$err")"
  fi
}

# A duplicated placeholder.
sed 's/@VERSION@/@VERSION@/; s/@ARM_SHA256@/@ARM_SHA256@ @ARM_SHA256@/' \
  "$template" >"$scratch/packaging/homebrew/gridline.rb.template"
drift_case "a template with a duplicated placeholder is refused"

# A removed placeholder: the cask would ship the literal placeholder.
grep -v '@INTEL_SHA256@' "$template" >"$scratch/packaging/homebrew/gridline.rb.template"
drift_case "a template missing a placeholder is refused"

# A missing template.
rm -f "$scratch/packaging/homebrew/gridline.rb.template"
drift_case "a missing template is refused"

# A template that adds a line containing the placeholder would smuggle the
# metadata somewhere else; the renderer must still refuse or keep it inert.
cp "$template" "$scratch/packaging/homebrew/gridline.rb.template"
printf '%s\n' '  # @VERSION@' >>"$scratch/packaging/homebrew/gridline.rb.template"
drift_case "a template that duplicates the version placeholder on another line is refused"

# --------------------------------------------------------------------------
printf '\nrender-cask.test: %d case(s), %d failure(s)\n' "$cases" "$failures"
[ "$failures" -eq 0 ] || exit 1
exit 0
