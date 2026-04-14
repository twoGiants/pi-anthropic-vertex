/**
 * pi-anthropic-vertex — Anthropic Claude models on Google Cloud Vertex AI
 *
 * Reuses pi's built-in anthropic-messages streaming implementation via client
 * injection. All message transformation, caching, streaming, and error handling
 * is handled by pi's battle-tested internals.
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

	function buildThinkingOptions(): {
		thinkingEnabled: boolean; effort?: AnthropicOptions["effort"];
		thinkingBudgetTokens?: number; maxTokens?: number;
	} {
		if (!options?.reasoning || !model.reasoning) return { thinkingEnabled: false };

		if (usesAdaptiveThinking(model.id)) return { thinkingEnabled: true, effort: mapEffort(options.reasoning, model.id) };

		const baseMaxTokens = options.maxTokens || Math.min(model.maxTokens, 32000);
		const adjusted = adjustForThinkingBudget(baseMaxTokens, model.maxTokens, options.reasoning, options.thinkingBudgets);

		return {
			thinkingEnabled: true,
			maxTokens: adjusted.maxTokens,
			thinkingBudgetTokens: adjusted.thinkingBudget,
		};
	}

	/**
	 * Check if a model uses adaptive thinking (Opus 4.6, Sonnet 4.6).
	 * Older models use budget-based thinking instead.
	 */
	function usesAdaptiveThinking(modelId: string): boolean {
		return modelId.includes("opus-4-6")
			|| modelId.includes("opus-4.6")
			|| modelId.includes("sonnet-4-6")
			|| modelId.includes("sonnet-4.6");
	}

	/**
	 * Map pi's thinking level to Anthropic's effort level for adaptive thinking.
	 */
	function mapEffort(level: string, modelId: string): "low" | "medium" | "high" | "max" {
		switch (level) {
			case "minimal":
			case "low":
				return "low";
			case "medium":
				return "medium";
			case "high":
				return "high";
			case "xhigh":
				return (modelId.includes("opus-4-6") || modelId.includes("opus-4.6")) ? "max" : "high";
			default:
				return "high";
		}
	}

	/**
	 * Adjust maxTokens to accommodate thinking budget for older (non-adaptive) models.
	 */
	function adjustForThinkingBudget(
		baseMaxTokens: number,
		modelMaxTokens: number,
		reasoning: string,
		customBudgets?: ThinkingBudgets,
	): { maxTokens: number; thinkingBudget: number } {
		const defaults: Record<string, number> = {
			minimal: 1024,
			low: 2048,
			medium: 8192,
			high: 16384,
		};
		const level = (reasoning === "xhigh" ? "high" : reasoning) as keyof ThinkingBudgets;
		const thinkingBudget = customBudgets?.[level] ?? defaults[level] ?? 8192;
		const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);
		const minOutput = 1024;

		return {
			maxTokens,
			thinkingBudget: maxTokens <= thinkingBudget ? Math.max(0, maxTokens - minOutput) : thinkingBudget,
		};
	}
}
