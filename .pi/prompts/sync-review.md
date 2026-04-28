---
description: Review a sync issue opened by the sync-check workflow
argument-hint: "<issue-number>"
---

# Sync Review

Review sync issue $ARGUMENTS and determine if the pi changes affect our mirrored functions.

## Steps

1. Read the issue: `gh issue view $ARGUMENTS --repo twoGiants/pi-anthropic-vertex --json body -q .body`
2. Read `index.ts` to understand the current state of mirrored functions
3. Review the diff against the mirrored functions checklist in the issue
4. Check the pi release notes for context: `./sync/pi-release-notes.sh $ARGUMENTS`

## Not relevant (no code changes needed)

Run:

```bash
./sync/close.sh <version> $ARGUMENTS
```

This updates pinned references, commits, pushes, and closes the issue.

## Relevant (code changes needed)

Present your analysis and proposed changes, then wait for approval.

After the manual changes to `index.ts` and the "keep in sync" links are done, run:

```bash
./sync/release.sh <version> $ARGUMENTS "<comment>"
```

This bumps the patch version, updates pinned references, commits, pushes,
tags, pushes the tag (triggers the release pipeline), and closes the issue.
