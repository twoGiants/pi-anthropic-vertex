/**
 * pi-anthropic-vertex — Anthropic Claude models on Google Cloud Vertex AI
 *
 * Pi's built-in "anthropic-messages" provider handles all the hard parts: message
 * transformation, prompt caching, tool call normalization, thinking block replay,
 * partial JSON streaming, usage tracking, and beta feature negotiation. We reuse
 * this by injecting our own AnthropicVertex client via the `client` option of
 * stream().
 *
 * The API registry exposes two levels for each provider:
 *   - streamSimple(model, context, SimpleStreamOptions) is high-level. Resolves the
 *     API key, creates an Anthropic client, maps SimpleStreamOptions to AnthropicOptions,
 *     then calls stream(). We cannot use this because it always creates a plain Anthropic
 *     client from an API key, ignoring any injected client.
 *   - stream(model, context, AnthropicOptions) is low-level. Accepts a pre-built client
 *     and fully-mapped AnthropicOptions. This is what we call, injecting AnthropicVertex.
 *
 * By bypassing streamSimple, we must replicate the SimpleStreamOptions → AnthropicOptions
 * mapping it would have done. That mapping lives in streamSimple() and its helpers,
 * which are internal to pi and not exported. We mirror them and keep them in sync
 * via the links in the comments below. Everything else (streaming, caching, error
 * handling, beta headers) is handled by pi's stream() call.
 *
 * Prerequisites:
 *   1. gcloud auth application-default login
 *   2. Set your project via one of:
 *      - export GOOGLE_CLOUD_PROJECT=your-project-id
 *      - /login anthropic-vertex (enters project ID into auth.json)
 *      - Configure auth.json directly (see pi providers.md)
 *   3. export GOOGLE_CLOUD_LOCATION=us-east5  (optional, defaults to us-east5)
 *
 * Usage:
 *   pi --provider anthropic-vertex --model claude-opus-4-6
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
  getApiProvider,
  type AnthropicMessagesCompat,
  type AnthropicOptions,
  type Api,
  type TranscriptContext,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  adjustMaxTokensForThinking,
  buildBaseOptions,
  clampMaxTokensToContext,
} from "./simple-options.ts";

const project =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT_ID;
const region =
  process.env.CLOUD_ML_REGION ||
  process.env.GOOGLE_CLOUD_LOCATION ||
  "us-east5";

export default function (pi: ExtensionAPI) {
  const anthropicApi = getApiProvider("anthropic-messages");
  if (!anthropicApi)
    throw new Error("Built-in anthropic-messages provider not found");

  // Pull model definitions from pi's built-in Anthropic provider at runtime.
  const anthropicModels = getBuiltinModels("anthropic");
  if (anthropicModels.length === 0) return;
  const models = anthropicModels.map(
    ({
      id,
      name,
      compat,
      reasoning,
      thinkingLevelMap,
      input,
      cost,
      contextWindow,
      maxTokens,
    }) => ({
      id,
      name,
      compat: stripUnsupportedVertexFeatures(compat),
      reasoning,
      thinkingLevelMap,
      input,
      cost,
      contextWindow,
      maxTokens,
    }),
  );

  // Register with $ENV_VAR syntax so pi resolves the project through its auth
  // pipeline (auth.json, /login, env vars). This lets PI WEB and other
  // non-interactive environments work without shell profile env vars.
  pi.registerProvider("anthropic-vertex", {
    baseUrl: `https://${region}-aiplatform.googleapis.com`,
    apiKey: project || "$GOOGLE_CLOUD_PROJECT",
    api: "anthropic-vertex",
    models,
    streamSimple: (
      model: Model<Api>,
      context,
      options?: SimpleStreamOptions,
    ) => {
      // Pi resolves the project ID through its auth pipeline and passes it as
      // options.apiKey. Region may come from auth.json env overrides.
      const effectiveProject = options?.apiKey || project;
      const effectiveRegion =
        options?.env?.CLOUD_ML_REGION ||
        options?.env?.GOOGLE_CLOUD_LOCATION ||
        region;
      const client = getOrCreateClient(effectiveProject!, effectiveRegion);
      const anthropicOptions = mapStreamToAnthropicOptions(
        client,
        options,
        model,
        context,
      );
      // The registry's wrapStream() guard rejects any model whose api field
      // doesn't match the registered api. Our models are registered as
      // "anthropic-vertex" but we're calling the "anthropic-messages" provider,
      // so we patch the api field to pass the guard.
      const patchedModel = { ...model, api: "anthropic-messages" as Api };
      return anthropicApi.stream(patchedModel, context, anthropicOptions);
    },
  });
}

/**
 * Vertex does not support the `fallbacks` request param that pi derives from
 * `compat.allowedFallbackModels` (server-side refusal fallback, added in pi
 * 0.84.3). Sending it produces a 400: "fallbacks: Extra inputs are not
 * permitted". Strip the field so pi's buildParams() skips it.
 */
