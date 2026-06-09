import { defineNode } from "../../../core/node.js";
import { fetchWithRetry, SERVICE_PROFILES } from "../../../utils/http.js";
import {
	type OpenRouterGenerateInput,
	OpenRouterGenerateInputSchema,
	OpenRouterGenerateOutputSchema,
} from "./schemas.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const openrouterGenerateNode = defineNode({
	type: "openrouter_generate",
	name: "OpenRouter Generate",
	category: "integration",
	inputSchema: OpenRouterGenerateInputSchema,
	outputSchema: OpenRouterGenerateOutputSchema,
	credentials: {
		openRouter: {
			type: "header",
			required: false,
			description: "OpenRouter API key (or use openRouterDraft)",
		},
	},
	executor: async (input: OpenRouterGenerateInput, context) => {
		const apiKey =
			(context.credentials?.openRouter as { apiKey?: string })?.apiKey ??
			(context.credentials?.openRouterDraft as { apiKey?: string })?.apiKey;

		if (!apiKey) {
			return {
				success: false,
				error:
					"Missing OpenRouter API key in credentials (openRouter or openRouterDraft)",
			};
		}

		const messages: Array<{ role: string; content: string }> = [];
		if (input.systemPrompt) {
			messages.push({ role: "system", content: input.systemPrompt });
		}
		messages.push({ role: "user", content: input.prompt });

		const body: Record<string, unknown> = {
			model: input.model,
			messages,
		};

		if (input.maxTokens) body.max_tokens = input.maxTokens;
		if (input.temperature !== undefined) body.temperature = input.temperature;
		if (input.jsonMode) {
			body.response_format = { type: "json_object" };
		}

		const profile = SERVICE_PROFILES.openRouter;
		let response: Response;
		try {
			response = await fetchWithRetry(
				OPENROUTER_API_URL,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(body),
				},
				{
					maxRetries: profile.maxRetries,
					backoffMs: profile.backoffMs,
					timeoutMs: profile.timeoutMs,
					retryOn: profile.retryOn,
				},
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: `OpenRouter request failed: ${message}` };
		}

		if (!response.ok) {
			const errorText = await response.text();
			return {
				success: false,
				error: `OpenRouter API error ${response.status}: ${errorText}`,
			};
		}

		const data = (await response.json()) as {
			choices: Array<{
				message: { content: string };
				finish_reason: string;
			}>;
			usage: {
				prompt_tokens: number;
				completion_tokens: number;
				total_tokens: number;
			};
			model: string;
		};

		const choice = data.choices?.[0];
		if (!choice) {
			return { success: false, error: "No choices in OpenRouter response" };
		}

		return {
			success: true,
			output: {
				text: choice.message.content,
				usage: {
					promptTokens: data.usage?.prompt_tokens ?? 0,
					completionTokens: data.usage?.completion_tokens ?? 0,
					totalTokens: data.usage?.total_tokens ?? 0,
				},
				model: data.model ?? input.model,
				finishReason: choice.finish_reason ?? "stop",
			},
		};
	},
});
