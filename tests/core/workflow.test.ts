import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext } from "../../src/core/context.js";
import { defineNode } from "../../src/core/node.js";
import { createRegistry } from "../../src/core/registry.js";
import { createMemoryStore } from "../../src/core/store.js";
import type { StepEvent } from "../../src/core/types.js";
import {
	resumeById,
	resumeWorkflow,
	runWorkflow,
} from "../../src/core/workflow.js";

// Helpers
const makeNode = (type: string, output: unknown, nextNode?: string) =>
	defineNode({
		type,
		name: type,
		category: "action",
		inputSchema: z.object({}).passthrough(),
		outputSchema: z.unknown(),
		executor: async () => ({ success: true, output, nextNode }),
	});

const makeFailNode = (type: string, error = "something went wrong") =>
	defineNode({
		type,
		name: type,
		category: "action",
		inputSchema: z.object({}).passthrough(),
		outputSchema: z.unknown(),
		executor: async () => ({ success: false, error }),
	});

const makeApprovalNode = (type: string) =>
	defineNode({
		type,
		name: type,
		category: "action",
		inputSchema: z.object({}).passthrough(),
		outputSchema: z.object({ pending: z.boolean() }),
		executor: async () => ({
			success: true,
			output: { pending: true },
			approvalRequired: true,
		}),
	});

