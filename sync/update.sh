#!/usr/bin/env bash
set -euo pipefail

# Updates the pinned pi reference files used by the sync-check workflow.
# Usage: ./sync/update.sh [version]
# If no version is given, fetches the latest from npm.

VERSION="${1:-$(npm show @mariozechner/pi-coding-agent version)}"
SYNC_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR=$(mktemp -d)

echo "Updating pinned references to pi $VERSION..."

npm pack "@mariozechner/pi-ai@$VERSION" --pack-destination "$TMP_DIR"
tar -xzf "$TMP_DIR"/*.tgz -C "$TMP_DIR"

cp "$TMP_DIR/package/dist/providers/anthropic.js" "$SYNC_DIR/"
cp "$TMP_DIR/package/dist/providers/simple-options.js" "$SYNC_DIR/"
echo "$VERSION" > "$SYNC_DIR/PI_VERSION"

rm -rf "$TMP_DIR"

echo "Done. Pinned to pi $VERSION."
echo "Commit the changes in sync/ to complete the update."
