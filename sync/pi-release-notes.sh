#!/usr/bin/env bash
set -euo pipefail

# Shows the pi release notes for the version referenced in a sync issue.
# Usage: ./sync/pi-release-notes.sh <issue-number>

ISSUE="${1:?Usage: ./sync/release-notes.sh <issue-number>}"

VERSION=$(gh issue view "$ISSUE" --repo twoGiants/pi-anthropic-vertex --json title -q .title | grep -oP '-> \K[\d.]+')

gh release view "v$VERSION" --repo badlogic/pi-mono
