#!/usr/bin/env bash
#
# Render the Homebrew cask for a Gridline release.
#
# Usage:
#   scripts/render-cask.sh <version> <arm_sha256> <intel_sha256> [options]
#
# Options:
#   --tag <tag>          require <tag> to be exactly v<version>
#   --dmg-arm <file>     require <arm_sha256> to be the SHA-256 of <file>
#   --dmg-intel <file>   require <intel_sha256> to be the SHA-256 of <file>
#
# Reads packaging/homebrew/gridline.rb.template, substitutes the version and the
# per-arch SHA-256 checksums, and prints the rendered cask to stdout. The
# release workflow pipes this into the tap repo's Casks/gridline.rb.
#
# Ticket 46, "Cask rendering validates inputs". The version and the checksums
# are metadata from outside this repository, and they are interpolated into a
# Ruby file that Homebrew loads and executes as a cask formula — then pushed to
# a different repository. So this script is a validated, structure-preserving
# transform:
#
#   * the version must be a plain release number (N.N.N, optional -suffix) and
#     each checksum exactly 64 lowercase hex characters. Anything else is
#     refused; hostile input is never "cleaned up" into something acceptable.
#   * substitution is done in the shell with literal pattern expansion, never
#     through `sed`/`awk` replacement text — there `&`, `\1` and `/` are
#     special, which is how a tag could have rewritten the file's structure.
#   * the render is assembled in a temporary file and checked against the
#     template BEFORE a single byte reaches stdout: same line count, every line
#     without a placeholder byte-identical to the template's, the version
#     appearing exactly once (on the `version` line), and no unsubstituted
#     placeholder left. A rejected input therefore cannot leave a half-rendered
#     cask for the workflow to push.
#   * `--tag` / `--dmg-arm` / `--dmg-intel` let the release pipeline prove the
#     metadata is the published metadata: the tag must be exactly v<version>,
#     and each checksum must be the digest of the DMG the release actually
#     published (the workflow already downloaded and hashed those files).
#
# Exit status: 0 = rendered to stdout, 1 = invalid or inconsistent input,
# 2 = usage error.

set -euo pipefail

# Deterministic pattern matching: bracket ranges such as `[0-9a-f]` are
# collation-dependent in a UTF-8 locale (where they can also match `A`-`F`), so
# every check below runs with the C locale.
export LC_ALL=C

err() { printf 'render-cask: %s\n' "$*" >&2; }
die() {
  err "$@"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
usage: scripts/render-cask.sh <version> <arm_sha256> <intel_sha256> [options]

  <version>       release version without the "v" prefix, e.g. 0.8.4
  <arm_sha256>    SHA-256 of Gridline_<version>_aarch64.dmg
  <intel_sha256>  SHA-256 of Gridline_<version>_x64.dmg

options:
  --tag <tag>          require <tag> to be exactly v<version>
  --dmg-arm <file>     require <arm_sha256> to be the SHA-256 of <file>
  --dmg-intel <file>   require <intel_sha256> to be the SHA-256 of <file>
EOF
  exit 2
}

self_dir="$(cd "$(dirname "$0")" && pwd)"
template="$self_dir/../packaging/homebrew/gridline.rb.template"
fetch="$self_dir/verified-fetch.sh"

# A release version: three numeric components and an optional restricted
# pre-release suffix (0.9.0-rc.1). Deliberately narrow — no quote, whitespace,
# `/`, `#`, `$`, `&`, `\`, `+` or any other Ruby/shell/URL metacharacter can
# pass, because the value is interpolated into a Ruby string and into a
# Ruby-interpolated download URL.
version_re='^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(-[0-9A-Za-z][0-9A-Za-z.-]{0,31})?$'

is_version() {
  [[ "$1" =~ $version_re ]]
}

# Exactly 64 lowercase hex characters, nothing else. Written as an explicit
# character set (no ranges) so the accepted alphabet cannot drift with the
# runner's locale — `[0-9a-f]` alone would accept `A`-`F` under UTF-8 collation.
is_sha256() {
  case "$1" in
    *[!0123456789abcdef]*) return 1 ;;
  esac
  [ "${#1}" -eq 64 ]
}

# `grep -c` counts an unterminated final line, so this is a real line count
# even for a template that does not end with a newline.
line_count() { grep -c '' "$1" || true; }

# Occurrences (not matching lines), so a line carrying a needle twice is caught.
count_occurrences() { # <needle> <file>
  grep -o -F -- "$1" "$2" | wc -l | tr -d ' ' || true
}

