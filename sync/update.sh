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

echo "Done. Pinned to pi $VERSION."
echo "Commit the changes in sync/ to complete the update."
