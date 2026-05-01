#!/usr/bin/env bash
set -euo pipefail

# Updates the pinned pi reference files used by the sync-check workflow.
# Usage: ./sync/update.sh [version]
# If no version is given, fetches the latest from npm.

VERSION="${1:-$(npm show @mariozechner/pi-coding-agent version)}"
SYNC_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="https://raw.githubusercontent.com/badlogic/pi-mono/v${VERSION}/packages/ai/src/providers"

echo "Updating pinned references to pi $VERSION..."

curl -sf "$BASE_URL/anthropic.ts" -o "$SYNC_DIR/anthropic.ts"
curl -sf "$BASE_URL/simple-options.ts" -o "$SYNC_DIR/simple-options.ts"
echo "$VERSION" > "$SYNC_DIR/PI_VERSION"

# Update piMax in compat.json and regenerate README table.
# jq can't read and write the same file, so we write to a temp file first.
jq --arg v "$VERSION" '.[0].piMax = $v' "$SYNC_DIR/compat.json" > "$SYNC_DIR/compat.tmp" && mv "$SYNC_DIR/compat.tmp" "$SYNC_DIR/compat.json"
node "$SYNC_DIR/update-readme.js"

echo "Done. Pinned to pi $VERSION."
echo "Commit the changes to complete the update."
