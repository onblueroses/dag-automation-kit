import { z } from "zod";

export const apifyCredential = {
	name: "apify" as const,
	type: "bearer" as const,
	displayName: "Apify API Token",
	documentationUrl: "https://docs.apify.com/platform/integrations/api",
	schema: z.object({
		apiToken: z.string(),
	}),
};
