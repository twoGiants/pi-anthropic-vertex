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
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
	getApiProvider,
	getModels,
	type AnthropicOptions,
	type Api,
	type Model,
	type SimpleStreamOptions,
	type ThinkingBudgets,
	type ThinkingLevel,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_REGION = "us-east5";

export default function (pi: ExtensionAPI) {
	const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
	if (!project) return;

	const anthropicApi = getApiProvider("anthropic-messages");
	if (!anthropicApi) throw new Error("Built-in anthropic-messages provider not found");

	const region = process.env.GOOGLE_CLOUD_LOCATION || process.env.CLOUD_ML_REGION || DEFAULT_REGION;

	// Pull model definitions from pi's built-in Anthropic provider at runtime.
	const anthropicModels = getModels("anthropic");
	if (anthropicModels.length === 0) return;

	const models = anthropicModels.map(
		({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({
			id,
			name,
			reasoning,
			input,
			cost,
			contextWindow,
			maxTokens,
		}));

	// Created once. Reusing avoids re-reading credentials on every stream call.
	const client = new AnthropicVertex({
		projectId: project,
		region,
		defaultHeaders: {
			"anthropic-beta": [
				"fine-grained-tool-streaming-2025-05-14",
				// We always include interleaved-thinking: it's a no-op on adaptive models
				"interleaved-thinking-2025-05-14",
			].join(","),
		},
	});

	pi.registerProvider("anthropic-vertex", {
		baseUrl: `https://${region}-aiplatform.googleapis.com`,
		apiKey: "GOOGLE_CLOUD_PROJECT",
		api: "anthropic-vertex",
		models,
		streamSimple: (model: Model<Api>, context, options?: SimpleStreamOptions) => {
			const anthropicOptions = mapStreamToAnthropicOptions(client, options, model);
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
	return {
		// AnthropicVertex extends BaseAnthropic, as Anthropic does, but it has no
		// completions or models endpoints. A direct cast is not possible. TypeScript
		// requires "unknown" as intermediate when types don't overlap. Currently safe
		// because pi's internal streamAnthropic only calls "messages.stream()".
		client: client as unknown as Anthropic,
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		temperature: options?.temperature,
		signal: options?.signal,
		cacheRetention: options?.cacheRetention,
		sessionId: options?.sessionId,
		headers: options?.headers,
		onPayload: options?.onPayload,
		maxRetryDelayMs: options?.maxRetryDelayMs,
		metadata: options?.metadata,
		...buildThinkingOptions()
	};

	// We can't call streamSimpleAnthropic() because it creates its own Anthropic
	// client internally, ignoring our injected AnthropicVertex client. Instead we
	// call stream() directly and replicate the thinking mapping from streamSimpleAnthropic()
	// here. Keep in sync with:
	// https://github.com/badlogic/pi-mono/blob/v0.67.1/packages/ai/src/providers/anthropic.ts#L477
	function buildThinkingOptions(): {
		thinkingEnabled: boolean; effort?: AnthropicOptions["effort"];
		thinkingBudgetTokens?: number; maxTokens?: number;
	} {
		if (!options?.reasoning || !model.reasoning) return { thinkingEnabled: false };

		if (supportsAdaptiveThinking(model.id)) return { thinkingEnabled: true, effort: mapThinkingLevelToEffort(options.reasoning, model.id) };

		const baseMaxTokens = options.maxTokens || Math.min(model.maxTokens, 32000);
		const adjusted = adjustMaxTokensForThinking(baseMaxTokens, model.maxTokens, options.reasoning, options.thinkingBudgets);

		return {
			thinkingEnabled: true,
			maxTokens: adjusted.maxTokens,
			thinkingBudgetTokens: adjusted.thinkingBudget,
		};
	}

	// Keep in sync with: https://github.com/badlogic/pi-mono/blob/v0.67.1/packages/ai/src/providers/anthropic.ts#L446
	function supportsAdaptiveThinking(modelId: string): boolean {
		return (
			modelId.includes("opus-4-6") ||
			modelId.includes("opus-4.6") ||
			modelId.includes("sonnet-4-6") ||
			modelId.includes("sonnet-4.6")
		);
	}

	// Keep in sync with: https://github.com/badlogic/pi-mono/blob/v0.67.1/packages/ai/src/providers/anthropic.ts#L460
	function mapThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): AnthropicOptions["effort"] {
		switch (level) {
			case "minimal":
				return "low";
			case "low":
				return "low";
			case "medium":
				return "medium";
			case "high":
				return "high";
			case "xhigh":
				return modelId.includes("opus-4-6") || modelId.includes("opus-4.6") ? "max" : "high";
			default:
				return "high";
		}
	}

	// Keep in sync with: https://github.com/badlogic/pi-mono/blob/v0.67.1/packages/ai/src/providers/simple-options.ts#L22
	function adjustMaxTokensForThinking(
		baseMaxTokens: number,
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
		const level = (reasoningLevel === "xhigh" ? "high" : reasoningLevel) as keyof ThinkingBudgets;
		let thinkingBudget = budgets[level]!;
		const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

		if (maxTokens <= thinkingBudget) {
			thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
		}

		return { maxTokens, thinkingBudget };
	}
}
