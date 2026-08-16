#!/usr/bin/env bash
#
# Render the Homebrew cask for a Gridline release.
#
# Usage:
#   scripts/render-cask.sh <version> <arm_sha256> <intel_sha256>
#
# Reads packaging/homebrew/gridline.rb.template, substitutes the version and
# per-arch SHA256 checksums, and prints the rendered cask to stdout. The
# release workflow pipes this into the tap repo's Casks/gridline.rb.
#
# Example:
#   scripts/render-cask.sh 0.7.10 \
#     aaaa...bbbb \
#     cccc...dddd > Casks/gridline.rb
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <version> <arm_sha256> <intel_sha256>" >&2
  exit 1
fi

VERSION="$1"
ARM_SHA256="$2"
INTEL_SHA256="$3"

# Validate the checksums look like SHA-256 (64 hex chars) before we ship them.
for sha in "$ARM_SHA256" "$INTEL_SHA256"; do
  if ! [[ "$sha" =~ ^[0-9a-f]{64}$ ]]; then
    echo "error: invalid sha256 '$sha' (expected 64 hex chars)" >&2
    exit 1
  fi
done

TEMPLATE="$(dirname "$0")/../packaging/homebrew/gridline.rb.template"
TEMPLATE="$(cd "$(dirname "$TEMPLATE")" && pwd)/$(basename "$TEMPLATE")"

sed -e "s/@VERSION@/${VERSION}/g" \
    -e "s/@ARM_SHA256@/${ARM_SHA256}/g" \
    -e "s/@INTEL_SHA256@/${INTEL_SHA256}/g" \
    "$TEMPLATE"