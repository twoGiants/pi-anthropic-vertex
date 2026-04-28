# pi-anthropic-vertex Extension Plan

## Goal

Minimal pi extension that enables Anthropic Claude models on Google Cloud Vertex AI
by reusing pi's built-in `anthropic-messages` streaming implementation via client injection.

## Architecture

```
Our extension                          Pi built-in
┌──────────────────────┐    delegates    ┌─────────────────────────┐
│ streamSimple()       │ ──────────────► │ getApiProvider(         │
│  1. Create           │                 │   "anthropic-messages"  │
│     AnthropicVertex  │                 │ ).stream()              │
│     client           │                 │                         │
│  2. Map thinking     │                 │ Gets ALL built-in:      │
│     options          │                 │ • transformMessages     │
│  3. Patch model.api  │                 │ • parseStreamingJson    │
│     to "anthropic-   │                 │ • caching               │
│     messages"        │                 │ • streaming events      │
│  4. Call built-in    │                 │ • usage/cost tracking   │
│     with { client }  │                 │ • etc.                  │
└──────────────────────┘                 └─────────────────────────┘
```

### Why this approach

- **~160 lines** instead of 500+ in other extensions
- **Full feature parity** with pi's built-in Anthropic provider:
  - `transformMessages` — adjacency enforcement, orphaned tool result handling,
    errored/aborted message filtering, tool call ID normalization, cross-provider
    thinking replay, thinking signature validation
  - `parseStreamingJson` — partial-json for incremental tool argument display
  - Prompt caching (`cache_control: { type: "ephemeral" }`) on system prompt and
    last user message, with `PI_CACHE_RETENTION` support
  - Redacted thinking support
  - Stop reason mapping
  - Usage tracking and cost calculation
- **Zero model maintenance** — model definitions pulled at runtime from pi's
  built-in Anthropic provider via `getModels("anthropic")`
