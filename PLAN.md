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

6. **Beta headers**: Set on the `AnthropicVertex` client constructor since the
   built-in `createClient` is skipped when `client` is injected. Both
   `fine-grained-tool-streaming-2025-05-14` and `interleaved-thinking-2025-05-14`
   are always included — the latter is a no-op on adaptive models (4.6+) and
   enables interleaved reasoning on older models.

7. **Thinking mapping**: We bypass `streamSimpleAnthropic` (which creates its
   own client) and call `stream()` directly with our injected client. This
   means we must replicate the `SimpleStreamOptions` → `AnthropicOptions`
   thinking mapping. The mirrored functions are kept in sync via versioned
   GitHub links in the source comments. The mapping converts:
   - Opus 4.6 / Sonnet 4.6: `{ thinkingEnabled: true, effort: "low"|"medium"|"high"|"max" }`
     (adaptive thinking)
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
3. `npm publish --access public`
4. Users install with `pi install npm:@twogiants/pi-anthropic-vertex`

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
