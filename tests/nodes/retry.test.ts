import { describe, expect, it } from "vitest";
import { createExecutionContext } from "../../src/core/context.js";
import { retryNode } from "../../src/nodes/logic/retry.js";

describe("retryNode", () => {
	const ctx = createExecutionContext();

	it("outputs correct number of delays", async () => {
		const result = await retryNode.executor(
			{
				maxRetries: 3,
				initialDelayMs: 100,
				maxDelayMs: 5000,
				backoffMultiplier: 2,
				retryOn: [],
			},
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output?.delays).toHaveLength(3);
		expect(result.output?.maxRetries).toBe(3);
	});

	it("caps delays at maxDelayMs", async () => {
		const result = await retryNode.executor(
			{
				maxRetries: 5,
				initialDelayMs: 1000,
				maxDelayMs: 2000,
				backoffMultiplier: 10,
				retryOn: [],
			},
			ctx,
		);
		// All delays after the first should be capped near 2000 (+/- 10% jitter)
		for (const delay of result.output?.delays.slice(1)) {
			expect(delay).toBeLessThanOrEqual(2200);
		}
	});

	it("passes through payload", async () => {
		const result = await retryNode.executor(
			{
				maxRetries: 1,
				initialDelayMs: 0,
				maxDelayMs: 0,
				backoffMultiplier: 1,
				retryOn: [],
				payload: { key: "val" },
			},
			ctx,
		);
		expect(result.output?.payload).toEqual({ key: "val" });
	});

	it("preserves retryOn filter list", async () => {
		const result = await retryNode.executor(
			{
				maxRetries: 1,
				initialDelayMs: 0,
				maxDelayMs: 0,
				backoffMultiplier: 1,
				retryOn: ["TIMEOUT", "429"],
			},
			ctx,
		);
		expect(result.output?.retryOn).toEqual(["TIMEOUT", "429"]);
	});
});
