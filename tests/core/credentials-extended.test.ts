import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resolveCredentials } from "../../src/core/credentials.js";
import { defineNode } from "../../src/core/node.js";

describe("extended credential types", () => {
	it("resolves openRouter credentials", () => {
		const node = defineNode({
			type: "or-test",
			name: "OR Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { openRouter: { type: "header", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			openRouter: { apiKey: "sk-or-test" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.headers?.apiKey).toBe("sk-or-test");
		}
	});

	it("resolves openRouterDraft as separate credential slot", () => {
		const node = defineNode({
			type: "or-draft-test",
			name: "OR Draft Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: {
				openRouter: { type: "header", required: true },
				openRouterDraft: { type: "header", required: true },
			},
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			openRouter: { apiKey: "key-1" },
			openRouterDraft: { apiKey: "key-2" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.headers?.apiKey).toBe("key-2");
		}
	});

	it("resolves youtube credentials", () => {
		const node = defineNode({
			type: "yt-test",
			name: "YT Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { youtube: { type: "query", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			youtube: { apiKey: "yt-key" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.queryParams?.apiKey).toBe("yt-key");
		}
	});

	it("resolves elevenlabs credentials", () => {
		const node = defineNode({
			type: "el-test",
			name: "EL Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { elevenlabs: { type: "header", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			elevenlabs: { apiKey: "el-key" },
		});
		expect(result.ok).toBe(true);
	});

	it("resolves tavily credentials", () => {
		const node = defineNode({
			type: "tv-test",
			name: "TV Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { tavily: { type: "header", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			tavily: { apiKey: "tv-key" },
		});
		expect(result.ok).toBe(true);
	});

	it("resolves unsplash credentials", () => {
		const node = defineNode({
			type: "un-test",
			name: "UN Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { unsplash: { type: "header", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			unsplash: { accessKey: "un-key" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.headers?.accessKey).toBe("un-key");
		}
	});

	it("resolves ssh credentials", () => {
		const node = defineNode({
			type: "ssh-test",
			name: "SSH Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: { ssh: { type: "body", required: true } },
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node, {
			ssh: {
				privateKey: "/path/to/key",
				host: "example.com",
				user: "deploy",
				port: 22,
			},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.credentials.body?.host).toBe("example.com");
			expect(result.credentials.body?.user).toBe("deploy");
			expect(result.credentials.body?.port).toBe("22");
		}
	});

	it("fails on missing required new credential types", () => {
		const node = defineNode({
			type: "missing-test",
			name: "Missing Test",
			category: "integration",
			inputSchema: z.object({}),
			outputSchema: z.object({}),
			credentials: {
				openRouter: { type: "header", required: true },
				youtube: { type: "query", required: true },
			},
			executor: async () => ({ success: true, output: {} }),
		});
		const result = resolveCredentials(node);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain("openRouter");
			expect(result.error).toContain("youtube");
		}
	});
});