# --------------------------------------------------------------------------
# Arguments: three positionals plus optional cross-checks, order-independent.
# --------------------------------------------------------------------------
tag=""
dmg_arm=""
dmg_intel=""
positional=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || { err "option --tag needs a value"; usage; }
      tag="$2"
      shift 2
      ;;
    --dmg-arm)
      [ "$#" -ge 2 ] || { err "option --dmg-arm needs a value"; usage; }
      dmg_arm="$2"
      shift 2
      ;;
    --dmg-intel)
      [ "$#" -ge 2 ] || { err "option --dmg-intel needs a value"; usage; }
      dmg_intel="$2"
      shift 2
      ;;
    -h | --help)
      usage
      ;;
    --)
      shift
      while [ "$#" -gt 0 ]; do
        positional+=("$1")
        shift
      done
      ;;
    -*)
      err "unknown argument: $1"
      usage
      ;;
    *)
      positional+=("$1")
      shift
      ;;
  esac
done

if [ "${#positional[@]}" -ne 3 ]; then
  err "expected 3 positional arguments, got ${#positional[@]}"
  usage
fi

version="${positional[0]}"
arm_sha256="${positional[1]}"
intel_sha256="${positional[2]}"

# --------------------------------------------------------------------------
# Validate the metadata before it can reach the template.
# --------------------------------------------------------------------------
[ -n "$version" ] ||
  die "empty version (expected a release number such as 0.8.4)"

is_version "$version" ||
  die "invalid version $(printf '%q' "$version"): expected N.N.N with an optional -suffix; quotes, whitespace, newlines, slashes, URL/path shapes and shell/Ruby metacharacters are not allowed"

is_sha256 "$arm_sha256" ||
  die "invalid sha256 for the Apple Silicon DMG: $(printf '%q' "$arm_sha256") (expected 64 lowercase hex characters)"

is_sha256 "$intel_sha256" ||
  die "invalid sha256 for the Intel DMG: $(printf '%q' "$intel_sha256") (expected 64 lowercase hex characters)"

[ "$arm_sha256" != "$intel_sha256" ] ||
  die "the Apple Silicon and Intel DMGs have the same digest ($arm_sha256): one artifact was hashed twice, so the cask would install the wrong architecture"

# The cask's download URL is v<version>; a tag that disagrees with the version
# means the cask would point at a different release than the one being cut.
if [ -n "$tag" ]; then
  case "$tag" in
    v*) ;;
    *) die "release tag $(printf '%q' "$tag") does not start with 'v'" ;;
  esac
  [ "$tag" = "v$version" ] ||
    die "version '$version' does not match release tag $(printf '%q' "$tag") (expected 'v$version')"
fi

# --------------------------------------------------------------------------
# Optional: prove each checksum is the digest of the published artifact.
# --------------------------------------------------------------------------
verify_artifact() { # <label> <path> <expected sha256>
  local label="$1" path="$2" expected="$3" actual
  [ -n "$path" ] || return 0
  [ -f "$path" ] ||
    die "the $label DMG $path does not exist, so its checksum cannot be confirmed"
  [ -x "$fetch" ] || die "cannot hash the $label DMG: $fetch is missing"
  actual="$("$fetch" sha256 "$path")" ||
    die "could not hash the $label DMG at $path"
  if [ "$actual" != "$expected" ]; then
    err "CHECKSUM MISMATCH for the $label DMG"
    err "  the cask would ship: $expected"
    err "  the published file:  $actual"
    die "  ($path is not the artifact the cask would download — refusing to render)"
  fi
  err "verified the $label DMG digest against $path"
}

verify_artifact "Apple Silicon" "$dmg_arm" "$arm_sha256"
verify_artifact "Intel" "$dmg_intel" "$intel_sha256"

# --------------------------------------------------------------------------
# Template: it has to contain each placeholder exactly once, so a render can
# never ship a literal placeholder or silently drop a value.
# --------------------------------------------------------------------------
[ -f "$template" ] || die "cask template not found: $template"

for placeholder in '@VERSION@' '@ARM_SHA256@' '@INTEL_SHA256@'; do
  found="$(count_occurrences "$placeholder" "$template")"
  if [ "$found" != "1" ]; then
    die "the cask template $template must contain $placeholder exactly once, found ${found:-0} (refusing to render a cask that would ship a placeholder or lose a value)"
  fi
