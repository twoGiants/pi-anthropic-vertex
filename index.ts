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

import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
	getApiProvider,
	getModels,
	type AnthropicOptions,
	type Model,
	type Api,
	type SimpleStreamOptions,
	type ThinkingBudgets,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_REGION = "us-east5";

export default function (pi: ExtensionAPI) {
	const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
	if (!project) return;

	const region = process.env.GOOGLE_CLOUD_LOCATION || process.env.CLOUD_ML_REGION || DEFAULT_REGION;

	// Pull model definitions from pi's built-in Anthropic provider at runtime.
	const anthropicModels = getModels("anthropic");
	if (anthropicModels.length === 0) return;

	const models = anthropicModels.map(({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({
		id,
		name,
		reasoning,
		input,
		cost,
		contextWindow,
		maxTokens,
	}));

	pi.registerProvider("anthropic-vertex", {
		baseUrl: `https://${region}-aiplatform.googleapis.com`,
		apiKey: "GOOGLE_CLOUD_PROJECT",
		api: "anthropic-vertex",
		models,

		streamSimple: (model: Model<Api>, context, options?: SimpleStreamOptions) => {
			// Get pi's built-in anthropic streaming implementation
			const anthropicApi = getApiProvider("anthropic-messages");
			if (!anthropicApi) throw new Error("Built-in anthropic-messages API provider not found");


			// Adaptive thinking models have interleaved thinking built-in;
			// older models need the beta header.
			const isAdaptive = supportsAdaptiveThinking(model.id);
			const betaFeatures = ["fine-grained-tool-streaming-2025-05-14"];
			if (!isAdaptive) betaFeatures.push("interleaved-thinking-2025-05-14");

			// Create Vertex AI client — handles Google ADC auth and endpoint routing
			const client = new AnthropicVertex({
				projectId: project,
				region,
				defaultHeaders: {
					"anthropic-beta": betaFeatures.join(","),
				},
			});

			// Build options for the built-in streamAnthropic.
			// The API registry types this as StreamOptions, but internally casts to
			// AnthropicOptions (which has a `client` field). We build the full
			// AnthropicOptions object here and cast to `any` at the call site below.
			const anthropicOptions: AnthropicOptions = {
				client: client as any,
				maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
				temperature: options?.temperature,
				signal: options?.signal,
				cacheRetention: options?.cacheRetention,
				sessionId: options?.sessionId,
				headers: options?.headers,
				onPayload: options?.onPayload,
				maxRetryDelayMs: options?.maxRetryDelayMs,
				metadata: options?.metadata,
			};

			// Configure thinking mode
			if (options?.reasoning && model.reasoning) {
				anthropicOptions.thinkingEnabled = true;
				if (isAdaptive) {
					anthropicOptions.effort = mapEffort(options.reasoning, model.id);
				} else {
					const adjusted = adjustForThinkingBudget(
						anthropicOptions.maxTokens || 0,
						model.maxTokens,
						options.reasoning,
						options.thinkingBudgets,
					);
					anthropicOptions.maxTokens = adjusted.maxTokens;
					anthropicOptions.thinkingBudgetTokens = adjusted.thinkingBudget;
				}
			} else {
				anthropicOptions.thinkingEnabled = false;
			}

			// Delegate to built-in with patched api type to satisfy the type check
			const patchedModel = { ...model, api: "anthropic-messages" };
			return anthropicApi.stream(patchedModel, context, anthropicOptions);
		},
	});
}

/**
 * Check if a model uses adaptive thinking (Opus 4.6, Sonnet 4.6).
 * Older models use budget-based thinking instead.
 */
function supportsAdaptiveThinking(modelId: string): boolean {
	return modelId.includes("opus-4-6") || modelId.includes("opus-4.6")
		|| modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6");
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