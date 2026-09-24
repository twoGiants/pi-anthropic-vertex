# Contributing

Thanks for your interest in contributing. This extension is tightly coupled
to pi's internals, so changes require more than just fixing the immediate
problem. This guide explains what a complete PR looks like.

## Before you start

Read `AGENTS.md` and the top of `index.ts` to understand the architecture.
The short version: we inject an `AnthropicVertex` client into pi's built-in
`anthropic-messages` provider. We bypass `streamSimple()` (which creates its
own client) and call `stream()` directly, so we must replicate the
`SimpleStreamOptions` to `AnthropicOptions` mapping ourselves.

This means we maintain mirrored copies of several pi-internal functions.
These must stay in sync with pi's source.

## Mirrored files

These files are verbatim copies of pi source, adapted only to import types
from `@earendil-works/pi-ai/compat` instead of relative paths:

| Our file            | Pi source                               |
| ------------------- | --------------------------------------- |
| `estimate.ts`       | `packages/ai/src/utils/estimate.ts`     |
| `simple-options.ts` | `packages/ai/src/api/simple-options.ts` |

Reference copies of the pi source files live in `sync/` for diffing.

`index.ts` contains two functions mirrored from
`packages/ai/src/api/anthropic-messages.ts`:

- `buildThinkingOptions` (mirrors `streamSimple`'s thinking logic)
- `mapThinkingLevelToEffort`

Each mirrored function has a "Keep in sync with" comment linking to the
exact pi version and line number it was last synced against.

## How to update mirrored files

1. Run `./sync/update.sh <pi-version>` to fetch new pi source into `sync/`.
2. Diff the new `sync/estimate.ts` against `estimate.ts` (same for
   `simple-options.ts`). The only differences should be the import paths.
3. Copy the new pi source into the root file, then change the imports from
   relative paths to `@earendil-works/pi-ai/compat`.
4. If the pi source added a new import (like a utility function), check if
   it is available from `@earendil-works/pi-ai/compat`. If it is, import it
   from there.
5. Update the "Keep in sync" comment at the top of the file.

## PR checklist

Before opening a PR, make sure you have done all of the following:

- [ ] **Update mirrored files.** If pi changed `estimate.ts` or
      `simple-options.ts`, fetch the new source and adapt the imports.
      Do not hand-edit the logic; copy the pi source and only change import
      paths from relative (`../types.ts`) to compat
      (`@earendil-works/pi-ai/compat`).

- [ ] **Update mirrored functions in `index.ts`.** If pi changed
      `streamSimple`'s thinking logic or `mapThinkingLevelToEffort` in
      `anthropic-messages.ts`, update our copies to match.

- [ ] **Update "Keep in sync" links.** Every `// Keep in sync with:` comment
      must point to the correct pi version tag and line number. Check all of:
  - `estimate.ts` line 1
  - `simple-options.ts` line 1
  - `index.ts` (two links: `buildThinkingOptions` and `mapThinkingLevelToEffort`)

- [ ] **Update pinned references.** Run `./sync/update.sh <pi-version>` to
      fetch new reference files into `sync/`, update `sync/PI_VERSION`, refresh
      `sync/compat.json`, regenerate the README compatibility table, and
      reinstall `node_modules`.

- [ ] **Type check passes.** Run `npm run lint` (which runs `tsc --noEmit`).
      It must exit cleanly.

- [ ] **Do not bump the version or tag.** Version bumps, tagging, and
      publishing are handled by the maintainer after merge using the release
      scripts.

## What happens after merge

The maintainer will run the release script:

```bash
./sync/manual-pr-release.sh patch <pr-number>
```

This bumps the version, updates compat metadata, commits, tags, and pushes.
The tag push triggers CI to publish to npm and create a GitHub Release.
