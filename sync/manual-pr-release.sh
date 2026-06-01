#!/usr/bin/env bash
set -euo pipefail

# Releases a new version after a community PR is merged.
# Usage: ./sync/manual-pr-release.sh <patch|minor> <pr-number>

BUMP="${1:?Usage: ./sync/manual-pr-release.sh <patch|minor> <pr-number>}"
PR="${2:?Usage: ./sync/manual-pr-release.sh <patch|minor> <pr-number>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

cd "$REPO_DIR"

if [ "$BUMP" != "patch" ] && [ "$BUMP" != "minor" ]; then
  echo "Error: first argument must be 'patch' or 'minor'"
  exit 1
fi

PI_VERSION=$(cat sync/PI_VERSION)
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
echo "Bumped to $NEW_VERSION"

# Add compat entry, then regenerate README table
jq --arg v "$NEW_VERSION" --arg pi "$PI_VERSION" \
  '[{"extension": $v, "piMin": $pi, "piMax": $pi}] + .' \
  sync/compat.json > sync/compat.tmp && mv sync/compat.tmp sync/compat.json
node sync/update-readme.js

# Commit, tag, push
git add -A
git commit -m "chore: release v$NEW_VERSION (PR #$PR)"
git tag "v$NEW_VERSION"
#git push origin master "v$NEW_VERSION"

echo "Released v$NEW_VERSION. Pipeline will publish to npm and create GitHub Release."
