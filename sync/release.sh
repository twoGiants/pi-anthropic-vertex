#!/usr/bin/env bash
set -euo pipefail

# Releases a new patch version after syncing code changes.
# Usage: ./sync/release.sh <pi-version> <issue-number> "<comment>"

VERSION="${1:?Usage: ./sync/release.sh <pi-version> <issue-number> \"<comment>\"}"
ISSUE="${2:?Usage: ./sync/release.sh <pi-version> <issue-number> \"<comment>\"}"
COMMENT="${3:?Usage: ./sync/release.sh <pi-version> <issue-number> \"<comment>\"}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

# Bump patch version in package.json
NEW_VERSION=$(npm version patch --no-git-tag-version | tr -d 'v')
echo "Bumped to $NEW_VERSION"

# Update pinned references
"$SCRIPT_DIR/update.sh" "$VERSION"

# Commit, tag, push
git add -A
git commit -m "fix: sync with pi v$VERSION"
git tag "v$NEW_VERSION"
git push origin master "v$NEW_VERSION"

# Close the issue
gh issue close "$ISSUE" --repo twoGiants/pi-anthropic-vertex --comment "$COMMENT"

echo "Released v$NEW_VERSION. Pipeline will publish to npm and create GitHub Release."
