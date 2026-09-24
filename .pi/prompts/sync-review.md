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

After approval, make the changes to `index.ts`, `index.test.ts`, and the
"keep in sync" link versions and line numbers. Run the tests to verify.

Also check if the changes require updates to any of these docs:

- `CONTRIBUTING.md`: mirrored files table, checklist, or update instructions
- `AGENTS.md`: architecture description or key files list
- `README.md`: "How it works" section
- `index.ts` top comment: architecture overview or prerequisites
- `.github/pull_request_template.md`: PR checklist items

Then show the full `git diff` and **stop and wait for the user to review**
before proceeding.

After the user confirms the diff, run:

```bash
./sync/release.sh <version> $ARGUMENTS "<comment>"
```

This bumps the patch version, updates pinned references, commits, pushes,
tags, pushes the tag (triggers the release pipeline), and closes the issue.

## Release notes

After the release pipeline creates the GitHub Release, update it with notes:

```bash
gh release edit v<new-version> --repo twoGiants/pi-anthropic-vertex --notes '<notes>'
```

Follow the style of previous releases: start with "Synced with pi v<version>." on
its own line, then a blank line, then a bullet list of what changed in our code.