done

# --------------------------------------------------------------------------
# Render into a temporary file. Nothing reaches stdout until it is checked.
# --------------------------------------------------------------------------
rendered="$(mktemp "${TMPDIR:-/tmp}/gridline-cask.XXXXXX")" ||
  die "could not create a temporary file"
trap 'rm -f "$rendered"' EXIT

# Line-local literal substitution. Bash pattern expansion treats the needle as
# a glob (no glob metacharacter can occur in a validated version or digest, and
# the placeholders are plain text) and the replacement as literal text, so `&`,
# `\1`, quotes and `/` in the metadata have no special meaning.
while IFS= read -r line || [ -n "$line" ]; do
  line="${line//@VERSION@/$version}"
  line="${line//@ARM_SHA256@/$arm_sha256}"
  line="${line//@INTEL_SHA256@/$intel_sha256}"
  printf '%s\n' "$line"
done <"$template" >"$rendered"

# --------------------------------------------------------------------------
# Structure checks: the metadata may only have changed the three values.
# --------------------------------------------------------------------------
# The template's version field must stay a single quoted Ruby string; the
# value is interpolated into it, so anything else is a structural hazard.
grep -Eq '^[[:space:]]*version[[:space:]]+"@VERSION@"[[:space:]]*$' "$template" ||
  die "the cask template's version field is not a single quoted version line (refusing to render)"

template_lines="$(line_count "$template")"
rendered_lines="$(line_count "$rendered")"
[ "$template_lines" = "$rendered_lines" ] ||
  die "the rendered cask has $rendered_lines lines but the template has $template_lines: the metadata changed the cask's structure (refusing to render)"

# Each value must appear exactly once, on the line its placeholder occupied —
# so metadata cannot be repeated, relocated, or dropped.
check_substitution() { # <label> <placeholder> <value>
  local label="$1" placeholder="$2" value="$3" line hits matches
  matches="$(grep -n -F -- "$placeholder" "$template" || true)"
  line="${matches%%:*}"
  [ -n "$line" ] || die "the cask template has no $placeholder line"
  if ! sed -n "${line}p" "$rendered" | grep -q -F -- "$value"; then
    err "template line $line (which carries $placeholder) does not carry the $label"
    err "  rendered: $(sed -n "${line}p" "$rendered")"
    die "the metadata did not land where the template puts it (refusing to render)"
  fi
  hits="$(count_occurrences "$value" "$rendered")"
  [ "$hits" = "1" ] ||
    die "the $label appears $hits times in the rendered cask (expected exactly once, where the template puts it): the metadata altered the cask's structure"
}

check_substitution "version" '@VERSION@' "$version"
check_substitution "Apple Silicon checksum" '@ARM_SHA256@' "$arm_sha256"
check_substitution "Intel checksum" '@INTEL_SHA256@' "$intel_sha256"

for placeholder in '@VERSION@' '@ARM_SHA256@' '@INTEL_SHA256@'; do
  if grep -q -F -- "$placeholder" "$rendered"; then
    die "the rendered cask still contains $placeholder (the template changed under us)"
  fi
done

# The download URL decides where Homebrew fetches from, so assert it is still
# the canonical GitHub release path (the version is filled in by Ruby at
# install time, which is why metadata cannot redirect it).
grep -q -F -- 'url "https://github.com/AdrianBonpin/gridline/releases/download/v#{version}/Gridline_#{version}_#{arch}.dmg"' "$rendered" ||
  die "the rendered cask no longer downloads from the Gridline GitHub release (refusing to render)"

# Every template line without a placeholder must survive byte-identically: this
# is what stops metadata from adding, moving or rewriting a line — including
# the `url` line that decides where Homebrew downloads from.
index=1
while [ "$index" -le "$template_lines" ]; do
  template_line="$(sed -n "${index}p" "$template")"
  case "$template_line" in
    *'@VERSION@'* | *'@ARM_SHA256@'* | *'@INTEL_SHA256@'*)
      : # substituted; checked above
      ;;
    *)
      rendered_line="$(sed -n "${index}p" "$rendered")"
      if [ "$template_line" != "$rendered_line" ]; then
        err "rendered line $index is not the template's line"
        err "  template: $template_line"
        err "  rendered: $rendered_line"
        die "the metadata altered the cask's structure (refusing to render)"
      fi
      ;;
  esac
  index=$((index + 1))
done

cat "$rendered"