function stripUnsupportedVertexFeatures(compat: Model<Api>["compat"]): Model<Api>["compat"] {
  if (!compat) return compat;
  const { allowedFallbackModels: _fallbacks, supportsStrictTools: _strict, ...rest } =
    compat as AnthropicMessagesCompat;
  return rest;
}

// Client cache keyed by "project:region" so requests with different resolved
// credentials (e.g. auth.json vs env var) each get their own client.
const clients = new Map<string, AnthropicVertex>();
function getOrCreateClient(projectId: string, region: string): AnthropicVertex {
  const key = `${projectId}:${region}`;
  let client = clients.get(key);
  if (!client) {
    client = new AnthropicVertex({ projectId, region });
    clients.set(key, client);
  }
  return client;
}

/**
 * Build options for the built-in stream().
 */
function mapStreamToAnthropicOptions(
  client: AnthropicVertex,
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
  context: TranscriptContext,
): AnthropicOptions {
  const base = {
    ...buildBaseOptions(model, context, options, options?.apiKey),
    toolChoice: options?.toolChoice,
  };

  return {
    // AnthropicVertex extends BaseAnthropic, as Anthropic does, but it has no
    // completions or models endpoints. A direct cast is not possible. TypeScript
    // requires "unknown" as intermediate when types don't overlap. Currently safe
    // because pi's internal stream() only calls client.beta.messages.create().
    client: client as unknown as Anthropic,
    ...base,
    ...buildThinkingOptions(options, model, context),
  };
}
// We can't call streamSimple() because it creates its own Anthropic
// client internally, ignoring our injected AnthropicVertex client. Instead we
// call stream() directly and replicate the thinking mapping from streamSimple()
// here. Keep in sync with:
// https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts#L849
function buildThinkingOptions(
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
  context: TranscriptContext,
): {
  thinkingEnabled: boolean;
  effort?: AnthropicOptions["effort"];
  thinkingBudgetTokens?: number;
  maxTokens?: number;
} {
  if (!options?.reasoning || !model.reasoning)
    return { thinkingEnabled: false };

  const modelCompat = model.compat as AnthropicMessagesCompat | undefined;
  if (modelCompat?.forceAdaptiveThinking === true)
    return {
      thinkingEnabled: true,
      effort: mapThinkingLevelToEffort(model, options.reasoning),
    };

  const adjusted = adjustMaxTokensForThinking(
    options.maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );

  const maxTokens = clampMaxTokensToContext(model, context, adjusted.maxTokens);

  return {
    thinkingEnabled: true,
    maxTokens,
    thinkingBudgetTokens: Math.min(
      adjusted.thinkingBudget,
      Math.max(0, maxTokens - 1024),
    ),
  };
}

// Keep in sync with: https://github.com/earendil-works/pi/blob/v0.85.1/packages/ai/src/api/anthropic-messages.ts#L829
function mapThinkingLevelToEffort(
  model: Model<Api>,
  level: SimpleStreamOptions["reasoning"],
): AnthropicOptions["effort"] {
  const mapped = level ? model.thinkingLevelMap?.[level] : undefined;
  if (typeof mapped === "string") return mapped as AnthropicOptions["effort"];

  switch (level) {
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "high";
  }
}
