#!/usr/bin/env bash
set -euo pipefail

# Checks if pi has been updated and generates diffs for tracked files.
# Usage: ./sync/ci/check-update.sh [--output FILE] [--diff-file FILE]
#
# Options:
#   --output FILE     Write key=value results to FILE (default: stdout)
#   --diff-file FILE  Write diff markdown to FILE (default: /tmp/pi-diff.md)
#
# Output keys:
#   pinned=<version>             Currently pinned pi version
#   latest=<version>             Latest published pi version
#   changed=true|false           Whether pi version changed
#   has_diff=true|false|missing  Whether tracked files have diffs
#
# Tests
#
# Test 1: normal run
# PINNED=0.79.4 LATEST=0.80.2 ./sync/ci/check-update.sh
#
# Test 2: file at old path (should fail, show search result)
# PINNED=0.79.4 LATEST=0.80.2 TRACKED_FILES_OVERRIDE="providers/simple-options.ts" ./sync/ci/check-update.sh
#
# Test 3: bogus file (should fail, no search result)
# PINNED=0.79.4 LATEST=0.80.2 TRACKED_FILES_OVERRIDE="api/nonexistent-file.ts" ./sync/ci/check-update.sh
#
# Test 4: multiple files, one bad
# PINNED=0.79.4 LATEST=0.80.2 TRACKED_FILES_OVERRIDE="api/simple-options.ts,providers/simple-options.ts" ./sync/ci/check-update.sh
#
# Test 5: version unchanged (should exit 0 immediately)
# PINNED=0.80.2 LATEST=0.80.2 ./sync/ci/check-update.sh
#
# Test 6: with --output flag (simulates CI)
# PINNED=0.79.4 LATEST=0.80.2 ./sync/ci/check-update.sh --output /tmp/test-output && cat /tmp/test-output && rm /tmp/test-output

# Global constants
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SYNC_DIR="$(dirname "$SCRIPT_DIR")"
PI_REPO="https://github.com/earendil-works/pi"
PI_RAW="https://raw.githubusercontent.com/earendil-works/pi"
TRACKED_FILES=(
  "api/anthropic-messages.ts"
  "api/simple-options.ts"
  "utils/estimate.ts"
)

# Global options
OUTPUT=""
DIFF_FILE="/tmp/pi-diff.md"

# Global variables
PINNED="${PINNED:-}"
LATEST="${LATEST:-}"
DOWNLOAD_DIR=""
TRACKED_FILES_OVERRIDE="${TRACKED_FILES_OVERRIDE:-}"

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output)   OUTPUT="$2"; shift 2 ;;
      --diff-file) DIFF_FILE="$2"; shift 2 ;;
      *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
  done

  if ! version_has_changed; then
    exit 0
  fi

  DOWNLOAD_DIR=$(mktemp -d)
  trap 'rm -rf "$DOWNLOAD_DIR"' EXIT

  if ! download_files; then
    exit 1
  fi

  generate_diffs
}

emit() {
  if [ -n "$OUTPUT" ]; then
    echo "$1" >> "$OUTPUT"
  else
    echo "$1"
  fi
}

version_has_changed() {
  if [ -z "$PINNED" ]; then
    PINNED=$(cat "$SYNC_DIR/PI_VERSION")
  fi

  if [ -z "$LATEST" ]; then
    LATEST=$(npm show @earendil-works/pi-coding-agent version)
  fi

  emit "pinned=$PINNED"
  emit "latest=$LATEST"

  if [ "$PINNED" = "$LATEST" ]; then
    echo "Pi version unchanged ($PINNED). Nothing to do."
    emit "changed=false"
    return 1
  fi

  echo "Pi updated: $PINNED -> $LATEST"
  emit "changed=true"

  return 0
}

download_files() {
  local missing=false

  # for local testing
  if [ -n "$TRACKED_FILES_OVERRIDE" ]; then
    IFS=',' read -ra TRACKED_FILES <<< "$TRACKED_FILES_OVERRIDE"
  fi

  for file in "${TRACKED_FILES[@]}"; do
    local basename dest
    basename=$(basename "$file")
    dest="$DOWNLOAD_DIR/$basename"
    if ! curl -sf "$PI_RAW/v${LATEST}/packages/ai/src/$file" -o "$dest"; then
      missing=true
      local search
      search=$(gh api "search/code?q=filename:${basename}+repo:earendil-works/pi" -q '.items[0].path' 2>/dev/null || true)
      if [ -n "$search" ]; then
        echo "::error::${basename} not found at expected path. It may have moved to ${search}. See ${PI_REPO}/blob/v${LATEST}/${search}"
      else
        echo "::error::${basename} not found at pi v${LATEST}. File may have been renamed or removed. See ${PI_REPO}/tree/v${LATEST}/packages/ai/src"
      fi
    fi
  done

  if [ "$missing" = "true" ]; then
    emit "has_diff=missing"
    return 1
  fi
}

generate_diffs() {
  local has_diff=false

  {
    for file in "${TRACKED_FILES[@]}"; do
      local basename file_diff
      basename=$(basename "$file")
      file_diff=$(diff -u "$SYNC_DIR/$basename" "$DOWNLOAD_DIR/$basename" || true)
      if [ -n "$file_diff" ]; then
        has_diff=true
        echo "### $basename"
        echo ""
        echo '```diff'
        echo "$file_diff"
        echo '```'
        echo ""
      fi
    done
  } > "$DIFF_FILE"

  emit "has_diff=$has_diff"

  if [ "$has_diff" = "false" ]; then
    echo "Pi version changed ($PINNED -> $LATEST) but no relevant file diffs."
  fi
}

main "$@"
