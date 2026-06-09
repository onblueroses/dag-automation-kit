import { z } from "zod";

export const WordPressCredential = {
	name: "wordpress" as const,
	type: "basic" as const,
	displayName: "WordPress Application Password",
	documentationUrl:
		"https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/",
	schema: z.object({
		siteUrl: z.string().url(),
		username: z.string(),
		applicationPassword: z.string(),
	}),
};