describe("runWorkflow", () => {
	it("runs a single-node workflow and returns success", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", { value: 1 }));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ a: { nodeType: "step_a", input: {} } },
			"a",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps).toHaveLength(1);
		expect(result.steps[0].nodeType).toBe("step_a");
	});

	it("includes stepId in each result step", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", { fromA: true }, "b"));
		registry.register(makeNode("step_b", { fromB: true }));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				a: { nodeType: "step_a", input: {} },
				b: { nodeType: "step_b", input: {} },
			},
			"a",
			registry,
			ctx,
		);

		expect(result.steps[0].stepId).toBe("a");
		expect(result.steps[1].stepId).toBe("b");
	});

	it("runs a linear chain by following nextNode", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", { fromA: true }, "b"));
		registry.register(makeNode("step_b", { fromB: true }, "c"));
		registry.register(makeNode("step_c", { fromC: true }));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				a: { nodeType: "step_a", input: {} },
				b: { nodeType: "step_b", input: {} },
				c: { nodeType: "step_c", input: {} },
			},
			"a",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps).toHaveLength(3);
		expect(result.steps.map((s) => s.nodeType)).toEqual([
			"step_a",
			"step_b",
			"step_c",
		]);
	});

	it("stores node output in context for downstream interpolation", async () => {
		const registry = createRegistry();
		registry.register(makeNode("fetch", { count: 5 }, "check"));
		registry.register(
			defineNode({
				type: "check",
				name: "check",
				category: "logic",
				inputSchema: z.object({ label: z.string() }),
				outputSchema: z.object({ seen: z.string() }),
				executor: async (input) => ({
					success: true,
					output: { seen: input.label },
				}),
			}),
		);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				fetch: { nodeType: "fetch", input: {} },
				check: {
					nodeType: "check",
					input: { label: "count is {{fetch.count}}" },
				},
			},
			"fetch",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps[1].result.output).toEqual({ seen: "count is 5" });
	});

	it("halts on node failure and returns error", async () => {
		const registry = createRegistry();
		registry.register(makeFailNode("bad_node"));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ start: { nodeType: "bad_node", input: {} } },
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("NODE_FAILED");
		expect(result.error?.message).toContain("something went wrong");
		expect(result.error?.stepId).toBe("start");
		expect(result.error?.nodeType).toBe("bad_node");
	});

	it("halts on approvalRequired and sets pausedAt", async () => {
		const registry = createRegistry();
		registry.register(makeApprovalNode("needs_review"));
		registry.register(makeNode("after_review", {}));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				review: { nodeType: "needs_review", input: {} },
				after: { nodeType: "after_review", input: {} },
			},
			"review",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.pausedAt).toBe("review");
		expect(result.steps).toHaveLength(1); // halted before 'after'
	});

	it("returns error for missing step ID", async () => {
		const registry = createRegistry();
		registry.register(makeNode("a", {}, "nonexistent"));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ start: { nodeType: "a", input: {} } },
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("STEP_NOT_FOUND");
		expect(result.error?.message).toContain("nonexistent");
		expect(result.error?.stepId).toBe("nonexistent");
	});

	it("catches executor exceptions and returns error", async () => {
		const throwingNode = defineNode({
			type: "thrower",
			name: "Thrower",
			category: "action",
			inputSchema: z.object({}),
			outputSchema: z.unknown(),
			executor: async () => {
				throw new Error("executor exploded");
			},
		});
		const registry = createRegistry();
		registry.register(throwingNode);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ start: { nodeType: "thrower", input: {} } },
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("NODE_THREW");
		expect(result.error?.message).toContain("executor exploded");
		expect(result.error?.stepId).toBe("start");
		expect(result.error?.nodeType).toBe("thrower");
		expect(result.error?.cause).toBeInstanceOf(Error);
	});

	it("catches ZodError as VALIDATION_ERROR", async () => {
		const strictNode = defineNode({
			type: "strict",
			name: "Strict",
			category: "action",
			inputSchema: z.object({ required: z.string() }),
			outputSchema: z.unknown(),
			executor: async () => ({ success: true, output: {} }),
		});
		const registry = createRegistry();
		registry.register(strictNode);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ start: { nodeType: "strict", input: { wrong: "field" } } },
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("VALIDATION_ERROR");
		expect(result.error?.stepId).toBe("start");
		expect(result.error?.nodeType).toBe("strict");
	});

	it("stops with error when maxSteps exceeded (cycle protection)", async () => {
		const registry = createRegistry();
		// Two nodes that point at each other
		const pingNode = defineNode({
			type: "ping",
			name: "Ping",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({ success: true, output: {}, nextNode: "b" }),
		});
		const pongNode = defineNode({
			type: "pong",
			name: "Pong",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({ success: true, output: {}, nextNode: "a" }),
		});
		registry.registerAll([pingNode, pongNode]);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				a: { nodeType: "ping", input: {} },
				b: { nodeType: "pong", input: {} },
			},
			"a",
			registry,
			ctx,
			{ maxSteps: 10 },
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("MAX_STEPS_EXCEEDED");
		expect(result.error?.message).toContain("maximum of 10 steps");
		expect(result.steps).toHaveLength(10);
	});

	it("respects custom maxSteps option", async () => {
		const registry = createRegistry();
		const loopNode = defineNode({
			type: "loop",
			name: "Loop",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({ success: true, output: {}, nextNode: "a" }),
		});
		registry.register(loopNode);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{ a: { nodeType: "loop", input: {} } },
			"a",
			registry,
			ctx,
			{ maxSteps: 3 },
		);

		expect(result.success).toBe(false);
		expect(result.steps).toHaveLength(3);
	});

	it("passes actual arrays between nodes via {{ref}} interpolation", async () => {
		const registry = createRegistry();
		const producerNode = defineNode({
			type: "producer",
			name: "Producer",
			category: "action",
			inputSchema: z.object({}),
			outputSchema: z.object({ items: z.array(z.number()) }),
			executor: async () => ({
				success: true,
				output: { items: [10, 20, 30] },
				nextNode: "consumer",
			}),
		});
		const consumerNode = defineNode({
			type: "consumer",
			name: "Consumer",
			category: "action",
			inputSchema: z.object({ data: z.array(z.number()) }),
			outputSchema: z.object({ sum: z.number() }),
			executor: async (input) => ({
				success: true,
				output: { sum: input.data.reduce((a: number, b: number) => a + b, 0) },
			}),
		});
		registry.registerAll([producerNode, consumerNode]);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				produce: { nodeType: "producer", input: {} },
				consumer: {
					nodeType: "consumer",
					input: { data: "{{produce.items}}" },
				},
			},
			"produce",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps[1].result.output).toEqual({ sum: 60 });
	});

	it("supports branching via conditional nextNode", async () => {
		const registry = createRegistry();
		// A node that always routes to 'branch_b'
		const routerNode = defineNode({
			type: "router",
			name: "Router",
			category: "logic",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			executor: async () => ({ success: true, output: {}, nextNode: "b" }),
		});
		registry.register(routerNode);
		registry.register(makeNode("step_a", { from: "a" }));
		registry.register(makeNode("step_b", { from: "b" }));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				route: { nodeType: "router", input: {} },
				a: { nodeType: "step_a", input: {} },
				b: { nodeType: "step_b", input: {} },
			},
			"route",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps).toHaveLength(2);
		expect(result.steps[1].nodeType).toBe("step_b"); // went to b, not a
	});
});