- **No browser bloat** — `@anthropic-ai/vertex-sdk` stays isolated in the extension,
  not added to `pi-ai` core (the concern that got PR #1157 rejected)

### Key design decisions

1. **Custom API identifier**: Register with `api: "anthropic-vertex"` to avoid
   overwriting the built-in `"anthropic-messages"` API provider (which uses
   `registerApiProvider` with `.set()` — it replaces, not appends).

2. **Model.api patching**: Before calling the built-in `stream()`, patch
   `model.api` to `"anthropic-messages"` to satisfy the type check in
   `wrapStream` (`model.api !== api` guard).

3. **apiKey resolution**: Set `apiKey: "GOOGLE_CLOUD_PROJECT"` in the provider
   config. Pi's `resolveConfigValue` checks `process.env[config]` first, so
   this makes the provider visible when the env var is set.

4. **Runtime model list**: `getModels("anthropic")` returns all Claude models
   from `models.generated.ts`. We strip `api`, `provider`, `baseUrl` to get
   `ProviderModelConfig[]`. When pi updates its model list, the extension
   automatically picks up new models.

5. **AnthropicVertex client**: The `@anthropic-ai/vertex-sdk` `AnthropicVertex`
   class extends `BaseAnthropic` from `@anthropic-ai/sdk` (not `Anthropic`).
   It handles Google ADC auth and Vertex URL construction internally. The
   built-in `streamAnthropic` accepts a `client?: Anthropic` option — since
   `AnthropicVertex` omits `completions` and `models` (which don't exist on
   Vertex AI), a cast through `unknown` is needed. `@anthropic-ai/sdk` is
   pinned to pi's version (0.73.0) to avoid structural type mismatches.

6. **Beta headers**: `fine-grained-tool-streaming-2025-05-14` was deprecated in
   pi v0.68.1 and replaced with per-tool `eager_input_streaming: true` in tool
   definitions. Vertex rejects the old header. Only `interleaved-thinking-2025-05-14`
   is sent, and only for non-adaptive models (4.6+ have it built-in). Because the
   header depends on the model, the `AnthropicVertex` client is created per-call
   inside `streamSimple` rather than once at startup.

7. **Thinking mapping**: We bypass `streamSimpleAnthropic` (which creates its
   own client) and call `stream()` directly with our injected client. This
   means we must replicate the `SimpleStreamOptions` → `AnthropicOptions`
   thinking mapping. The mirrored functions are kept in sync via versioned
   GitHub links in the source comments. The mapping converts:
   - Opus 4.6 / Sonnet 4.6: adaptive thinking with `effort: "low"|"medium"|"high"|"max"`
   - Opus 4.7: adaptive thinking with `effort: "low"|"medium"|"high"|"xhigh"`
   - Older models: `{ thinkingEnabled: true, thinkingBudgetTokens: N }` with
     `maxTokens` adjusted to fit budget + output (budget-based thinking)

## File structure

```
~/.pi/agent/extensions/anthropic-vertex/
├── PLAN.md         # This file
├── README.md       # Package documentation
├── LICENSE         # MIT
├── index.ts        # Extension entry point (~160 lines)
└── package.json    # @twogiants/pi-anthropic-vertex
```

## Phase 1: Build as global extension

### Step 1: Create package.json

- `@anthropic-ai/sdk` pinned to pi's version (0.73.0) for type compatibility
- `@anthropic-ai/vertex-sdk` as dependency
- `"pi": { "extensions": ["./index.ts"] }` for pi discovery
- Peer dependencies on `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent`

### Step 2: Write index.ts

1. Import `getModels`, `getApiProvider` from `@mariozechner/pi-ai`
2. Import `AnthropicVertex` from `@anthropic-ai/vertex-sdk`
3. Import `ExtensionAPI` type from `@mariozechner/pi-coding-agent`
4. Read `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION` from env
5. Early return if no project ID set
6. Pull Anthropic models via `getModels("anthropic")`, map to `ProviderModelConfig[]`
   (strip `api`, `provider`, `baseUrl`)
7. Register provider `"anthropic-vertex"` with:
   - `baseUrl`: `https://{region}-aiplatform.googleapis.com`
   - `apiKey`: `"GOOGLE_CLOUD_PROJECT"`
   - `api`: `"anthropic-vertex"`
   - `models`: the mapped model list
   - `streamSimple`: function that:
     a. Injects pre-built `AnthropicVertex` client (created once at extension load)
     b. Maps `SimpleStreamOptions` to `AnthropicOptions` via `mapStreamToAnthropicOptions()`
     c. Patches `model.api` to `"anthropic-messages"` to pass registry type guard
     d. Delegates to `getApiProvider("anthropic-messages").stream()`

### Step 3: Install dependencies

```bash
cd ~/.pi/agent/extensions/anthropic-vertex && npm install
```

### Step 4: Test

```bash
pi --provider anthropic-vertex --model claude-opus-4-6
pi --provider anthropic-vertex --model claude-sonnet-4-6
```

Test scenarios:

- Basic text generation
- Tool calling (read/write/bash)
- Go code generation (control char handling via SDK)
- Ctrl+C mid-stream (aborted message filtering)
- Long session with context truncation (adjacency enforcement)
- Thinking levels (minimal through xhigh)

## Phase 2: Publish to npm

1. ✅ Add `README.md` with setup instructions
2. ✅ Set package name: `@twogiants/pi-anthropic-vertex`
3. ✅ Publish `0.1.0` — first official numbered release
4. ✅ Release pipeline — GitHub Actions on tag push: npm publish + GitHub Release
5. ✅ Fix + publish `0.1.2` — remove deprecated header, sync helpers with pi v0.70.2
6. ✅ Sync monitoring — daily check, diff against pinned pi source, fail + open GitHub issue
7. Users install with `pi install npm:@twogiants/pi-anthropic-vertex`

## Sync review procedure

When the sync-check workflow opens an issue, follow this procedure.

### Mirrored functions to check

- `supportsAdaptiveThinking`: which models use adaptive vs budget-based thinking
- `mapThinkingLevelToEffort`: maps pi thinking levels to Anthropic effort values
- `adjustMaxTokensForThinking`: adjusts maxTokens to fit thinking budget for older models
- `buildBaseOptions`: maps SimpleStreamOptions to StreamOptions (mirrored in `mapStreamToAnthropicOptions`)
- Beta header logic in `createClient`: which headers to send on the AnthropicVertex client

### Not relevant (no code changes needed)

```bash
# Update pinned references
./sync/update.sh <version>
git add sync/ && git commit -m "chore: bump pinned references to pi <version> (no relevant diffs)" && git push
# Close the issue
gh issue close <number> --repo twoGiants/pi-anthropic-vertex --comment "No relevant changes."
```

### Relevant (code changes needed)

1. Check the pi release notes: `gh release view v<version> --repo badlogic/pi-mono`
2. Update the mirrored functions in `index.ts`
3. Update the "keep in sync" links to the new version
4. Bump `package.json` version (patch for fixes)
5. Update pinned references: `./sync/update.sh <version>`
6. Commit and push all changes
7. Tag and push: `git tag v<new-version> && git push origin v<new-version>` (triggers release pipeline)
8. Close the issue with a comment explaining what changed

## Phase 3: Comment on GitHub issue #1155

Leave a comment explaining:

- The `client` injection approach via `getApiProvider("anthropic-messages").stream()`
- Why ~80 lines achieves full feature parity with built-in
- Link to the npm package

## Compared extensions

This plan was informed by analysis of four existing extensions:

| Extension | Lines | Approach | Key weakness |
|-----------|-------|----------|-------------|
| `isaacraja/pi-vertex-claude` | ~500 | Reimplements streaming | No adjacency enforcement, no tool ID sanitization |
| Colleague's fork (git.sbr.pm) | ~500 | Fork of isaacraja + control char fix | Same weaknesses as isaacraja minus control chars |
| `ssweens/pi-vertex` | ~1500 | Multi-model (Gemini+Claude+MaaS) | No prompt caching, no beta headers, no partial-json |
| `basnijholt/pi-anthropic-vertex` | ~550 | Best standalone Claude-only | No adjacency enforcement, no tool ID sanitization |
| **This extension** | ~160 | Delegates to built-in | None — inherits all built-in features |
