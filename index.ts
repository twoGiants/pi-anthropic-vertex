/**
 * pi-anthropic-vertex — Anthropic Claude models on Google Cloud Vertex AI
 *
 * Pi's built-in "anthropic-messages" provider handles all the hard parts: message
 * transformation, prompt caching, tool call normalization, thinking block replay,
 * partial JSON streaming, and usage tracking. We reuse this by injecting our own
 * AnthropicVertex client via the `client` option of streamAnthropic().
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
 * mapping it would have done. That mapping lives in streamSimpleAnthropic() and its helpers,
 * which are internal to pi and not exported. We mirror them verbatim and keep them in sync
 * via the links in the comments below. Everything else (streaming, caching, error handling)
 * is handled by pi's stream() call.
 *
 * Prerequisites:
 *   1. gcloud auth application-default login
 *   2. export GOOGLE_CLOUD_PROJECT=your-project-id
 *   3. export GOOGLE_CLOUD_LOCATION=us-east5  (optional, defaults to us-east5)
 *
 * Usage:
 *   pi --provider anthropic-vertex --model claude-opus-4-6
 */

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicVertex, type ClientOptions } from "@anthropic-ai/vertex-sdk";
import {
  getApiProvider,
  getModels,
  type AnthropicOptions,
  type Api,
  type Model,
  type SimpleStreamOptions,
  type ThinkingBudgets,
  type ThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const region =
  process.env.GOOGLE_CLOUD_LOCATION ||
  process.env.CLOUD_ML_REGION ||
  "us-east5";

export default function (pi: ExtensionAPI) {
  if (!project) {
    console.warn(
      "[pi-anthropic-vertex] disabled: GOOGLE_CLOUD_PROJECT is not set",
    );
    return;
  }

  const anthropicApi = getApiProvider("anthropic-messages");
  if (!anthropicApi)
    throw new Error("Built-in anthropic-messages provider not found");

  // Pull model definitions from pi's built-in Anthropic provider at runtime.
  const anthropicModels = getModels("anthropic");
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
      compat,
      reasoning,
      thinkingLevelMap,
      input,
      cost,
      contextWindow,
      maxTokens,
    }),
  );

  pi.registerProvider("anthropic-vertex", {
    baseUrl: `https://${region}-aiplatform.googleapis.com`,
    apiKey: "$GOOGLE_CLOUD_PROJECT",
    api: "anthropic-vertex",
    models,
    streamSimple: (
      model: Model<Api>,
      context,
      options?: SimpleStreamOptions,
    ) => {
      const isAdaptive = model.compat?.forceAdaptiveThinking === true;
      const client = createVertexClient(isAdaptive, options?.headers);
      const anthropicOptions = mapStreamToAnthropicOptions(
        client,
        options,
        model,
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
 * Build options for the built-in streamAnthropic.
 */
function mapStreamToAnthropicOptions(
  client: AnthropicVertex,
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
): AnthropicOptions {
  const baseMaxTokens = options?.maxTokens;

  return {
    // AnthropicVertex extends BaseAnthropic, as Anthropic does, but it has no
    // completions or models endpoints. A direct cast is not possible. TypeScript
    // requires "unknown" as intermediate when types don't overlap. Currently safe
    // because pi's internal streamAnthropic only calls "messages.stream()".
    client: client as unknown as Anthropic,
    maxTokens: baseMaxTokens,
    temperature: options?.temperature,
    signal: options?.signal,
    apiKey: options?.apiKey,
    cacheRetention: options?.cacheRetention,
    sessionId: options?.sessionId,
    headers: options?.headers,
    onPayload: options?.onPayload,
    onResponse: options?.onResponse,
    maxRetryDelayMs: options?.maxRetryDelayMs,
    metadata: options?.metadata,
    ...buildThinkingOptions(baseMaxTokens, options, model),
  };
}
// We can't call streamSimpleAnthropic() because it creates its own Anthropic
// client internally, ignoring our injected AnthropicVertex client. Instead we
// call stream() directly and replicate the thinking mapping from streamSimpleAnthropic()
// here. Keep in sync with:
// https://github.com/earendil-works/pi/blob/v0.75.5/packages/ai/src/providers/anthropic.ts#L732
function buildThinkingOptions(
  maxTokens: number | undefined,
  options: SimpleStreamOptions | undefined,
  model: Model<Api>,
): {
  thinkingEnabled: boolean;
  effort?: AnthropicOptions["effort"];
  thinkingBudgetTokens?: number;
  maxTokens?: number;
} {
  if (!options?.reasoning || !model.reasoning)
    return { thinkingEnabled: false };

  if (model.compat?.forceAdaptiveThinking === true)
    return {
      thinkingEnabled: true,
      effort: mapThinkingLevelToEffort(model, options.reasoning),
    };

  const adjusted = adjustMaxTokensForThinking(
    maxTokens,
    model.maxTokens,
    options.reasoning,
    options.thinkingBudgets,
  );

  return {
    thinkingEnabled: true,
    maxTokens: adjusted.maxTokens,
    thinkingBudgetTokens: adjusted.thinkingBudget,
  };
}

// Keep in sync with: https://github.com/earendil-works/pi/blob/v0.75.5/packages/ai/src/providers/anthropic.ts#L712
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

// Keep in sync with: https://github.com/earendil-works/pi/blob/v0.75.5/packages/ai/src/providers/simple-options.ts#L26
function adjustMaxTokensForThinking(
  baseMaxTokens: number | undefined,
  modelMaxTokens: number,
  reasoningLevel: ThinkingLevel,
  customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
  const defaultBudgets: ThinkingBudgets = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
  };
  const budgets = { ...defaultBudgets, ...customBudgets };
  const minOutputTokens = 1024;
  const level = (
    reasoningLevel === "xhigh" ? "high" : reasoningLevel
  ) as keyof ThinkingBudgets;
  let thinkingBudget = budgets[level]!;
  const maxTokens =
    baseMaxTokens === undefined
      ? modelMaxTokens
      : Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

  if (maxTokens <= thinkingBudget) {
    thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
  }

  return { maxTokens, thinkingBudget };
}

/**
 * Helpers
 */

// Reuse a client across calls when no per-request headers are set, to avoid
// re-reading credentials on every stream call. Two cached profiles are kept
// since adaptive and non-adaptive models need different beta headers. Calls
// that supply custom headers get a dedicated client.
type Profile = "adaptive" | "legacy";
const sharedClient = new Map<Profile, AnthropicVertex>();
function createVertexClient(
  isAdaptive: boolean,
  requestHeaders?: Record<string, string>,
): AnthropicVertex {
  if (requestHeaders && Object.keys(requestHeaders).length > 0) {
    const opts = createVertexClientOpts(
      project,
      region,
      isAdaptive,
      requestHeaders,
    );
    return new AnthropicVertex(opts);
  }

  const profile: Profile = isAdaptive ? "adaptive" : "legacy";
  let client = sharedClient.get(profile);
  if (!client) {
    const opts = createVertexClientOpts(project, region, isAdaptive);
    client = new AnthropicVertex(opts);
    sharedClient.set(profile, client);
  }

  return client;
}

export function createVertexClientOpts(
  projectId: string | undefined,
  region: string,
  isAdaptive: boolean,
  requestHeaders?: Record<string, string>,
): ClientOptions {
  // Adaptive thinking models have interleaved thinking built in, so skip the
  // beta header.
  const betaHeaders: string[] = [];
  if (!isAdaptive)
    betaHeaders.push("interleaved-thinking-2025-05-14");

  // Merge any user-supplied beta values
  if (requestHeaders?.["anthropic-beta"])
    betaHeaders.push(
      ...requestHeaders?.["anthropic-beta"]
        .split(",")
        .map((item) => item.trim())
        .filter((value) => value.length > 0),
    );

  // Return with merged beta header and all other request headers
  if (betaHeaders.length > 0)
    return {
      projectId,
      region,
      defaultHeaders: {
        // preserve non-beta request headers
        ...requestHeaders,
        // deduplicates and adds beta request headers
        "anthropic-beta": [...new Set(betaHeaders)].join(","),
      },
    };

  // No beta headers and no request headers: return bare config
  if (!requestHeaders)
    return {
      projectId,
      region,
    };

  // Strip the potentially empty anthropic-beta, keep remaining headers
  const { "anthropic-beta": _, ...defaultHeaders } = requestHeaders;
  return {
    projectId,
    region,
    defaultHeaders,
  };
}
