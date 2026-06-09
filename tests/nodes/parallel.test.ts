import { describe, expect, it } from "vitest";
import { createExecutionContext } from "../../src/core/context.js";
import { createRegistry } from "../../src/core/registry.js";
import { parallelNode } from "../../src/nodes/logic/parallel.js";

describe("parallelNode", () => {
	it("returns parallel field with branch step IDs", async () => {
		const registry = createRegistry();
		registry.register(parallelNode);
		const ctx = createExecutionContext();

		const result = await registry.execute(
			"parallel",
			{ branches: ["a", "b"] },
			ctx,
		);
		expect(result.success).toBe(true);
		expect(result.parallel).toEqual(["a", "b"]);
		expect(result.output).toEqual({ branches: ["a", "b"] });
	});

	it("passes through nextNode", async () => {
		const registry = createRegistry();
		registry.register(parallelNode);
		const ctx = createExecutionContext();

		const result = await registry.execute(
			"parallel",
			{ branches: ["a"], nextNode: "merge" },
			ctx,
		);
		expect(result.nextNode).toBe("merge");
	});

	it("requires at least one branch", async () => {
		const registry = createRegistry();
		registry.register(parallelNode);
		const ctx = createExecutionContext();

		await expect(
			registry.execute("parallel", { branches: [] }, ctx),
		).rejects.toThrow();
	});
});
