import type { WorkflowResult, WorkflowStep } from "./types.js";

export interface WorkflowState {
	id: string;
	status: "running" | "paused" | "completed" | "error";
	result: WorkflowResult;
	contextSnapshot: Record<string, unknown>;
	steps: Record<string, WorkflowStep>;
	startNode: string;
}

export interface WorkflowStore {
	save(state: WorkflowState): void | Promise<void>;
	load(id: string): WorkflowState | null | Promise<WorkflowState | null>;
}

export function createMemoryStore(): WorkflowStore {
	const map = new Map<string, WorkflowState>();
	return {
		save(state: WorkflowState): void {
			map.set(state.id, structuredClone(state));
		},
		load(id: string): WorkflowState | null {
			const state = map.get(id);
			return state ? structuredClone(state) : null;
		},
	};
}
