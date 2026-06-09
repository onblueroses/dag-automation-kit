import type {
	ExecutionContext as IExecutionContext,
	NodeCredentials,
	NodeServices,
} from "./types.js";

export class ExecutionContext implements IExecutionContext {
	readonly services: NodeServices;
	readonly credentials?: NodeCredentials;
	private vars: Record<string, unknown>;

	constructor(
		services: NodeServices = {},
		initialVars: Record<string, unknown> = {},
		credentials?: NodeCredentials,
	) {
		this.services = services;
		this.credentials = credentials;
		this.vars = { ...initialVars };
	}

	/**
	 * Called by workflow after each node completes.
	 * Stores output under the node type key AND merges flat keys into root vars.
	 *
	 * Note: flat-merge means if two nodes output the same key name (e.g. both
	 * produce `{ count: N }`), the later node silently overwrites the earlier
	 * value at root level. Use namespaced paths (`stepId.count`) for safe access.
	 */
	setNodeOutput(nodeType: string, output: unknown): void {
		this.vars[nodeType] = output;
		// Merge flat keys from output object into root for convenience
		if (
			output !== null &&
			typeof output === "object" &&
			!Array.isArray(output)
		) {
			for (const [k, v] of Object.entries(output as Record<string, unknown>)) {
				this.vars[k] = v;
			}
		}
	}

	/**
	 * Get a value by dot-notation path with optional array index access.
	 * "analyze.highPriorityPosts" -> vars["analyze"]["highPriorityPosts"]
	 * "items[0].name" -> vars["items"][0]["name"]
	 * "count" -> vars["count"]
	 */
	get(path: string): unknown {
		const parts = path.split(".");
		let current: unknown = this.vars;
		for (const part of parts) {
			if (current === null || current === undefined) return undefined;
			if (typeof current !== "object") return undefined;
			// Handle array index: items[0], results[2], etc.
			const bracketMatch = /^([^[]+)\[(\d+)\]$/.exec(part);
			if (bracketMatch) {
				const [, key, indexStr] = bracketMatch;
				current = (current as Record<string, unknown>)[key];
				if (!Array.isArray(current)) return undefined;
				current = current[Number(indexStr)];
			} else {
				current = (current as Record<string, unknown>)[part];
			}
		}
		return current;
	}

	// Alias for get() - jam-nodes nodes use this name
	resolveNestedPath(path: string): unknown {
		return this.get(path);
	}

	set(key: string, value: unknown): void {
		this.vars[key] = value;
	}

	/**
	 * Replace {{path}} references in a string with values from context.
	 * If the entire template is a single {{ref}}, returns the raw value (array, object, etc.).
	 * Multi-variable templates return a formatted string.
	 * Unknown paths are left as-is.
	 */
	interpolate(template: string): unknown {
		// Single-variable reference: return the actual value, not stringified
		const singleRef = /^\{\{([^}]+)\}\}$/.exec(template);
		if (singleRef) {
			const value = this.get(singleRef[1].trim());
			return value !== undefined ? value : template;
		}
		// Multi-variable: string interpolation with smart formatting
		return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
			const value = this.get(path.trim());
			if (value === undefined || value === null) return _match;
			return formatValue(value);
		});
	}

	/**
	 * Recursively interpolate {{path}} references in an object's string values.
	 *
	 * NOTE: This is a runtime transform, not a type-safe operation. String values
	 * like '{{ref}}' may become arrays, objects, or numbers after interpolation
	 * (via single-var resolution). The returned type `T` matches the input shape
	 * at compile time, but runtime types may differ. Zod schema validation in
	 * registry.execute() catches mismatches at the boundary.
	 */
	interpolateObject<T extends Record<string, unknown>>(obj: T): T {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = this.interpolateValue(value);
		}
		return result as T;
	}

	private interpolateValue(value: unknown): unknown {
		if (typeof value === "string") {
			return this.interpolate(value);
		}
		if (Array.isArray(value)) {
			return value.map((item) => this.interpolateValue(item));
		}
		if (value !== null && typeof value === "object") {
			return this.interpolateObject(value as Record<string, unknown>);
		}
		return value;
	}

	/**
	 * Returns a shallow copy of the current context variables.
	 * Nested objects/arrays are shared references - mutations to them will
	 * affect the original context. Use structuredClone() on the result if
	 * you need a fully independent copy.
	 */
	snapshot(): Record<string, unknown> {
		return { ...this.vars };
	}

	/**
	 * Reconstruct an ExecutionContext from a snapshot (e.g., persisted workflow state).
	 */
	static fromJSON(
		data: Record<string, unknown>,
		services?: NodeServices,
		credentials?: NodeCredentials,
	): ExecutionContext {
		return new ExecutionContext(services ?? {}, data, credentials);
	}
}

export function createExecutionContext(
	services?: NodeServices,
	initialVars?: Record<string, unknown>,
	credentials?: NodeCredentials,
): ExecutionContext {
	return new ExecutionContext(services, initialVars, credentials);
}

/**
 * Smart formatting for multi-variable string interpolation.
 * Arrays become comma-joined, objects become JSON, primitives use String().
 */
function formatValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.join(", ");
	if (typeof value === "object" && value !== null) return JSON.stringify(value);
	return String(value);
}
