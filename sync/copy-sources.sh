#!/usr/bin/env bash
set -euo pipefail

# Copies pinned pi source files into the project root with adjusted imports.
# Usage: ./sync/copy-sources.sh <pi-version>
#
# The sync/ directory holds verbatim pi sources (downloaded by update.sh).
# This script copies them to the project root, replacing pi-internal import
# paths with the paths we use, and prepending a "Keep in sync" comment.
#
# Import mapping (pi source -> our code):
#   "../types.ts"          -> "@earendil-works/pi-ai/compat"
#   "../utils/estimate.ts" -> "./estimate.ts"
#   "./text.ts"            -> "@earendil-works/pi-ai/compat"

VERSION="${1:?Usage: ./sync/copy-sources.sh <pi-version>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

copy_with_imports() {
  local src="$1"
  local dest="$2"
  local sync_url="$3"

  {
    printf '// Keep in sync with: %s\n' "$sync_url"
    sed \
      -e "s|from \"../types.ts\"|from \"@earendil-works/pi-ai/compat\"|g" \
      -e "s|from \"../utils/estimate.ts\"|from \"./estimate.ts\"|g" \
      -e "s|from \"./text.ts\"|from \"@earendil-works/pi-ai/compat\"|g" \
      "$src"
  } > "$dest"
}

copy_with_imports \
  "$SCRIPT_DIR/simple-options.ts" \
  "$REPO_DIR/simple-options.ts" \
  "https://github.com/earendil-works/pi/blob/v${VERSION}/packages/ai/src/api/simple-options.ts"

copy_with_imports \
  "$SCRIPT_DIR/estimate.ts" \
  "$REPO_DIR/estimate.ts" \
  "https://github.com/earendil-works/pi/blob/v${VERSION}/packages/ai/src/utils/estimate.ts"

echo "Copied sources with imports adjusted for pi v${VERSION}."
