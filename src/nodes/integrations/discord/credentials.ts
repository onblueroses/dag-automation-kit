import { z } from "zod";

// Credential metadata - used for UI/validation, not at runtime
export const discordBotCredential = {
	name: "discordBot" as const,
	type: "api_key" as const,
	displayName: "Discord Bot Token",
	documentationUrl:
		"https://discord.com/developers/docs/topics/oauth2#bot-tokens",
	schema: z.object({
		botToken: z.string(),
	}),
};

export const discordWebhookCredential = {
	name: "discordWebhook" as const,
	type: "webhook" as const,
	displayName: "Discord Webhook",
	documentationUrl: "https://discord.com/developers/docs/resources/webhook",
	schema: z.object({
		webhookUrl: z.string().url(),
	}),
};
