# Sync Scripts

Scripts for keeping the extension in sync with pi releases and managing versions.

## Sync workflow (triggered by sync-check CI issues)

```bash
# Show pi release notes for a sync issue
./sync/pi-release-notes.sh <issue-number>

# Close a sync issue when no code changes are needed
./sync/close.sh <pi-version> <issue-number>

# Release after syncing code changes (bumps patch, tags, pushes, closes issue)
./sync/release.sh <pi-version> <issue-number> "<comment>"
```

## PR workflow (after merging a community PR)

```bash
# Release a new version (patch or minor, tags, pushes)
./sync/manual-pr-release.sh <patch|minor> <pr-number>
```

## General

```bash
# Update pinned pi reference files (defaults to latest pi version)
./sync/update.sh [version]

# Release a new patch version for general code changes
./sync/publish.sh
```

## Reference files

- `PI_VERSION`: pinned pi version we last synced against
- `anthropic-messages.ts`: pinned copy of pi's anthropic-messages API source
- `simple-options.ts`: pinned copy of pi's simple-options source
- `estimate.ts`: pinned copy of pi's context token estimation utility
- `compat.json`: extension-to-pi version compatibility data
- `update-readme.js`: regenerates the README.md compatibility table from compat.json
