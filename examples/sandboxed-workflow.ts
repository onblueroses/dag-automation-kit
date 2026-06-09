/**
 * Example: sandboxed workflow with credential placeholder swap.
 *
 * The http_request node runs inside a Gondolin micro-VM. The API key
 * never enters the VM - the MITM proxy injects it at the network boundary.
 *
 * Usage: OPENROUTER_API_KEY=sk-... npx tsx examples/sandboxed-workflow.ts
 */

import { z } from "zod";
import { createExecutionContext } from "../src/core/context.js";
import { defineNode } from "../src/core/node.js";
import { createRegistry } from "../src/core/registry.js";
import { runWorkflow } from "../src/core/workflow.js";

const preparePrompt = defineNode({
	type: "prepare_prompt",
	name: "Prepare Prompt",
	category: "transform",
	inputSchema: z.object({ topic: z.string() }),
	outputSchema: z.object({
		url: z.string(),
		method: z.string(),
		body: z.string(),
	}),
	executor: async (input) => ({
		success: true,
		output: {
			url: "https://openrouter.ai/api/v1/chat/completions",
			method: "POST",
			body: JSON.stringify({
				model: "google/gemini-2.5-flash-preview",
				messages: [
					{ role: "user", content: `Explain ${input.topic} in one sentence.` },
				],
			}),
		},
		nextNode: "sandboxed-fetch",
	}),
});

const logResult = defineNode({
	type: "log_result",
	name: "Log Result",
	category: "action",
	inputSchema: z.any(),
	outputSchema: z.object({ logged: z.boolean() }),
	executor: async (input) => {
		console.log("Result from sandbox:", JSON.stringify(input, null, 2));
		return { success: true, output: { logged: true } };
	},
});

async function main() {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		console.error("Set OPENROUTER_API_KEY to run this example");
		process.exit(1);
	}

	const registry = createRegistry();
	registry.register(preparePrompt);
	registry.register(logResult);

	// http_request doesn't need a real node definition - the sandbox executor
	// handles it via the guest script. Register a placeholder.
	registry.register(
		defineNode({
			type: "http_request",
			name: "HTTP Request (sandboxed)",
			category: "integration",
			inputSchema: z.any(),
			outputSchema: z.any(),
			executor: async () => ({ success: true, output: {} }),
		}),
	);

	const context = createExecutionContext();
	context.credentials = {
		openRouter: { apiKey },
	};

	const result = await runWorkflow(
		{
			prepare: {
				nodeType: "prepare_prompt",
				input: { topic: "quantum computing" },
			},
			"sandboxed-fetch": { nodeType: "http_request", input: "{{prepare}}" },
			log: { nodeType: "log_result", input: "{{sandboxed-fetch}}" },
		},
		"prepare",
		registry,
		context,
		{
			nodeConfig: {
				"sandboxed-fetch": {
					sandbox: {
						allowedHosts: ["openrouter.ai"],
						timeoutMs: 30000,
					},
				},
			},
			onStep: (event) => {
				const sandbox =
					event.stepId === "sandboxed-fetch" ? " [SANDBOXED]" : "";
				console.log(
					`Step: ${event.stepId} (${event.nodeType})${sandbox} - ${event.durationMs}ms`,
				);
			},
		},
	);

	console.log(`\nWorkflow ${result.success ? "succeeded" : "failed"}`);
	if (!result.success) console.error(result.error);
}

main().catch(console.error);
