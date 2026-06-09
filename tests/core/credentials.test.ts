import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExecutionContext } from "../../src/core/context.js";
import { resolveCredentials } from "../../src/core/credentials.js";
import { defineNode } from "../../src/core/node.js";
import { createRegistry } from "../../src/core/registry.js";

const echoNode = defineNode({
	type: "needs-auth",
	name: "Needs Auth",
	category: "integration",
	inputSchema: z.object({}),
	outputSchema: z.object({}),
	credentials: {
		myService: { type: "header", required: true, description: "API key" },
	},
	executor: async () => ({ success: true, output: {} }),
});

const optionalCredsNode = defineNode({
	type: "optional-auth",
	name: "Optional Auth",
	category: "integration",
	inputSchema: z.object({}),
	outputSchema: z.object({}),
	credentials: {
		myService: { type: "header", required: false },
	},
	executor: async () => ({ success: true, output: {} }),
});

describe("resolveCredentials", () => {
	it("returns error for missing required credentials", () => {
		const result = resolveCredentials(echoNode);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("myService");
		}
	});

	it("succeeds when required credentials are provided", () => {
		const result = resolveCredentials(echoNode, {
			myService: { apiKey: "test-key" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.headers).toEqual({ apiKey: "test-key" });
		}
	});

	it("succeeds when optional credentials are absent", () => {
		const result = resolveCredentials(optionalCredsNode);
		expect(result.ok).toBe(true);
	});

	it("maps query type credentials", () => {
		const node = defineNode({
			type: "query-auth",
			name: "Query Auth",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { svc: { type: "query" } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, { svc: { token: "abc" } });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.queryParams).toEqual({ token: "abc" });
		}
	});

	it("maps basic type credentials", () => {
		const node = defineNode({
			type: "basic-auth",
			name: "Basic Auth",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { svc: { type: "basic" } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			svc: { username: "user", password: "pass" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const expected = Buffer.from("user:pass").toString("base64");
			expect(result.credentials.headers?.Authorization).toBe(
				`Basic ${expected}`,
			);
		}
	});

	it("nodes without credentials field pass through", () => {
		const plainNode = defineNode({
			type: "plain",
			name: "Plain",
			category: "action",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(plainNode);
		expect(result.ok).toBe(true);
	});
});

describe("credential validation in registry", () => {
	it("throws when executing a node with missing required credentials", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext();

		await expect(registry.execute("needs-auth", {}, ctx)).rejects.toThrow(
			"Missing required credentials",
		);
	});

	it("succeeds when credentials are provided", async () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const ctx = createExecutionContext(
			{},
			{},
			{ myService: { apiKey: "key" } },
		);

		const result = await registry.execute("needs-auth", {}, ctx);
		expect(result.success).toBe(true);
	});

	it("includes credentials in metadata", () => {
		const registry = createRegistry();
		registry.register(echoNode);
		const meta = registry.getMetadata("needs-auth");
		expect(meta?.credentials).toEqual({
			myService: { type: "header", required: true, description: "API key" },
		});
	});
});
