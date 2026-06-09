import { describe, expect, it } from "vitest";
import { createExecutionContext } from "../../src/core/context.js";

/**
 * Integration tests for sandbox network policy enforcement.
 * Run with: GONDOLIN_INTEGRATION=1 npx vitest run tests/integration/sandbox-network.test.ts
 */
describe.skipIf(!process.env.GONDOLIN_INTEGRATION)(
	"sandbox network policy",
	() => {
		it("allows requests to allowlisted hosts", async () => {
			const { executeSandboxed } = await import(
				"../../src/core/sandbox-executor.js"
			);
			const context = createExecutionContext();

			const result = await executeSandboxed(
				"http_request",
				{ url: "https://api.github.com/zen" },
				context,
				{
					allowedHosts: ["api.github.com"],
					timeoutMs: 30000,
				},
			);

			expect(result.success).toBe(true);
			const output = result.output as Record<string, unknown>;
			// GitHub /zen returns a short string
			expect(output.response).toBeTruthy();
		}, 60000);

		it("blocks requests to non-allowlisted hosts", async () => {
			const { executeSandboxed } = await import(
				"../../src/core/sandbox-executor.js"
			);
			const context = createExecutionContext();

			const result = await executeSandboxed(
				"http_request",
				{ url: "https://example.com" },
				context,
				{
					allowedHosts: ["api.github.com"], // example.com not listed
					timeoutMs: 30000,
				},
			);

			// curl should fail - the request gets blocked by the MITM proxy
			if (result.success) {
				const output = result.output as Record<string, unknown>;
				const stderr = String(output.stderr ?? "");
				expect(stderr.length).toBeGreaterThan(0);
			} else {
				// Non-zero exit code from curl is also acceptable
				expect(result.error).toBeTruthy();
			}
		}, 60000);
	},
);
