import { z } from "zod";

export const devtoCredential = {
	name: "devto" as const,
	type: "api_key" as const,
	displayName: "Dev.to API Key",
	documentationUrl: "https://developers.forem.com/api#section/Authentication",
	schema: z.object({
		apiKey: z.string(),
	}),
};
