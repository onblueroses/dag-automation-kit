import { z } from "zod";

/**
 * Twitter/X OAuth2 credential definition.
 *
 * Note: defineOAuth2Credential helper does not exist in this codebase,
 * so the credential is defined as a plain object with the same shape.
 */
export const twitterCredential = {
	type: "oauth2_pkce" as const,
	pkce: true,
	name: "twitter",
	displayName: "Twitter/X OAuth2",
	documentationUrl: "https://developer.twitter.com/en/docs",
	config: {
		authorizationUrl: "https://twitter.com/i/oauth2/authorize",
		tokenUrl: "https://api.twitter.com/2/oauth2/token",
		scopes: ["tweet.read", "users.read", "offline.access"],
		pkce: true,
	},
	schema: z.object({
		clientId: z.string(),
		clientSecret: z.string(),
		accessToken: z.string(),
		refreshToken: z.string().optional(),
		expiresAt: z.number().optional(),
		// OAuth 1.0a — enables read + write operations
		consumerKey: z.string().optional(),
		consumerSecret: z.string().optional(),
		accessTokenSecret: z.string().optional(),
		bearerToken: z.string().optional(),
	}),
};