describe("resumeWorkflow", () => {
	it("resumes after approval gate and completes remaining steps", async () => {
		const registry = createRegistry();
		// approval node that routes to 'after' on nextNode
		const approvalNode = defineNode({
			type: "needs_review",
			name: "needs_review",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ pending: z.boolean() }),
			executor: async () => ({
				success: true,
				output: { pending: true },
				approvalRequired: true,
				nextNode: "after",
			}),
		});
		registry.register(approvalNode);
		registry.register(makeNode("after_review", { done: true }));
		const ctx = createExecutionContext();

		const steps = {
			review: { nodeType: "needs_review", input: {} },
			after: { nodeType: "after_review", input: {} },
		};

		// First run pauses at review
		const paused = await runWorkflow(steps, "review", registry, ctx);
		expect(paused.pausedAt).toBe("review");
		expect(paused.steps).toHaveLength(1);

		// Resume continues from the nextNode
		const resumed = await resumeWorkflow(paused, steps, registry, ctx);
		expect(resumed.success).toBe(true);
		expect(resumed.steps).toHaveLength(2);
		expect(resumed.steps[0].nodeType).toBe("needs_review");
		expect(resumed.steps[1].nodeType).toBe("after_review");
	});

	it("preserves context from paused workflow", async () => {
		const registry = createRegistry();
		const dataNode = defineNode({
			type: "data_producer",
			name: "data_producer",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ count: z.number() }),
			executor: async () => ({
				success: true,
				output: { count: 42 },
				nextNode: "gate",
			}),
		});
		const gateNode = defineNode({
			type: "gate",
			name: "gate",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ pending: z.boolean() }),
			executor: async () => ({
				success: true,
				output: { pending: true },
				approvalRequired: true,
				nextNode: "consumer",
			}),
		});
		const consumerNode = defineNode({
			type: "consumer",
			name: "consumer",
			category: "action",
			inputSchema: z.object({ label: z.string() }),
			outputSchema: z.object({ seen: z.string() }),
			executor: async (input) => ({
				success: true,
				output: { seen: input.label },
			}),
		});
		registry.registerAll([dataNode, gateNode, consumerNode]);
		const ctx = createExecutionContext();

		const steps = {
			produce: { nodeType: "data_producer", input: {} },
			gate: { nodeType: "gate", input: {} },
			consumer: {
				nodeType: "consumer",
				input: { label: "count is {{produce.count}}" },
			},
		};

		const paused = await runWorkflow(steps, "produce", registry, ctx);
		expect(paused.pausedAt).toBe("gate");

		const resumed = await resumeWorkflow(paused, steps, registry, ctx);
		expect(resumed.success).toBe(true);
		expect(resumed.steps[2].result.output).toEqual({ seen: "count is 42" });
	});

	it("returns error when result has no pausedAt", async () => {
		const registry = createRegistry();
		const ctx = createExecutionContext();

		const result = await resumeWorkflow(
			{ steps: [], success: true },
			{},
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("RESUME_INVALID");
		expect(result.error?.message).toContain("not paused");
	});

	it("fires onStep hook only for resumed steps, not prior ones", async () => {
		const registry = createRegistry();
		const approvalNode = defineNode({
			type: "needs_review",
			name: "needs_review",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ pending: z.boolean() }),
			executor: async () => ({
				success: true,
				output: { pending: true },
				approvalRequired: true,
				nextNode: "after",
			}),
		});
		registry.register(approvalNode);
		registry.register(makeNode("after_review", { done: true }));
		const ctx = createExecutionContext();

		const steps = {
			review: { nodeType: "needs_review", input: {} },
			after: { nodeType: "after_review", input: {} },
		};

		const paused = await runWorkflow(steps, "review", registry, ctx);
		expect(paused.pausedAt).toBe("review");

		const events: StepEvent[] = [];
		const resumed = await resumeWorkflow(paused, steps, registry, ctx, {
			onStep: (e) => events.push(e),
		});

		expect(resumed.success).toBe(true);
		// onStep should only fire for 'after' (the resumed step), not 'review' (prior)
		expect(events).toHaveLength(1);
		expect(events[0].stepId).toBe("after");
		expect(events[0].nodeType).toBe("after_review");
	});

	it("completes when paused node had no nextNode", async () => {
		const registry = createRegistry();
		// Approval node with no nextNode
		const terminalApproval = defineNode({
			type: "final_review",
			name: "final_review",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ pending: z.boolean() }),
			executor: async () => ({
				success: true,
				output: { pending: true },
				approvalRequired: true,
				// no nextNode
			}),
		});
		registry.register(terminalApproval);
		const ctx = createExecutionContext();

		const steps = { review: { nodeType: "final_review", input: {} } };
		const paused = await runWorkflow(steps, "review", registry, ctx);
		expect(paused.pausedAt).toBe("review");

		const resumed = await resumeWorkflow(paused, steps, registry, ctx);
		expect(resumed.success).toBe(true);
		expect(resumed.steps).toHaveLength(1); // just the original step, nothing more to run
	});
});

