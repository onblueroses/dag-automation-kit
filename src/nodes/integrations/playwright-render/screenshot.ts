import { defineNode } from "../../../core/node.js";
import {
	type PlaywrightScreenshotInput,
	PlaywrightScreenshotInputSchema,
	PlaywrightScreenshotOutputSchema,
} from "./schemas.js";

export const playwrightScreenshotNode = defineNode({
	type: "playwright_screenshot",
	name: "Playwright Screenshot",
	category: "action",
	inputSchema: PlaywrightScreenshotInputSchema,
	outputSchema: PlaywrightScreenshotOutputSchema,
	executor: async (input: PlaywrightScreenshotInput) => {
		// Dynamic import - playwright is an optional peer dependency (types in playwright.d.ts)
		const { chromium } = await import("playwright");
		const browser = await chromium.launch({ headless: true });

		try {
			const page = await browser.newPage({
				viewport: { width: input.width, height: input.height },
			});

			await page.setContent(input.html, { waitUntil: "networkidle" });
			await page.screenshot({ path: input.outputPath, fullPage: false });

			return {
				success: true,
				output: { imagePath: input.outputPath },
			};
		} finally {
			await browser.close();
		}
	},
});
