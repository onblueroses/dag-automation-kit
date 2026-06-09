import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ExecutionContext } from "../../src/core/context.js";
import { defineNode } from "../../src/core/node.js";
import { NodeRegistry } from "../../src/core/registry.js";
import { runWorkflow } from "../../src/core/workflow.js";
import { createApprovalApp } from "../../src/infra/approval-server.js";
import type {
	EmailNotifierService,
	WorkflowRecord,
} from "../../src/infra/types.js";
import { SqliteWorkflowStore } from "../../src/infra/workflow-store.js";
import { approvalGateNode } from "../../src/nodes/logic/approval-gate.js";

// Producer node: generates a draft
const producerNode = defineNode({
	type: "producer",
	name: "Producer",
	category: "action",
	inputSchema: z.object({}),
	outputSchema: z.object({ draft: z.string(), topic: z.string() }),
	executor: async () => ({
		success: true,
		output: { draft: "Quarterly summary ready", topic: "reports" },
		nextNode: "gate",
	}),
});

// Consumer node: runs after approval
const consumerNode = defineNode({
	type: "consumer",
	name: "Consumer",
	category: "action",
	inputSchema: z.object({}).passthrough(),
	outputSchema: z.object({ posted: z.boolean() }),
	executor: async () => ({
		success: true,
		output: { posted: true },
	}),
});

describe("Integration: full approval flow", () => {
	let store: SqliteWorkflowStore;
	let registry: NodeRegistry;
	let mockNotifier: EmailNotifierService;

	const steps = {
		produce: { nodeType: "producer", input: {} },
		gate: {
			nodeType: "approval-gate",
			input: {
				message: "{{producer.draft}}",
				nextNode: "consume",
				workflowId: "", // set per test
				metadata: { topic: "{{producer.topic}}" },
			},
		},
		consume: { nodeType: "consumer", input: {} },
	};

	beforeEach(() => {
		store = new SqliteWorkflowStore(":memory:");
		registry = new NodeRegistry();
		registry.register(producerNode);
		registry.register(approvalGateNode);
		registry.register(consumerNode);
		mockNotifier = { sendApproval: vi.fn().mockResolvedValue(undefined) };
	});

	afterEach(() => {
		store.close();
	});

	it("full flow: produce -> pause -> persist -> approve -> consume", async () => {
		const workflowId = crypto.randomUUID();
		const testSteps = {
			...steps,
			gate: { ...steps.gate, input: { ...steps.gate.input, workflowId } },
		};

		// Phase 1: Run workflow until it pauses at the approval gate
		const ctx = new ExecutionContext({ emailNotifier: mockNotifier });
		const result = await runWorkflow(testSteps, "produce", registry, ctx);

		expect(result.success).toBe(true);
		expect(result.pausedAt).toBe("gate");
		expect(result.steps).toHaveLength(2); // produce + gate

		// Email was sent
		expect(mockNotifier.sendApproval).toHaveBeenCalledOnce();
		expect(
			(mockNotifier.sendApproval as ReturnType<typeof vi.fn>).mock.calls[0][0]
				.message,
		).toBe("Quarterly summary ready");

		// Phase 2: Persist to store
		const record: WorkflowRecord = {
			id: workflowId,
			status: "paused",
			workflowResult: result,
			contextSnapshot: ctx.snapshot(),
			steps: testSteps,
			startNode: "produce",
			metadata: { topic: "reports" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};
		store.save(record);

		// Verify it's in the store
		const loaded = store.load(workflowId);
		expect(loaded).not.toBeNull();
		expect(loaded?.status).toBe("paused");

		// Phase 3: Approve via HTTP
		const app = createApprovalApp({
			store,
			registry,
			services: { emailNotifier: mockNotifier },
		});
		const res = await app.request(`/approve/${workflowId}`);
		expect(res.status).toBe(200);

		const body = (await res.json()) as {
			status: string;
			result: { success: boolean; steps: Array<{ stepId: string }> };
		};
		expect(body.status).toBe("completed");
		expect(body.result.success).toBe(true);

		// Consumer ran (steps include produce + gate + consume)
		const allStepIds = body.result.steps.map(
			(s: { stepId: string }) => s.stepId,
		);
		expect(allStepIds).toContain("consume");

		// Store updated
		const final = store.load(workflowId);
		expect(final?.status).toBe("completed");
	});

	it("reject flow: produce -> pause -> persist -> reject", async () => {
		const workflowId = crypto.randomUUID();
		const testSteps = {
			...steps,
			gate: { ...steps.gate, input: { ...steps.gate.input, workflowId } },
		};

		const ctx = new ExecutionContext({ emailNotifier: mockNotifier });
		const result = await runWorkflow(testSteps, "produce", registry, ctx);
		expect(result.pausedAt).toBe("gate");

		store.save({
			id: workflowId,
			status: "paused",
			workflowResult: result,
			contextSnapshot: ctx.snapshot(),
			steps: testSteps,
			startNode: "produce",
			metadata: {},
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});

		const app = createApprovalApp({ store, registry, services: {} });
		const res = await app.request(`/reject/${workflowId}`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "rejected" });

		const final = store.load(workflowId);
		expect(final?.status).toBe("rejected");
	});
});
