import { z } from "zod";
import { defineNode } from "../../core/node.js";

export const approvalGateNode = defineNode({
	type: "approval-gate",
	name: "Approval Gate",
	description:
		"Pauses workflow for human approval. Optionally sends an email notification via emailNotifier service.",
	category: "logic",
	inputSchema: z.object({
		message: z.string().describe("Draft text or summary for the reviewer"),
		nextNode: z.string().describe("Step to continue to after approval"),
		metadata: z
			.record(z.unknown())
			.optional()
			.describe("Extra context for the notification email"),
		workflowId: z
			.string()
			.optional()
			.describe("Workflow ID for the email link. Injected by the store layer."),
	}),
	outputSchema: z.object({
		message: z.string(),
		metadata: z.record(z.unknown()).optional(),
	}),
	capabilities: { supportsApproval: true },
	executor: async (input, context) => {
		const emailNotifier = context.services.emailNotifier;
		if (emailNotifier && input.workflowId) {
			await emailNotifier.sendApproval({
				workflowId: input.workflowId,
				message: input.message,
				metadata: input.metadata,
			});
		}

		return {
			success: true,
			output: { message: input.message, metadata: input.metadata },
			approvalRequired: true,
			nextNode: input.nextNode,
		};
	},
});
