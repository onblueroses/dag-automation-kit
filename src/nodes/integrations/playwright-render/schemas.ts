import { z } from "zod";

export const PlaywrightScreenshotInputSchema = z.object({
	html: z.string(),
	width: z.number().default(1920),
	height: z.number().default(1080),
	outputPath: z.string(),
});

export type PlaywrightScreenshotInput = z.infer<
	typeof PlaywrightScreenshotInputSchema
>;

export const PlaywrightScreenshotOutputSchema = z.object({
	imagePath: z.string(),
});

export type PlaywrightScreenshotOutput = z.infer<
	typeof PlaywrightScreenshotOutputSchema
>;
