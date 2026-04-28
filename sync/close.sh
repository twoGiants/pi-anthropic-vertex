#!/usr/bin/env bash
set -euo pipefail

# Closes a sync issue when no code changes are needed.
# Usage: ./sync/close.sh <pi-version> <issue-number>

VERSION="${1:?Usage: ./sync/close.sh <pi-version> <issue-number>}"
ISSUE="${2:?Usage: ./sync/close.sh <pi-version> <issue-number>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

"$SCRIPT_DIR/update.sh" "$VERSION"

git add sync/
git commit -m "chore: no diff, bump PI_VERSION to $VERSION"
git push

gh issue close "$ISSUE" --repo twoGiants/pi-anthropic-vertex --comment "No relevant changes."
