import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext } from "../../src/core/context.js";
import { defineNode } from "../../src/core/node.js";
import { createRegistry } from "../../src/core/registry.js";
import { runWorkflow } from "../../src/core/workflow.js";

/**
 * Integration tests requiring Gondolin + QEMU.
 * Run with: GONDOLIN_INTEGRATION=1 npx vitest run tests/integration/sandbox-workflow.test.ts
 */
describe.skipIf(!process.env.GONDOLIN_INTEGRATION)(
	"sandboxed workflow integration",
	() => {
		const echoNode = defineNode({
			type: "echo",
			name: "Echo",
			category: "action",
			inputSchema: z.object({ value: z.string() }),
			outputSchema: z.object({ value: z.string() }),
			executor: async (input) => ({
				success: true,
				output: { value: input.value },
				nextNode: "sandboxed-step",
			}),
		});

		// This node runs in the normal host process but the workflow
		// config routes it through the sandbox executor
		const httpNode = defineNode({
			type: "http_request",
			name: "HTTP Request",
			category: "integration",
			inputSchema: z.object({ url: z.string().optional() }),
			outputSchema: z.any(),
			executor: async (input) => ({
				success: true,
				output: input,
			}),
		});

		it("runs a DAG with one sandboxed and one unsandboxed node", async () => {
			const registry = createRegistry();
			registry.register(echoNode);
			registry.register(httpNode);
			const ctx = createExecutionContext();

			const result = await runWorkflow(
				{
					"normal-step": {
						nodeType: "echo",
						input: { value: "hello" },
					},
					"sandboxed-step": {
						nodeType: "http_request",
						input: { message: "from sandbox" },
					},
				},
				"normal-step",
				registry,
				ctx,
				{
					nodeConfig: {
						"sandboxed-step": {
							sandbox: {
								allowedHosts: [],
								timeoutMs: 30000,
							},
						},
					},
				},
			);

			expect(result.success).toBe(true);
			expect(result.steps).toHaveLength(2);
			expect(result.steps[0].nodeType).toBe("echo");
			expect(result.steps[1].nodeType).toBe("http_request");
		}, 60000);
	},
);