describe("onStep hook", () => {
	it("fires for each step with correct data", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", { a: 1 }, "b"));
		registry.register(makeNode("step_b", { b: 2 }));
		const ctx = createExecutionContext();
		const events: StepEvent[] = [];

		await runWorkflow(
			{
				a: { nodeType: "step_a", input: {} },
				b: { nodeType: "step_b", input: {} },
			},
			"a",
			registry,
			ctx,
			{ onStep: (e) => events.push(e) },
		);

		expect(events).toHaveLength(2);
		expect(events[0].stepId).toBe("a");
		expect(events[0].nodeType).toBe("step_a");
		expect(events[0].result.success).toBe(true);
		expect(typeof events[0].durationMs).toBe("number");
		expect(events[1].stepId).toBe("b");
		expect(events[1].nodeType).toBe("step_b");
	});

	it("includes duration timing", async () => {
		const registry = createRegistry();
		const slowNode = defineNode({
			type: "slow",
			name: "Slow",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => {
				await new Promise((r) => setTimeout(r, 50));
				return { success: true, output: {} };
			},
		});
		registry.register(slowNode);
		const ctx = createExecutionContext();
		const events: StepEvent[] = [];

		await runWorkflow(
			{ s: { nodeType: "slow", input: {} } },
			"s",
			registry,
			ctx,
			{ onStep: (e) => events.push(e) },
		);

		expect(events[0].durationMs).toBeGreaterThanOrEqual(40); // allow slight timer variance
	});

	it("does not fire for steps that throw", async () => {
		const throwingNode = defineNode({
			type: "thrower",
			name: "Thrower",
			category: "action",
			inputSchema: z.object({}),
			outputSchema: z.unknown(),
			executor: async () => {
				throw new Error("boom");
			},
		});
		const registry = createRegistry();
		registry.register(throwingNode);
		const ctx = createExecutionContext();
		const events: StepEvent[] = [];

		const result = await runWorkflow(
			{ s: { nodeType: "thrower", input: {} } },
			"s",
			registry,
			ctx,
			{ onStep: (e) => events.push(e) },
		);

		expect(result.success).toBe(false);
		expect(events).toHaveLength(0); // exception before onStep fires
	});

	it("fires on failed nodes (success: false)", async () => {
		const registry = createRegistry();
		registry.register(makeFailNode("bad"));
		const ctx = createExecutionContext();
		const events: StepEvent[] = [];

		await runWorkflow(
			{ s: { nodeType: "bad", input: {} } },
			"s",
			registry,
			ctx,
			{ onStep: (e) => events.push(e) },
		);

		expect(events).toHaveLength(1);
		expect(events[0].result.success).toBe(false);
	});
});

