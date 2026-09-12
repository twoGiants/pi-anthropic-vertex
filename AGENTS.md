# Project Overview

Pi extension that routes Anthropic Claude models through Google Cloud Vertex AI.
Published as `@twogiants/pi-anthropic-vertex` on npm.

## How it works

The extension injects an `AnthropicVertex` client into pi's built-in
`anthropic-messages` streaming provider. Pi handles all the hard parts (message
transformation, prompt caching, tool streaming, thinking blocks, usage tracking,
beta feature negotiation). We only handle client construction and the thinking
options mapping.

We call `getApiProvider("anthropic-messages").stream()` (the low-level API) because
`streamSimple()` always creates its own Anthropic client, ignoring injected ones.
This means we must mirror a few internal pi functions that map `SimpleStreamOptions`
to `AnthropicOptions`. These are marked with "keep in sync" links in `index.ts`.

## Key files

- `index.ts`: Extension entry point. Registers the `anthropic-vertex` provider.
- `sync/`: Pinned copies of pi source files we mirror, plus scripts for the sync workflow.
- `.github/workflows/release.yml`: Tag push triggers npm publish + GitHub Release.
- `.github/workflows/sync-check.yml`: Daily check for pi updates. Opens a GitHub issue
  with diffs if mirrored files changed. Use `/sync-review <issue-number>` to handle it.
- `.pi/prompts/sync-review.md`: Prompt template for reviewing sync issues.
- `PLAN.md`: Full architecture docs, design decisions, and project history.

## Rules

- Always show changes for review before committing. Never commit without approval.
- Do not use em dashes in text. Use colons, commas, or separate sentences instead.
- Do not make assumptions about external systems or third-party behavior. Validate claims before presenting them. If you cannot validate, say so and let the user decide.
