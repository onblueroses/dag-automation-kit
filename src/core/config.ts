/** Configuration for sandboxed node execution in a Gondolin micro-VM. */
export interface SandboxConfig {
	/** Hosts the sandboxed node is allowed to reach via HTTP(S). */
	allowedHosts: string[];
	/** Per-service host scoping for credentials. Maps service name to allowed hosts for that service's secrets. */
	secretHosts?: Record<string, string[]>;
	/** VM timeout in ms (default: 60000). */
	timeoutMs?: number;
	/** Additional env vars for the guest. */
	env?: Record<string, string>;
	/** Host paths to mount read-only into the VM. */
	mounts?: Array<{ host: string; guest: string }>;
}

/** Per-node execution configuration, resolved at workflow runtime. */
export interface NodeExecutionConfig {
	retryCount: number;
	timeoutMs: number;
	cacheTtlMs?: number;
	cacheKey?: string;
	/** When set, node execution runs inside a Gondolin micro-VM with credential placeholder swap. */
	sandbox?: SandboxConfig;
}

const DEFAULTS: NodeExecutionConfig = {
	retryCount: 0,
	timeoutMs: 30000,
};

/**
 * Resolve execution config for a node. Priority: stepId override > nodeType override > defaults.
 */
export function resolveNodeConfig(
	nodeType: string,
	stepId: string,
	nodeConfig?: Record<string, Partial<NodeExecutionConfig>>,
): NodeExecutionConfig {
	if (!nodeConfig) return { ...DEFAULTS };

	const typeOverride = nodeConfig[nodeType] ?? {};
	const stepOverride = nodeConfig[stepId] ?? {};

	return { ...DEFAULTS, ...typeOverride, ...stepOverride };
}