describe("persistence", () => {
	it("auto-persists on completion when store provided", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", { v: 1 }));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{ a: { nodeType: "step_a", input: {} } },
			"a",
			registry,
			ctx,
			{ store },
		);

		expect(result.id).toBeDefined();
		const state = store.load(result.id!);
		expect(state).not.toBeNull();
		expect(state?.status).toBe("completed");
		expect(state?.result.success).toBe(true);
	});

	it("auto-persists on pause", async () => {
		const registry = createRegistry();
		registry.register(makeApprovalNode("gate"));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{ g: { nodeType: "gate", input: {} } },
			"g",
			registry,
			ctx,
			{ store },
		);

		expect(result.pausedAt).toBe("g");
		const state = store.load(result.id!);
		expect(state?.status).toBe("paused");
	});

	it("auto-persists on error", async () => {
		const registry = createRegistry();
		registry.register(makeFailNode("bad"));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{ s: { nodeType: "bad", input: {} } },
			"s",
			registry,
			ctx,
			{ store },
		);

		expect(result.success).toBe(false);
		const state = store.load(result.id!);
		expect(state?.status).toBe("error");
	});

	it("resumeById loads and resumes a paused workflow", async () => {
		const registry = createRegistry();
		const approvalNode = defineNode({
			type: "gate",
			name: "gate",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ pending: z.boolean() }),
			executor: async () => ({
				success: true,
				output: { pending: true },
				approvalRequired: true,
				nextNode: "after",
			}),
		});
		registry.register(approvalNode);
		registry.register(makeNode("done", { complete: true }));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const paused = await runWorkflow(
			{
				g: { nodeType: "gate", input: {} },
				after: { nodeType: "done", input: {} },
			},
			"g",
			registry,
			ctx,
			{ store },
		);

		expect(paused.pausedAt).toBe("g");

		const resumed = await resumeById(
			paused.id!,
			store,
			registry,
			{},
			{ store },
		);
		expect(resumed.success).toBe(true);
		expect(resumed.steps).toHaveLength(2);
	});

	it("uses provided id when given", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", {}));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{ a: { nodeType: "step_a", input: {} } },
			"a",
			registry,
			ctx,
			{ store, id: "custom-id" },
		);

		expect(result.id).toBe("custom-id");
		expect(store.load("custom-id")).not.toBeNull();
	});

	it("generates UUID when id not provided", async () => {
		const registry = createRegistry();
		registry.register(makeNode("step_a", {}));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{ a: { nodeType: "step_a", input: {} } },
			"a",
			registry,
			ctx,
			{ store },
		);

		expect(result.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});
});

