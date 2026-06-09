import { fetchWithRetry } from "./http.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

interface AnthropicMessagesResponse {
	content: Array<{
		type: "text";
		text: string;
	}>;
}

export async function generateText(
	apiKey: string,
	prompt: string,
	options: {
		model?: string;
		maxTokens?: number;
	} = {},
): Promise<string> {
	const { model = "claude-sonnet-4-20250514", maxTokens = 1000 } = options;

	const response = await fetchWithRetry(
		`${ANTHROPIC_API_BASE}/messages`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				messages: [{ role: "user", content: prompt }],
			}),
		},
		{ maxRetries: 3, backoffMs: 1000, timeoutMs: 60000 },
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
	}

	const data: AnthropicMessagesResponse = await response.json();
	return data.content[0]?.text || "";
}
