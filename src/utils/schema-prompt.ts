import { type ZodObject, type ZodRawShape, type ZodType, z } from "zod";

const _schemaYamlCache = new Map<ZodType, string>();

/**
 * Convert a described Zod schema to a prompt-friendly YAML string.
 * Walks the Zod schema tree directly (no zod-to-json-schema dependency).
 * Extracts type, description, and structure. Results are cached.
 */
export function schemaToPromptYaml(schema: ZodType): string {
	const cached = _schemaYamlCache.get(schema);
	if (cached) return cached;

	const extracted = extractSchema(schema);
	const yaml = toYaml(extracted, 0);

	_schemaYamlCache.set(schema, yaml);
	return yaml;
}

/**
 * Produce a prompt-ready description of a node's input/output contract.
 */
export function makeNodePromptContext(opts: {
	name: string;
	description?: string;
	inputSchema: ZodType;
	outputSchema: ZodType;
}): string {
	const lines: string[] = [];
	lines.push(`## ${opts.name}`);
	if (opts.description) lines.push(opts.description);
	lines.push("");
	lines.push("### Input");
	lines.push("```yaml");
	lines.push(schemaToPromptYaml(opts.inputSchema));
	lines.push("```");
	lines.push("");
	lines.push("### Output");
	lines.push("```yaml");
	lines.push(schemaToPromptYaml(opts.outputSchema));
	lines.push("```");
	return lines.join("\n");
}

/**
 * Create a perspective-scoped schema by narrowing an enum field to specific values.
 */
export function makeConstrainedSchema<T extends ZodRawShape>(
	base: ZodObject<T>,
	field: string & keyof T,
	allowedValues: [string, ...string[]],
) {
	return base.extend({
		[field]: z
			.enum(allowedValues)
			.describe(`Constrained to: ${allowedValues.join(", ")}`),
	});
}

// --- Schema extraction (walks Zod v3 ._def tree) ---

interface SchemaNode {
	type: string;
	description?: string;
	properties?: Record<string, SchemaNode>;
	items?: SchemaNode;
	values?: string[];
	required?: string[];
}

function extractSchema(schema: ZodType): SchemaNode {
	const def = (schema as unknown as { _def: Record<string, unknown> })._def;
	const description = def.description as string | undefined;
	const typeName = def.typeName as string;

	switch (typeName) {
		case "ZodObject": {
			const shape = (def.shape as () => Record<string, ZodType>)();
			const properties: Record<string, SchemaNode> = {};
			const required: string[] = [];
			for (const [key, value] of Object.entries(shape)) {
				properties[key] = extractSchema(value);
				const innerDef = (value as unknown as { _def: Record<string, unknown> })
					._def;
				if (innerDef.typeName !== "ZodOptional") {
					required.push(key);
				}
			}
			return { type: "object", description, properties, required };
		}
		case "ZodArray": {
			const innerType = def.type as ZodType;
			return { type: "array", description, items: extractSchema(innerType) };
		}
		case "ZodEnum": {
			const values = def.values as string[];
			return { type: "enum", description, values };
		}
		case "ZodOptional": {
			const inner = extractSchema(def.innerType as ZodType);
			inner.description = description || inner.description;
			return { ...inner, type: `${inner.type} (optional)` };
		}
		case "ZodNullable": {
			const inner = extractSchema(def.innerType as ZodType);
			inner.description = description || inner.description;
			return { ...inner, type: `${inner.type} | null` };
		}
		case "ZodString":
			return { type: "string", description };
		case "ZodNumber":
			return { type: "number", description };
		case "ZodBoolean":
			return { type: "boolean", description };
		case "ZodLiteral":
			return { type: `literal(${JSON.stringify(def.value)})`, description };
		case "ZodUnion": {
			const options = (def.options as ZodType[]).map(extractSchema);
			const types = options.map((o) => o.type).join(" | ");
			return { type: types, description };
		}
		case "ZodIntersection": {
			const left = extractSchema(def.left as ZodType);
			const right = extractSchema(def.right as ZodType);
			// Merge properties if both are objects
			if (left.properties && right.properties) {
				return {
					type: "object",
					description,
					properties: { ...left.properties, ...right.properties },
					required: [...(left.required || []), ...(right.required || [])],
				};
			}
			return { type: `${left.type} & ${right.type}`, description };
		}
		case "ZodRecord": {
			const valueType = extractSchema(def.valueType as ZodType);
			return { type: `record<string, ${valueType.type}>`, description };
		}
		case "ZodTuple": {
			const items = (def.items as ZodType[]).map(extractSchema);
			const types = items.map((i) => i.type).join(", ");
			return { type: `tuple[${types}]`, description };
		}
		case "ZodDefault": {
			const inner = extractSchema(def.innerType as ZodType);
			inner.description = description || inner.description;
			const defaultFn = def.defaultValue as () => unknown;
			return {
				...inner,
				type: `${inner.type} (default: ${JSON.stringify(defaultFn())})`,
			};
		}
		case "ZodEffects": {
			// .transform(), .refine(), .preprocess() - extract the inner schema
			const inner = extractSchema(def.schema as ZodType);
			inner.description = description || inner.description;
			return inner;
		}
		case "ZodLazy": {
			const getter = def.getter as () => ZodType;
			return extractSchema(getter());
		}
		case "ZodNativeEnum": {
			const values = Object.values(
				def.values as Record<string, string | number>,
			).filter((v) => typeof v === "string");
			return { type: "enum", description, values: values as string[] };
		}
		default:
			return { type: typeName.replace("Zod", "").toLowerCase(), description };
	}
}

function toYaml(node: SchemaNode, indent: number): string {
	const prefix = "  ".repeat(indent);
	const lines: string[] = [];

	if (node.description) {
		lines.push(`${prefix}# ${node.description}`);
	}

	if (node.properties) {
		if (indent === 0 && node.type === "object") {
			// Top-level: just show properties
		} else {
			lines.push(`${prefix}type: ${node.type}`);
		}
		for (const [key, prop] of Object.entries(node.properties)) {
			const isRequired = node.required?.includes(key);
			const suffix = isRequired ? "" : " (optional)";
			if (prop.properties) {
				lines.push(`${prefix}${key}:${suffix}`);
				lines.push(toYaml(prop, indent + 1));
			} else if (prop.items) {
				const itemDesc = prop.description ? ` # ${prop.description}` : "";
				lines.push(`${prefix}${key}: ${prop.type}${suffix}${itemDesc}`);
				lines.push(toYaml(prop.items, indent + 1));
			} else {
				const desc = prop.description ? ` # ${prop.description}` : "";
				lines.push(`${prefix}${key}: ${prop.type}${suffix}${desc}`);
				if (prop.values) {
					lines.push(`${prefix}  values: [${prop.values.join(", ")}]`);
				}
			}
		}
	} else if (node.items) {
		lines.push(`${prefix}type: ${node.type}`);
		lines.push(`${prefix}items:`);
		lines.push(toYaml(node.items, indent + 1));
	} else if (node.values) {
		lines.push(`${prefix}type: ${node.type}`);
		lines.push(`${prefix}values: [${node.values.join(", ")}]`);
	} else {
		lines.push(`${prefix}type: ${node.type}`);
	}

	return lines.join("\n");
}