describe("parallel execution", () => {
	it("runs two branches in parallel and collects all steps", async () => {
		const registry = createRegistry();
		registry.register(makeNode("fork", {}, undefined));
		registry.register(makeNode("branch_a", { a: 1 }));
		registry.register(makeNode("branch_b", { b: 2 }));
		const ctx = createExecutionContext();

		// Use a node that emits parallel directly
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
			}),
		});
		const reg = createRegistry();
		reg.register(forkNode);
		reg.register(makeNode("branch_a", { a: 1 }));
		reg.register(makeNode("branch_b", { b: 2 }));

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "branch_a", input: {} },
				bb: { nodeType: "branch_b", input: {} },
			},
			"start",
			reg,
			ctx,
		);

		expect(result.success).toBe(true);
		// 1 fork step + 2 branch steps
		expect(result.steps).toHaveLength(3);
		const stepIds = result.steps.map((s) => s.stepId);
		expect(stepIds).toContain("ba");
		expect(stepIds).toContain("bb");
	});

	it("merges branch outputs into parent context", async () => {
		const registry = createRegistry();
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
				nextNode: "merge",
			}),
		});
		const mergeNode = defineNode({
			type: "merge",
			name: "Merge",
			category: "action",
			inputSchema: z.object({ fromA: z.number(), fromB: z.number() }),
			outputSchema: z.object({ sum: z.number() }),
			executor: async (input) => ({
				success: true,
				output: { sum: input.fromA + input.fromB },
			}),
		});
		registry.register(forkNode);
		registry.register(makeNode("producer_a", { x: 10 }));
		registry.register(makeNode("producer_b", { y: 20 }));
		registry.register(mergeNode);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "producer_a", input: {} },
				bb: { nodeType: "producer_b", input: {} },
				merge: {
					nodeType: "merge",
					input: { fromA: "{{ba.x}}", fromB: "{{bb.y}}" },
				},
			},
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.steps).toHaveLength(4);
		const mergeStep = result.steps.find((s) => s.stepId === "merge");
		expect(mergeStep?.result.output).toEqual({ sum: 30 });
	});

	it("fails workflow when any branch fails", async () => {
		const registry = createRegistry();
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
			}),
		});
		registry.register(forkNode);
		registry.register(makeNode("ok_node", { v: 1 }));
		registry.register(makeFailNode("bad_node", "branch failed"));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "ok_node", input: {} },
				bb: { nodeType: "bad_node", input: {} },
			},
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("NODE_FAILED");
	});

	it("rejects approval gates inside parallel branches", async () => {
		const registry = createRegistry();
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
			}),
		});
		registry.register(forkNode);
		registry.register(makeNode("ok_node", {}));
		registry.register(makeApprovalNode("approval_node"));
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "ok_node", input: {} },
				bb: { nodeType: "approval_node", input: {} },
			},
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error?.code).toBe("VALIDATION_ERROR");
		expect(result.error?.message).toContain(
			"Approval gates inside parallel branches",
		);
	});

	it("parallel branches get independent context snapshots", async () => {
		const registry = createRegistry();
		// Set a context value before forking
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
				nextNode: "check",
			}),
		});
		// Each branch writes a different value under the same key
		const writerA = defineNode({
			type: "writer_a",
			name: "WriterA",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ tag: z.string() }),
			executor: async () => ({ success: true, output: { tag: "from_a" } }),
		});
		const writerB = defineNode({
			type: "writer_b",
			name: "WriterB",
			category: "action",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({ tag: z.string() }),
			executor: async () => ({ success: true, output: { tag: "from_b" } }),
		});
		const checkNode = defineNode({
			type: "check",
			name: "Check",
			category: "action",
			inputSchema: z.object({ a: z.string(), b: z.string() }),
			outputSchema: z.object({ a: z.string(), b: z.string() }),
			executor: async (input) => ({ success: true, output: input }),
		});
		registry.registerAll([forkNode, writerA, writerB, checkNode]);
		const ctx = createExecutionContext();

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "writer_a", input: {} },
				bb: { nodeType: "writer_b", input: {} },
				check: {
					nodeType: "check",
					input: { a: "{{ba.tag}}", b: "{{bb.tag}}" },
				},
			},
			"start",
			registry,
			ctx,
		);

		expect(result.success).toBe(true);
		const checkStep = result.steps.find((s) => s.stepId === "check");
		expect(checkStep?.result.output).toEqual({ a: "from_a", b: "from_b" });
	});

	it("auto-persists parallel workflow with store", async () => {
		const registry = createRegistry();
		const forkNode = defineNode({
			type: "fork",
			name: "Fork",
			category: "logic",
			inputSchema: z.object({}).passthrough(),
			outputSchema: z.object({}),
			executor: async () => ({
				success: true,
				output: {},
				parallel: ["ba", "bb"],
			}),
		});
		registry.register(forkNode);
		registry.register(makeNode("branch_a", { a: 1 }));
		registry.register(makeNode("branch_b", { b: 2 }));
		const ctx = createExecutionContext();
		const store = createMemoryStore();

		const result = await runWorkflow(
			{
				start: { nodeType: "fork", input: {} },
				ba: { nodeType: "branch_a", input: {} },
				bb: { nodeType: "branch_b", input: {} },
			},
			"start",
			registry,
			ctx,
			{ store },
		);

		expect(result.success).toBe(true);
		const state = store.load(result.id!);
		expect(state).not.toBeNull();
		expect(state?.status).toBe("completed");
		expect(state?.result.steps).toHaveLength(3);
	});
});
