import type { NodeCredentials } from "./types.js";

/**
 * A secret definition compatible with Gondolin's createHttpHooks.
 * Secrets are injected at the MITM proxy layer - the VM guest never sees real values.
 */
export interface SandboxSecret {
	hosts: string[];
	value: string;
}

export interface SandboxSecretsResult {
	/** Secret definitions keyed by env var name, for Gondolin's createHttpHooks. */
	secrets: Record<string, SandboxSecret>;
	/** Env var name -> placeholder value mapping for the guest. */
	env: Record<string, string>;
}

/**
 * Convert NodeCredentials into Gondolin SecretDefinition format.
 *
 * Each credential field becomes a secret scoped to its service's allowed hosts.
 * When `secretHosts` is provided, each service's secrets are scoped to only that
 * service's hosts. Otherwise, all secrets are scoped to all allowed hosts.
 *
 * The guest sees placeholder env vars (e.g., GONDOLIN_SECRET_...) while
 * the real values are substituted at the MITM proxy boundary.
 *
 * Only string-valued credential fields are mapped. Non-string fields
 * (numbers, objects) are skipped since they can't be HTTP credentials.
 */
export function buildSandboxSecrets(
	credentials: NodeCredentials | undefined,
	allowedHosts: string[],
	secretHosts?: Record<string, string[]>,
): SandboxSecretsResult {
	const secrets: Record<string, SandboxSecret> = {};
	const env: Record<string, string> = {};

	if (!credentials || allowedHosts.length === 0) {
		return { secrets, env };
	}

	for (const [service, fields] of Object.entries(credentials)) {
		if (!fields || typeof fields !== "object") continue;

		// Per-service host scoping: use secretHosts[service] if available, else all allowedHosts
		const serviceHosts = secretHosts?.[service] ?? allowedHosts;
		if (serviceHosts.length === 0) continue;

		for (const [field, value] of Object.entries(fields)) {
			if (typeof value !== "string" || value === "") continue;

			// Build a stable env var name from service + field
			const envName = `${service.toUpperCase()}_${field
				.replace(/([A-Z])/g, "_$1")
				.toUpperCase()
				.replace(/^_/, "")}`;

			secrets[envName] = {
				hosts: serviceHosts,
				value,
			};
		}
	}

	return { secrets, env };
}
