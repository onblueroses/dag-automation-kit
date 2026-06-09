import type {
	CredentialField,
	NodeCredentials,
	NodeDefinition,
} from "./types.js";

export interface ResolvedCredentials {
	headers?: Record<string, string>;
	queryParams?: Record<string, string>;
	body?: Record<string, string>;
}

export type CredentialResult =
	| { ok: true; credentials: ResolvedCredentials }
	| { ok: false; error: string };

/**
 * Validate and resolve declarative credential definitions against runtime credentials.
 * Returns structured auth data or an error if required credentials are missing.
 */
export function resolveCredentials(
	def: NodeDefinition,
	credentials?: NodeCredentials,
): CredentialResult {
	if (!def.credentials) return { ok: true, credentials: {} };

	const result: ResolvedCredentials = {};
	const missing: string[] = [];

	for (const [service, field] of Object.entries(def.credentials) as [
		string,
		CredentialField,
	][]) {
		const serviceCreds = credentials?.[service];

		if (!serviceCreds || Object.keys(serviceCreds).length === 0) {
			if (field.required !== false) {
				missing.push(service);
			}
			continue;
		}

		// Map credential values to the appropriate transport
		const values = serviceCreds as Record<string, unknown>;
		const stringValues: Record<string, string> = {};
		for (const [k, v] of Object.entries(values)) {
			if (v !== undefined && v !== null) {
				stringValues[k] = String(v);
			}
		}

		switch (field.type) {
			case "header":
				result.headers = { ...result.headers, ...stringValues };
				break;
			case "query":
				result.queryParams = { ...result.queryParams, ...stringValues };
				break;
			case "body":
				result.body = { ...result.body, ...stringValues };
				break;
			case "basic": {
				const user = stringValues.username ?? stringValues.user ?? "";
				const pass = stringValues.password ?? stringValues.apiKey ?? "";
				const encoded = Buffer.from(`${user}:${pass}`).toString("base64");
				result.headers = {
					...result.headers,
					Authorization: `Basic ${encoded}`,
				};
				break;
			}
		}
	}

	if (missing.length > 0) {
		return {
			ok: false,
			error: `Missing required credentials: ${missing.join(", ")}`,
		};
	}

	return { ok: true, credentials: result };
}
