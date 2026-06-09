import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRecord } from "../../src/infra/types.js";
import { SqliteWorkflowStore } from "../../src/infra/workflow-store.js";

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
					},
				},
			],
			success: true,
			pausedAt: "gate",
		},
		contextSnapshot: overrides.contextSnapshot ?? { draft: "Hello world" },
		steps: overrides.steps ?? {
			gate: {
				nodeType: "approval-gate",
				input: { message: "Hello world", nextNode: "publish" },
			},
			publish: { nodeType: "action-publish", input: {} },
		},
		startNode: overrides.startNode ?? "gate",
		metadata: overrides.metadata ?? { source: "test" },
		createdAt: overrides.createdAt ?? "2026-02-24T10:00:00.000Z",
		updatedAt: overrides.updatedAt ?? "2026-02-24T10:00:00.000Z",
	};
}

describe("SqliteWorkflowStore", () => {
	let store: SqliteWorkflowStore;

	beforeEach(() => {
		store = new SqliteWorkflowStore(":memory:");
	});

	afterEach(() => {
		store.close();
	});

	it("saves and loads a record", () => {
		const record = makeRecord();
		store.save(record);
		const loaded = store.load("wf-001");
		expect(loaded).toEqual(record);
	});

	it("returns null for missing id", () => {
		expect(store.load("nonexistent")).toBeNull();
	});

	it("updates status", () => {
		store.save(makeRecord());
		store.updateStatus("wf-001", "approved");
		const loaded = store.load("wf-001");
		expect(loaded?.status).toBe("approved");
		expect(loaded?.updatedAt).not.toBe("2026-02-24T10:00:00.000Z");
	});

	it("lists by status", () => {
		store.save(makeRecord({ id: "wf-001" }));
		store.save(makeRecord({ id: "wf-002" }));
		store.save(makeRecord({ id: "wf-003", status: "completed" }));

		const paused = store.listByStatus("paused");
		expect(paused).toHaveLength(2);
		expect(paused.map((r) => r.id)).toContain("wf-001");
		expect(paused.map((r) => r.id)).toContain("wf-002");

		const completed = store.listByStatus("completed");
		expect(completed).toHaveLength(1);
		expect(completed[0].id).toBe("wf-003");
	});

	it("throws on duplicate primary key", () => {
		store.save(makeRecord());
		expect(() => store.save(makeRecord())).toThrow();
	});

	it("preserves complex nested data through roundtrip", () => {
		const record = makeRecord({
			contextSnapshot: {
				posts: [{ title: "Test", score: 42 }],
				nested: { deep: { value: true } },
			},
			metadata: { tags: ["a", "b"], count: 3 },
		});
		store.save(record);
		const loaded = store.load(record.id);
		expect(loaded?.contextSnapshot).toEqual(record.contextSnapshot);
		expect(loaded?.metadata).toEqual(record.metadata);
	});
});
