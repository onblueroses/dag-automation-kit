import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNode } from "../../src/core/node.js";
import { NodeRegistry } from "../../src/core/registry.js";
import { createApprovalApp } from "../../src/infra/approval-server.js";
import type { WorkflowRecord } from "../../src/infra/types.js";
import { SqliteWorkflowStore } from "../../src/infra/workflow-store.js";

const publishNode = defineNode({
	type: "publish",
	name: "Publish",
	category: "action",
	inputSchema: z.object({}).passthrough(),
	outputSchema: z.object({ published: z.boolean() }),
	executor: async () => ({ success: true, output: { published: true } }),
});

function makeRecord(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
	return {
		id: overrides.id ?? "wf-001",
		status: overrides.status ?? "paused",
		workflowResult: overrides.workflowResult ?? {
			steps: [
				{
					stepId: "gate",
					nodeType: "approval-gate",
					result: {
						success: true,
						approvalRequired: true,
						nextNode: "publish",
						output: { message: "test" },
					},
				},
			],
			success: true,
			pausedAt: "gate",
		},
		contextSnapshot: overrides.contextSnapshot ?? {
			gate: { message: "test" },
			message: "test",
		},
		steps: overrides.steps ?? {
			gate: {
				nodeType: "approval-gate",
				input: { message: "test", nextNode: "publish" },
			},
			publish: { nodeType: "publish", input: {} },
		},
		startNode: overrides.startNode ?? "gate",
		metadata: overrides.metadata ?? {},
		createdAt: overrides.createdAt ?? "2026-02-24T10:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-02-24T10:00:00.000Z",
	};
}

describe("ApprovalServer", () => {
	let store: SqliteWorkflowStore;
	let registry: NodeRegistry;
	let app: ReturnType<typeof createApprovalApp>;

	beforeEach(() => {
		store = new SqliteWorkflowStore(":memory:");
		registry = new NodeRegistry();
		registry.register(publishNode);
		app = createApprovalApp({ store, registry, services: {} });
	});

	afterEach(() => {
		store.close();
	});

	it("GET /health returns ok", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	it("GET /pending returns paused workflows", async () => {
		store.save(makeRecord({ id: "wf-001" }));
		store.save(makeRecord({ id: "wf-002", status: "completed" }));

		const res = await app.request("/pending");
		const body = (await res.json()) as Array<{ id: string }>;
		expect(body).toHaveLength(1);
		expect(body[0].id).toBe("wf-001");
	});

	it("GET /approve/:id resumes the workflow", async () => {
		store.save(makeRecord());

		const res = await app.request("/approve/wf-001");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			result: { success: boolean };
		};
		expect(body.status).toBe("completed");
		expect(body.result.success).toBe(true);

		const record = store.load("wf-001");
		expect(record?.status).toBe("completed");
	});

	it("GET /approve/:id returns 404 for missing workflow", async () => {
		const res = await app.request("/approve/nonexistent");
		expect(res.status).toBe(404);
	});

	it("GET /approve/:id returns 409 for non-paused workflow", async () => {
		store.save(makeRecord({ status: "completed" }));
		const res = await app.request("/approve/wf-001");
		expect(res.status).toBe(409);
	});

	it("GET /reject/:id marks workflow as rejected", async () => {
		store.save(makeRecord());

		const res = await app.request("/reject/wf-001");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "rejected" });

		const record = store.load("wf-001");
		expect(record?.status).toBe("rejected");
	});

	it("GET /reject/:id returns 404 for missing workflow", async () => {
		const res = await app.request("/reject/nonexistent");
		expect(res.status).toBe(404);
	});

	it("GET /reject/:id returns 409 for non-paused workflow", async () => {
		store.save(makeRecord({ status: "approved" }));
		const res = await app.request("/reject/wf-001");
		expect(res.status).toBe(409);
	});
});
