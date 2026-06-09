import { z } from "zod";
import { defineNode } from "../../core/node.js";

export const RetryInputSchema = z.object({
	maxRetries: z.number().min(1).max(10),
	initialDelayMs: z.number().min(0).max(60000).default(1000),
	maxDelayMs: z.number().min(0).max(300000).default(30000),
	backoffMultiplier: z.number().min(1).max(10).default(2),
	retryOn: z.array(z.string()).default([]),
	payload: z.any().optional(),
});

export type RetryInput = z.infer<typeof RetryInputSchema>;

export const RetryOutputSchema = z.object({
	maxRetries: z.number(),
	delays: z.array(z.number()),
	retryOn: z.array(z.string()),
	payload: z.any().optional(),
});

export type RetryOutput = z.infer<typeof RetryOutputSchema>;

function calculateDelay(
	attempt: number,
	initialDelayMs: number,
	maxDelayMs: number,
	backoffMultiplier: number,
): number {
	const exponentialDelay = initialDelayMs * backoffMultiplier ** attempt;
	const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
	// Jitter: +/-10% to spread out concurrent retries
	const jitter = cappedDelay * 0.1 * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(cappedDelay + jitter));
}

export const retryNode = defineNode({
	type: "retry",
	name: "Retry Config",
	description:
		"Compute a retry schedule with exponential backoff and jitter. Outputs delay timings for the host to orchestrate.",
	category: "logic",
	inputSchema: RetryInputSchema,
	outputSchema: RetryOutputSchema,
	executor: async (input) => {
		const {
			maxRetries,
			initialDelayMs = 1000,
			maxDelayMs = 30000,
			backoffMultiplier = 2,
			retryOn = [],
			payload,
		} = input;

		const delays: number[] = [];
		for (let i = 0; i < maxRetries; i++) {
			delays.push(
				calculateDelay(i, initialDelayMs, maxDelayMs, backoffMultiplier),
			);
		}

		return {
			success: true,
			output: {
				maxRetries,
				delays,
				retryOn,
				payload,
			},
		};
	},
});
