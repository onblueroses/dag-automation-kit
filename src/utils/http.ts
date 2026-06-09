/**
 * HTTP utilities for making API calls with retry logic, timeouts, and rate limiting.
 */

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { CacheStore, RateLimitStore } from "../core/stores.js";

export interface FetchWithRetryOptions {
	maxRetries?: number;
	backoffMs?: number;
	timeoutMs?: number;
	rateLimitWindow?: number;
	retryOn?: number[];
	cacheStore?: CacheStore;
	cacheTtlMs?: number;
	rateLimitStore?: RateLimitStore;
	rateLimitKey?: string;
	rateLimitMax?: number;
}

export interface ServiceProfile {
	maxRetries: number;
	backoffMs: number;
	timeoutMs: number;
	rateLimitWindow?: number;
	retryOn?: number[];
}

export const SERVICE_PROFILES: Record<string, ServiceProfile> = {
	firecrawl: { maxRetries: 4, backoffMs: 2000, timeoutMs: 120000 },
	twitter: {
		maxRetries: 3,
		backoffMs: 2000,
		timeoutMs: 15000,
		rateLimitWindow: 900000,
	},
	dataForSeo: { maxRetries: 3, backoffMs: 1500, timeoutMs: 60000 },
	openai: {
		maxRetries: 5,
		backoffMs: 1000,
		timeoutMs: 60000,
		retryOn: [502, 503],
	},
	anthropic: {
		maxRetries: 5,
		backoffMs: 1000,
		timeoutMs: 60000,
		retryOn: [502, 503, 529],
	},
	discordBot: { maxRetries: 3, backoffMs: 1000, timeoutMs: 15000 },
	discordWebhook: { maxRetries: 3, backoffMs: 1000, timeoutMs: 15000 },
	devto: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 },
	wordpress: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 },
	apify: { maxRetries: 4, backoffMs: 2000, timeoutMs: 120000 },
	googleSheets: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 },
	openRouter: {
		maxRetries: 5,
		backoffMs: 1000,
		timeoutMs: 120000,
		retryOn: [502, 503, 529],
	},
	youtube: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 },
	elevenlabs: { maxRetries: 3, backoffMs: 2000, timeoutMs: 60000 },
	unsplash: { maxRetries: 3, backoffMs: 1000, timeoutMs: 15000 },
	tavily: { maxRetries: 3, backoffMs: 1000, timeoutMs: 30000 },
};

export class FetchRetryError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "FetchRetryError";
	}
}

export async function fetchWithRetry(
	url: string,
	options: RequestInit = {},
	config: FetchWithRetryOptions = {},
): Promise<Response> {
	const {
		maxRetries = 3,
		backoffMs = 1000,
		timeoutMs = 30000,
		rateLimitWindow,
		retryOn,
		cacheStore,
		cacheTtlMs,
		rateLimitStore,
		rateLimitKey,
		rateLimitMax,
	} = config;

	// Check cache before fetching (keyed by method + url + auth header)
	const method = (options.method ?? "GET").toUpperCase();
	const authHeader =
		options.headers instanceof Headers
			? (options.headers.get("Authorization") ?? "")
			: ((options.headers as Record<string, string>)?.Authorization ?? "");
	if (cacheStore) {
		const cacheKey = `fetch:${method}:${url}:${authHeader}`;
		const cached = await cacheStore.get(cacheKey);
		if (cached !== undefined) {
			return new Response(JSON.stringify(cached), {
				status: 200,
				headers: { "x-cache": "HIT" },
			});
		}
	}

	// Check pluggable rate limit store
	if (rateLimitStore && rateLimitKey && rateLimitMax && rateLimitWindow) {
		const limited = await rateLimitStore.isLimited(
			rateLimitKey,
			rateLimitMax,
			rateLimitWindow,
		);
		if (limited) {
			throw new FetchRetryError(
				`Rate limited by store for key "${rateLimitKey}"`,
				429,
			);
		}
		await rateLimitStore.increment(rateLimitKey, rateLimitWindow);
	}

	let lastError: Error | null = null;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(url, {
				...options,
				signal: controller.signal,
			});

			clearTimeout(timeout);

			if (response.status === 401 || response.status === 403) {
				const errorText = await response.text();
				throw new FetchRetryError(
					`Authentication error: ${response.status} ${response.statusText}`,
					response.status,
					errorText,
				);
			}

			if (response.status === 429) {
				const retryAfter = response.headers.get("retry-after");
				const delayMs = retryAfter
					? parseInt(retryAfter, 10) * 1000
					: rateLimitWindow
						? rateLimitWindow
						: backoffMs * 2 ** attempt;

				if (attempt < maxRetries - 1) {
					await sleep(delayMs);
					continue;
				}

				const errorText = await response.text();
				throw new FetchRetryError(
					`Rate limit exceeded after ${maxRetries} attempts`,
					429,
					errorText,
				);
			}

			if (retryOn?.includes(response.status)) {
				if (attempt < maxRetries - 1) {
					await sleep(backoffMs * 2 ** attempt);
					continue;
				}
				const errorText = await response.text();
				throw new FetchRetryError(
					`Retryable error: ${response.status} ${response.statusText}`,
					response.status,
					errorText,
				);
			}

			if (response.status >= 500 && response.status < 600) {
				if (attempt < maxRetries - 1) {
					await sleep(backoffMs * 2 ** attempt);
					continue;
				}
				const errorText = await response.text();
				throw new FetchRetryError(
					`Server error: ${response.status} ${response.statusText}`,
					response.status,
					errorText,
				);
			}

			// Store in cache on success if configured
			if (cacheStore && cacheTtlMs) {
				const clone = response.clone();
				try {
					const body = await clone.json();
					await cacheStore.set(
						`fetch:${method}:${url}:${authHeader}`,
						body,
						cacheTtlMs,
					);
				} catch {
					// Non-JSON responses are not cached
				}
			}

			return response;
		} catch (error) {
			clearTimeout(timeout);

			if (error instanceof Error && error.name === "AbortError") {
				lastError = new FetchRetryError("Request timed out");
				if (attempt < maxRetries - 1) {
					await sleep(backoffMs * 2 ** attempt);
					continue;
				}
				throw lastError;
			}

			if (error instanceof FetchRetryError) {
				throw error;
			}

			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxRetries - 1) {
				await sleep(backoffMs * 2 ** attempt);
			}
		}
	}

	throw lastError || new FetchRetryError("Max retries exceeded");
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new FetchRetryError(
			`HTTP error: ${response.status} ${response.statusText}`,
			response.status,
			errorText,
		);
	}

	return response.json() as Promise<T>;
}
