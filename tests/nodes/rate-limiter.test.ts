import { describe, expect, it } from "vitest";
import { createExecutionContext } from "../../src/core/context.js";
import { rateLimiterNode } from "../../src/nodes/logic/rate-limiter.js";

describe("rateLimiterNode", () => {
	const ctx = createExecutionContext();

	it("passes all items through in fixed strategy", async () => {
		const items = [1, 2, 3, 4, 5];
		const result = await rateLimiterNode.executor(
			{ items, requestsPerWindow: 10, windowMs: 100, strategy: "fixed" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output?.processedItems).toEqual(items);
		expect(result.output?.totalItems).toBe(5);
		expect(result.output?.strategy).toBe("fixed");
	});

	it("passes all items through in sliding strategy", async () => {
		const items = ["a", "b", "c"];
		const result = await rateLimiterNode.executor(
			{ items, requestsPerWindow: 100, windowMs: 100, strategy: "sliding" },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.output?.processedItems).toEqual(items);
		expect(result.output?.totalItems).toBe(3);
	});

	it("reports timing metadata", async () => {
		const result = await rateLimiterNode.executor(
			{ items: [1], requestsPerWindow: 1, windowMs: 100, strategy: "fixed" },
			ctx,
		);
		expect(result.output?.totalDurationMs).toBeGreaterThanOrEqual(0);
		expect(result.output?.windowMs).toBe(100);
		expect(result.output?.requestsPerWindow).toBe(1);
	});
});
