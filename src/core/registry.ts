import { resolveCredentials } from "./credentials.js";
import type {
	ExecutionContext,
	NodeCategory,
	NodeDefinition,
	NodeMetadata,
	NodeResult,
} from "./types.js";

export class NodeRegistry {
	private defs = new Map<string, NodeDefinition>();

	register<I = unknown, O = unknown>(def: NodeDefinition<I, O>): void {
		if (this.defs.has(def.type)) {
			throw new Error(`Node type "${def.type}" is already registered`);
		}
		this.defs.set(def.type, def as NodeDefinition);
	}

	registerAll(defs: readonly NodeDefinition<unknown, unknown>[]): void {
		for (const def of defs) {
			this.register(def);
		}
	}

	has(type: string): boolean {
		return this.defs.has(type);
	}

	unregister(type: string): boolean {
		return this.defs.delete(type);
	}

	async execute(
		type: string,
		rawInput: unknown,
		context: ExecutionContext,
	): Promise<NodeResult> {
		const def = this.defs.get(type);
		if (!def) {
			throw new Error(`Node type "${type}" is not registered`);
		}

		// Validate declarative credentials if defined
		if (def.credentials) {
			const credResult = resolveCredentials(def, context.credentials);
			if (!credResult.ok) {
				throw new Error(credResult.error);
			}
		}

		// Validate input - ZodError here = programmer error, let it throw
		const validatedInput = def.inputSchema.parse(rawInput);

		const result = await def.executor(validatedInput, context);

		// Validate output only when present and successful
		if (result.success && result.output !== undefined) {
			def.outputSchema.parse(result.output);
		}

		return result;
	}

	getMetadata(type: string): NodeMetadata | undefined {
		const def = this.defs.get(type);
		if (!def) return undefined;

		// Strip executor and schemas - safe for frontend
		const {
			executor: _executor,
			inputSchema: _in,
			outputSchema: _out,
			...metadata
		} = def;
		return metadata;
	}

	getByCategory(category: NodeCategory): NodeDefinition[] {
		return Array.from(this.defs.values()).filter(
			(d) => d.category === category,
		);
	}

	getTypes(): string[] {
		return Array.from(this.defs.keys());
	}
}

export function createRegistry(): NodeRegistry {
	return new NodeRegistry();
}
