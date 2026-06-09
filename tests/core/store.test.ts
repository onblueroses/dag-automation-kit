import { describe, expect, it } from "vitest";
import type { WorkflowState } from "../../src/core/store.js";
import { createMemoryStore } from "../../src/core/store.js";

const makeState = (
	id: string,
	status: WorkflowState["status"] = "completed",
): WorkflowState => ({
	id,
	status,
	result: { steps: [], success: status === "completed" },
	contextSnapshot: { key: "value" },
	steps: { start: { nodeType: "test", input: {} } },
	startNode: "start",
});

describe("createMemoryStore", () => {
	it("save and load round-trip", () => {
		const store = createMemoryStore();
		const state = makeState("wf-1");
		store.save(state);
		const loaded = store.load("wf-1");
		expect(loaded).toEqual(state);
	});

	it("load returns null for unknown ID", () => {
		const store = createMemoryStore();
		expect(store.load("nonexistent")).toBeNull();
	});

	it("save overwrites existing state", () => {
		const store = createMemoryStore();
		store.save(makeState("wf-1", "paused"));
		store.save(makeState("wf-1", "completed"));
		const loaded = store.load("wf-1");
		expect(loaded?.status).toBe("completed");
	});

	it("stored state is a deep copy (mutations do not leak)", () => {
		const store = createMemoryStore();
		const state = makeState("wf-1");
		store.save(state);

		// Mutate the original
		state.contextSnapshot.key = "mutated";

		const loaded = store.load("wf-1");
		expect(loaded?.contextSnapshot.key).toBe("value");

		// Mutate the loaded copy
		if (loaded) loaded.contextSnapshot.key = "mutated-again";
		const loaded2 = store.load("wf-1");
		expect(loaded2?.contextSnapshot.key).toBe("value");
	});
});
