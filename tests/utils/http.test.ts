import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchRetryError, fetchWithRetry } from "../../src/utils/http.js";

describe("fetchWithRetry", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns response on success", async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue(new Response("ok", { status: 200 }));
		const res = await fetchWithRetry(
			"https://example.com",
			{},
			{ maxRetries: 1 },
		);
		expect(res.status).toBe(200);
	});

	it("throws FetchRetryError on 401", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response("unauthorized", {
				status: 401,
				statusText: "Unauthorized",
			}),
		);
		await expect(
			fetchWithRetry("https://example.com", {}, { maxRetries: 1 }),
		).rejects.toThrow(FetchRetryError);
	});

	it("retries on 500 and eventually throws", async () => {
		const mockFetch = vi.fn().mockResolvedValue(
			new Response("server error", {
				status: 500,
				statusText: "Internal Server Error",
			}),
		);
		globalThis.fetch = mockFetch;

		await expect(
			fetchWithRetry(
				"https://example.com",
				{},
				{ maxRetries: 2, backoffMs: 1 },
			),
		).rejects.toThrow(FetchRetryError);

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns 4xx responses without retry", async () => {
		const mockFetch = vi
			.fn()
			.mockResolvedValue(new Response("not found", { status: 404 }));
		globalThis.fetch = mockFetch;

		const res = await fetchWithRetry(
			"https://example.com",
			{},
			{ maxRetries: 3 },
		);
		expect(res.status).toBe(404);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
