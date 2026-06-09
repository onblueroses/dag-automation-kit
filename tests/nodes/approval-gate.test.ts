import { describe, expect, it, vi } from "vitest";
import { ExecutionContext } from "../../src/core/context.js";
import { NodeRegistry } from "../../src/core/registry.js";
import type { EmailNotifierService } from "../../src/infra/types.js";
import { approvalGateNode } from "../../src/nodes/logic/approval-gate.js";

describe("approval-gate node", () => {
	it("returns approvalRequired: true", async () => {
		const registry = new NodeRegistry();
		registry.register(approvalGateNode);
		const ctx = new ExecutionContext();

		const result = await registry.execute(
			"approval-gate",
			{
				message: "Review this draft",
				nextNode: "publish",
			},
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.approvalRequired).toBe(true);
		expect(result.nextNode).toBe("publish");
		expect(result.output).toEqual({ message: "Review this draft" });
	});

	it("calls emailNotifier when available and workflowId provided", async () => {
		const mockNotifier: EmailNotifierService = {
			sendApproval: vi.fn().mockResolvedValue(undefined),
		};
		const registry = new NodeRegistry();
		registry.register(approvalGateNode);
		const ctx = new ExecutionContext({ emailNotifier: mockNotifier });

		await registry.execute(
			"approval-gate",
			{
				message: "Draft text",
				nextNode: "publish",
				workflowId: "wf-001",
				metadata: { source: "reddit" },
			},
			ctx,
		);

		expect(mockNotifier.sendApproval).toHaveBeenCalledWith({
			workflowId: "wf-001",
			message: "Draft text",
			metadata: { source: "reddit" },
		});
	});

	it("works without emailNotifier", async () => {
		const registry = new NodeRegistry();
		registry.register(approvalGateNode);
		const ctx = new ExecutionContext();

		const result = await registry.execute(
			"approval-gate",
			{
				message: "No email",
				nextNode: "next",
			},
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.approvalRequired).toBe(true);
	});

	it("does not call emailNotifier without workflowId", async () => {
		const mockNotifier: EmailNotifierService = {
			sendApproval: vi.fn().mockResolvedValue(undefined),
		};
		const registry = new NodeRegistry();
		registry.register(approvalGateNode);
		const ctx = new ExecutionContext({ emailNotifier: mockNotifier });

		await registry.execute(
			"approval-gate",
			{
				message: "Draft",
				nextNode: "next",
			},
			ctx,
		);

		expect(mockNotifier.sendApproval).not.toHaveBeenCalled();
	});

	it("passes through nextNode from input", async () => {
		const registry = new NodeRegistry();
		registry.register(approvalGateNode);
		const ctx = new ExecutionContext();

		const result = await registry.execute(
			"approval-gate",
			{
				message: "Test",
				nextNode: "custom-step",
			},
			ctx,
		);

		expect(result.nextNode).toBe("custom-step");
	});
});
