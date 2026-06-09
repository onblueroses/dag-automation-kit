import { z } from "zod";
import { defineNode } from "../../core/node.js";

export const parallelNode = defineNode({
	type: "parallel",
	name: "Parallel",
	description:
		"Execute multiple branches concurrently, then continue to nextNode",
	category: "logic",
	inputSchema: z.object({
		branches: z.array(z.string()).min(1),
		nextNode: z.string().optional(),
	}),
	outputSchema: z.object({
		branches: z.array(z.string()),
	}),
	executor: async (input) => ({
		success: true,
		output: { branches: input.branches },
		parallel: input.branches,
		nextNode: input.nextNode,
	}),
});
