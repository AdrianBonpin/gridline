#!/usr/bin/env bash
#
# Fail closed when the credentials a signed + notarized macOS release needs are
# missing (ticket 45, "macOS signing fails closed").
#
# A macOS artifact that is only ad-hoc signed (or signed but unnotarized) must
# never be uploaded under Gridline's "Developer-ID signed and notarized" claim,
# so the release job refuses to build at all when the credentials are absent:
#
#   * `.github/workflows/release.yml` runs this with no arguments (the CI set)
#     as the first macOS step, before a single file is compiled;
#   * `scripts/release-mac.sh` runs it with the smaller local set after
#     detecting the Developer ID identity in the login keychain, so the local
#     fallback cannot ship an un-notarized build either.
#
# Only variable NAMES are ever printed — never a value — so the output is safe
# in a public CI log.
#
# Usage:
#   scripts/require-macos-signing-credentials.sh              # the CI set
#   scripts/require-macos-signing-credentials.sh VAR [VAR...]  # an explicit set
#
# Exit status: 0 = every named variable is non-empty, 1 = something is missing,
# 2 = usage error.

set -uo pipefail

# The seven repository secrets a Developer-ID signed + notarized macOS release
# needs. See README "macOS signing & notarization".
ci_vars=(
  APPLE_CERTIFICATE
  APPLE_CERTIFICATE_PASSWORD
  APPLE_SIGNING_IDENTITY
  KEYCHAIN_PASSWORD
  APPLE_API_KEY
  APPLE_API_ISSUER
  APPLE_API_KEY_CONTENT
)

if [ "$#" -gt 0 ]; then
  vars=("$@")
else
  vars=("${ci_vars[@]}")
fi

if [ "${#vars[@]}" -eq 0 ]; then
  echo "require-macos-signing-credentials: no variables requested" >&2
  exit 2
fi

missing=()
for name in "${vars[@]}"; do
  # Indirect expansion only, and only for a plain variable name: this script
  # must never evaluate a caller-supplied expression.
  case "$name" in
    [A-Za-z_][A-Za-z0-9_]*)
      if [ -z "${!name:-}" ]; then
        missing+=("$name")
      fi
      ;;
    *)
      echo "require-macos-signing-credentials: '${name}' is not an environment variable name" >&2
      exit 2
      ;;
  esac
done

if [ "${#missing[@]}" -gt 0 ]; then
  printf 'error: macOS signing/notarization credentials are missing: %s\n' "${missing[*]}" >&2
  cat >&2 <<'EOF'

Gridline only publishes macOS builds that are Developer-ID signed, notarized
and stapled: an ad-hoc signed or unnotarized build is not uploaded, because the
release page and SECURITY.md promise a notarized artifact.

  * In CI, set the repository secrets listed above
    (Settings -> Secrets and variables -> Actions) — see README
    "macOS signing & notarization".
  * Locally, put APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_PATH in
    ~/.config/gridline/notarize.env and install a "Developer ID Application"
    certificate in your login keychain.

Then re-run the release.
EOF
  exit 1
fi

printf 'macOS signing/notarization credentials: all %d present\n' "${#vars[@]}"
exit 0
