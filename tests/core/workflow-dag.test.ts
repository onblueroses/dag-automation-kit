import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext } from "../../src/core/context.js";
import type { DAGDefinition } from "../../src/core/graph.js";
import { defineNode } from "../../src/core/node.js";
import { createRegistry } from "../../src/core/registry.js";
import type { StepEvent } from "../../src/core/types.js";
import { runDAGWorkflow } from "../../src/core/workflow.js";

const echoNode = defineNode({
	type: "echo",
	name: "Echo",
	category: "action",
	inputSchema: z.object({ value: z.string() }),
	outputSchema: z.object({ value: z.string() }),
	executor: async (input) => ({ success: true, output: input }),
});

const delayEchoNode = defineNode({
	type: "delay-echo",
	name: "Delay Echo",
	category: "action",
	inputSchema: z.object({ value: z.string(), delayMs: z.number() }),
	outputSchema: z.object({ value: z.string(), timestamp: z.number() }),
	executor: async (input) => {
		await new Promise((r) => setTimeout(r, input.delayMs));
		return {
			success: true,
			output: { value: input.value, timestamp: Date.now() },
		};
	},
});

const failNode = defineNode({
	type: "fail",
	name: "Fail",
	category: "action",
	inputSchema: z.object({}),
	outputSchema: z.object({}),
	executor: async () => ({ success: false, error: "Intentional failure" }),
});

describe("runDAGWorkflow", () => {
	it("executes a single node", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [{ id: "a", nodeType: "echo", input: { value: "hello" } }],
			edges: [],
		};

		const result = await runDAGWorkflow(dag, registry, ctx);
		expect(result.success).toBe(true);
		expect(result.steps.length).toBe(1);
		expect(result.steps[0].result.output).toEqual({ value: "hello" });
	});

	it("executes linear chain in order", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [
				{ id: "a", nodeType: "echo", input: { value: "first" } },
				{ id: "b", nodeType: "echo", input: { value: "{{a.value}}-second" } },
			],
			edges: [{ from: "a", to: "b" }],
		};

		const result = await runDAGWorkflow(dag, registry, ctx);
		expect(result.success).toBe(true);
		expect(result.steps.length).toBe(2);
		expect(result.steps[1].result.output).toEqual({ value: "first-second" });
	});

	it("diamond graph executes B+C concurrently", async () => {
		const registry = createRegistry();
		registry.register(delayEchoNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [
				{
					id: "a",
					nodeType: "delay-echo",
					input: { value: "start", delayMs: 10 },
				},
				{
					id: "b",
					nodeType: "delay-echo",
					input: { value: "left", delayMs: 100 },
				},
				{
					id: "c",
					nodeType: "delay-echo",
					input: { value: "right", delayMs: 100 },
				},
				{
					id: "d",
					nodeType: "delay-echo",
					input: { value: "end", delayMs: 10 },
				},
			],
			edges: [
				{ from: "a", to: "b" },
				{ from: "a", to: "c" },
				{ from: "b", to: "d" },
				{ from: "c", to: "d" },
			],
		};

		const startTime = Date.now();
		const result = await runDAGWorkflow(dag, registry, ctx);
		const elapsed = Date.now() - startTime;

		expect(result.success).toBe(true);
		expect(result.steps.length).toBe(4);
		// If B and C ran sequentially, elapsed would be ~220ms. Concurrently, ~120ms.
		expect(elapsed).toBeLessThan(200);
	});

	it("failure in wave 2 stops wave 3", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		registry.register(failNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [
				{ id: "a", nodeType: "echo", input: { value: "ok" } },
				{ id: "b", nodeType: "fail", input: {} },
				{ id: "c", nodeType: "echo", input: { value: "unreachable" } },
			],
			edges: [
				{ from: "a", to: "b" },
				{ from: "b", to: "c" },
			],
		};

		const result = await runDAGWorkflow(dag, registry, ctx);
		expect(result.success).toBe(false);
		expect(result.steps.length).toBe(2); // a and b, not c
		expect(result.error?.code).toBe("NODE_FAILED");
	});

	it("context from wave 1 is available in wave 2 via interpolation", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [
				{ id: "producer", nodeType: "echo", input: { value: "data" } },
				{
					id: "consumer",
					nodeType: "echo",
					input: { value: "{{producer.value}}" },
				},
			],
			edges: [{ from: "producer", to: "consumer" }],
		};

		const result = await runDAGWorkflow(dag, registry, ctx);
		expect(result.success).toBe(true);
		expect(result.steps[1].result.output).toEqual({ value: "data" });
	});

	it("onStep receives events for all nodes with durationMs", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();
		const events: StepEvent[] = [];

		const dag: DAGDefinition = {
			nodes: [
				{ id: "a", nodeType: "echo", input: { value: "1" } },
				{ id: "b", nodeType: "echo", input: { value: "2" } },
			],
			edges: [{ from: "a", to: "b" }],
		};

		await runDAGWorkflow(dag, registry, ctx, { onStep: (e) => events.push(e) });
		expect(events.length).toBe(2);
		expect(events[0].stepId).toBe("a");
		expect(events[1].stepId).toBe("b");
		expect(typeof events[0].durationMs).toBe("number");
	});

	it("all disconnected nodes run in one wave", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();

		const dag: DAGDefinition = {
			nodes: [
				{ id: "a", nodeType: "echo", input: { value: "1" } },
				{ id: "b", nodeType: "echo", input: { value: "2" } },
				{ id: "c", nodeType: "echo", input: { value: "3" } },
			],
			edges: [],
		};

		const result = await runDAGWorkflow(dag, registry, ctx);
		expect(result.success).toBe(true);
		expect(result.steps.length).toBe(3);
	});
});
