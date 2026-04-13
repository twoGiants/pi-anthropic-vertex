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

- **~80–100 lines** instead of 500+ in other extensions
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
   class extends `Anthropic` from `@anthropic-ai/sdk`. It handles Google ADC
   auth and Vertex URL construction internally. The built-in `streamAnthropic`
   accepts a `client?: Anthropic` option — so `AnthropicVertex` can be passed
   directly with no casting needed.

6. **Beta headers**: Set on the `AnthropicVertex` client constructor since the
   built-in `createClient` is skipped when `client` is injected. Required:
   `fine-grained-tool-streaming-2025-05-14` and `interleaved-thinking-2025-05-14`
   (the latter only for non-4.6 models; 4.6 has interleaved thinking built-in).

7. **Thinking mapping**: Our `streamSimple` receives `SimpleStreamOptions` (with
   `reasoning: "minimal"|"low"|"medium"|"high"|"xhigh"`). We must convert to
   `AnthropicOptions`:
   - Opus 4.6 / Sonnet 4.6: `{ thinkingEnabled: true, effort: "low"|"medium"|"high"|"max" }`
     (adaptive thinking)
   - Older models: `{ thinkingEnabled: true, thinkingBudgetTokens: N }` with
     `maxTokens` adjusted to fit budget + output (budget-based thinking)

## File structure

```
~/.pi/agent/extensions/anthropic-vertex/
├── PLAN.md         # This file
├── index.ts        # Extension entry point (~80-100 lines)
└── package.json    # Dependencies: @anthropic-ai/vertex-sdk
```

## Phase 1: Build as global extension

### Step 1: Create package.json

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
     a. Creates `AnthropicVertex` client with project, region, beta headers
     b. Maps `SimpleStreamOptions.reasoning` to `AnthropicOptions` (adaptive vs budget)
     c. Calls `getApiProvider("anthropic-messages").stream()` with
        `{ ...model, api: "anthropic-messages" }` and `{ client, ...options }`

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

1. Add `README.md` with setup instructions
2. Set package name (e.g., `@sjakusch/pi-anthropic-vertex`)
3. `npm publish`
4. Users install with `pi install npm:@sjakusch/pi-anthropic-vertex`

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
| **This extension** | ~80–100 | Delegates to built-in | None — inherits all built-in features |
