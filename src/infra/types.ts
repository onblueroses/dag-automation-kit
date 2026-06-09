import type { WorkflowResult, WorkflowStep } from "../core/types.js";

export type WorkflowStatus =
	| "paused"
	| "approved"
	| "rejected"
	| "completed"
	| "error";

export interface WorkflowRecord {
	id: string;
	status: WorkflowStatus;
	workflowResult: WorkflowResult;
	contextSnapshot: Record<string, unknown>;
	steps: Record<string, WorkflowStep>;
	startNode: string;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export interface EmailNotifierService {
	sendApproval(params: {
		workflowId: string;
		message: string;
		metadata?: Record<string, unknown>;
	}): Promise<void>;
}

// Module augmentation: add emailNotifier to NodeServices
declare module "../core/types.js" {
	interface NodeServices {
		emailNotifier?: EmailNotifierService;
	}
}
