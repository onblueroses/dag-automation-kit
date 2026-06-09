import { describe, expect, it } from "vitest";
import { resolveNodeConfig } from "../../src/core/config.js";
import { buildSandboxSecrets } from "../../src/core/sandbox-credentials.js";
import type { NodeCredentials } from "../../src/core/types.js";

describe("buildSandboxSecrets", () => {
	it("maps string credential fields to secrets", () => {
		const credentials: NodeCredentials = {
			openRouter: { apiKey: "sk-real-key-123" },
		};
		const result = buildSandboxSecrets(credentials, ["openrouter.ai"]);

		expect(result.secrets).toHaveProperty("OPENROUTER_API_KEY");
		expect(result.secrets.OPENROUTER_API_KEY).toEqual({
			hosts: ["openrouter.ai"],
			value: "sk-real-key-123",
		});
	});

	it("maps multiple services", () => {
		const credentials: NodeCredentials = {
			anthropic: { apiKey: "sk-ant-key" },
			openai: { apiKey: "sk-openai-key" },
		};
		const hosts = ["api.anthropic.com", "api.openai.com"];
		const result = buildSandboxSecrets(credentials, hosts);

		expect(Object.keys(result.secrets)).toHaveLength(2);
		expect(result.secrets.ANTHROPIC_API_KEY.value).toBe("sk-ant-key");
		expect(result.secrets.OPENAI_API_KEY.value).toBe("sk-openai-key");
	});

	it("skips non-string fields", () => {
		const credentials: NodeCredentials = {
			googleSheets: {
				clientId: "id-123",
				clientSecret: "secret-456",
				accessToken: "tok-789",
				refreshToken: "ref-012",
				expiresAt: 1234567890,
			},
		};
		const result = buildSandboxSecrets(credentials, ["sheets.googleapis.com"]);

		// expiresAt is a number, should be skipped
		expect(Object.keys(result.secrets)).toHaveLength(4);
		expect(result.secrets).not.toHaveProperty("GOOGLESHEETS_EXPIRES_AT");
	});

	it("skips empty string values", () => {
		const credentials: NodeCredentials = {
			anthropic: { apiKey: "" },
		};
		const result = buildSandboxSecrets(credentials, ["api.anthropic.com"]);

		expect(Object.keys(result.secrets)).toHaveLength(0);
	});

	it("returns empty when no credentials", () => {
		const result = buildSandboxSecrets(undefined, ["example.com"]);
		expect(Object.keys(result.secrets)).toHaveLength(0);
	});

	it("returns empty when no allowed hosts", () => {
		const credentials: NodeCredentials = {
			anthropic: { apiKey: "sk-key" },
		};
		const result = buildSandboxSecrets(credentials, []);
		expect(Object.keys(result.secrets)).toHaveLength(0);
	});

	it("scopes secrets per-service when secretHosts provided", () => {
		const credentials: NodeCredentials = {
			anthropic: { apiKey: "sk-ant" },
			openai: { apiKey: "sk-oai" },
		};
		const result = buildSandboxSecrets(
			credentials,
			["api.anthropic.com", "api.openai.com"],
			{
				anthropic: ["api.anthropic.com"],
				openai: ["api.openai.com"],
			},
		);

		expect(result.secrets.ANTHROPIC_API_KEY.hosts).toEqual([
			"api.anthropic.com",
		]);
		expect(result.secrets.OPENAI_API_KEY.hosts).toEqual(["api.openai.com"]);
	});

	it("falls back to all allowedHosts when secretHosts not specified for a service", () => {
		const credentials: NodeCredentials = {
			anthropic: { apiKey: "sk-ant" },
			openai: { apiKey: "sk-oai" },
		};
		const hosts = ["api.anthropic.com", "api.openai.com"];
		const result = buildSandboxSecrets(credentials, hosts, {
			anthropic: ["api.anthropic.com"],
			// openai not specified - falls back to all hosts
		});

		expect(result.secrets.ANTHROPIC_API_KEY.hosts).toEqual([
			"api.anthropic.com",
		]);
		expect(result.secrets.OPENAI_API_KEY.hosts).toEqual(hosts);
	});

	it("converts camelCase field names to UPPER_SNAKE_CASE", () => {
		const credentials: NodeCredentials = {
			twitter: { bearerToken: "tok-123", accessTokenSecret: "sec-456" },
		};
		const result = buildSandboxSecrets(credentials, ["api.twitter.com"]);

		expect(result.secrets).toHaveProperty("TWITTER_BEARER_TOKEN");
		expect(result.secrets).toHaveProperty("TWITTER_ACCESS_TOKEN_SECRET");
	});
});

describe("SandboxConfig in resolveNodeConfig", () => {
	it("passes sandbox config through from nodeType override", () => {
		const config = resolveNodeConfig("http_request", "step1", {
			http_request: {
				sandbox: {
					allowedHosts: ["api.github.com"],
					timeoutMs: 30000,
				},
			},
		});
		expect(config.sandbox).toBeDefined();
		expect(config.sandbox?.allowedHosts).toEqual(["api.github.com"]);
	});

	it("stepId sandbox override beats nodeType", () => {
		const config = resolveNodeConfig("http_request", "step1", {
			http_request: {
				sandbox: { allowedHosts: ["api.github.com"] },
			},
			step1: {
				sandbox: { allowedHosts: ["api.openai.com"] },
			},
		});
		expect(config.sandbox?.allowedHosts).toEqual(["api.openai.com"]);
	});

	it("no sandbox by default", () => {
		const config = resolveNodeConfig("http_request", "step1");
		expect(config.sandbox).toBeUndefined();
	});
});

// Integration test - requires gondolin installed and QEMU available.
// Skipped by default in CI. Run with: npx vitest run --testNamePattern "integration"
describe.skipIf(!process.env.GONDOLIN_INTEGRATION)(
	"sandbox-executor integration",
	() => {
		it("executes a command in a sandbox VM", async () => {
			const { executeSandboxed } = await import(
				"../../src/core/sandbox-executor.js"
			);
			const { createExecutionContext } = await import(
				"../../src/core/context.js"
			);

			const context = createExecutionContext();
			const result = await executeSandboxed(
				"test-node",
				{ message: "hello from sandbox" },
				context,
				{
					allowedHosts: [],
					timeoutMs: 30000,
				},
			);

			expect(result.success).toBe(true);
			// Without a URL in input, the script echoes input back as output
			expect(result.output).toEqual({ message: "hello from sandbox" });
		}, 60000);

		it("blocks non-allowlisted hosts", async () => {
			const { executeSandboxed } = await import(
				"../../src/core/sandbox-executor.js"
			);
			const { createExecutionContext } = await import(
				"../../src/core/context.js"
			);

			const context = createExecutionContext();
			const result = await executeSandboxed(
				"http_request",
				{ url: "https://example.com/test" },
				context,
				{
					allowedHosts: [], // nothing allowed
					timeoutMs: 30000,
				},
			);

			// curl should fail since example.com is not allowlisted
			if (result.success && result.output) {
				const output = result.output as Record<string, unknown>;
				expect(output.stderr).toBeTruthy();
			} else {
				expect(result.success).toBe(false);
			}
		}, 60000);
	},
);
