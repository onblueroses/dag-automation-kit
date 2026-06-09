import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	makeConstrainedSchema,
	makeNodePromptContext,
	schemaToPromptYaml,
} from "../../src/utils/schema-prompt.js";

describe("schemaToPromptYaml", () => {
	it("converts a described schema to YAML", () => {
		const schema = z
			.object({
				name: z.string().describe("User name"),
				age: z.number().describe("User age"),
			})
			.describe("A user profile");

		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("name");
		expect(yaml).toContain("age");
		expect(yaml).toContain("User name");
		expect(yaml).toContain("string");
	});

	it("caches results", () => {
		const schema = z.object({ x: z.number() });
		const first = schemaToPromptYaml(schema);
		const second = schemaToPromptYaml(schema);
		expect(first).toBe(second);
	});

	it("strips $schema and additionalProperties", () => {
		const schema = z.object({ x: z.string() });
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).not.toContain("$schema");
		expect(yaml).not.toContain("additionalProperties");
	});

	it("handles union types", () => {
		const schema = z.object({
			value: z.union([z.string(), z.number()]),
		});
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("string | number");
	});

	it("handles literals", () => {
		const schema = z.object({
			status: z.literal("active"),
		});
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("literal");
		expect(yaml).toContain("active");
	});

	it("handles defaults", () => {
		const schema = z.object({
			retries: z.number().default(3),
		});
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("default");
		expect(yaml).toContain("3");
	});

	it("handles records", () => {
		const schema = z.object({
			metadata: z.record(z.string()),
		});
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("record");
	});

	it("handles effects (transform/refine) by extracting inner schema", () => {
		const schema = z.object({
			email: z.string().transform((s) => s.toLowerCase()),
		});
		const yaml = schemaToPromptYaml(schema);
		expect(yaml).toContain("email");
		expect(yaml).toContain("string");
	});
});

describe("makeNodePromptContext", () => {
	it("produces a markdown prompt block", () => {
		const input = z.object({ query: z.string().describe("Search query") });
		const output = z.object({
			results: z.array(z.string()).describe("Search results"),
		});

		const context = makeNodePromptContext({
			name: "SearchNode",
			description: "Searches for content",
			inputSchema: input,
			outputSchema: output,
		});

		expect(context).toContain("## SearchNode");
		expect(context).toContain("Searches for content");
		expect(context).toContain("### Input");
		expect(context).toContain("### Output");
		expect(context).toContain("```yaml");
		expect(context).toContain("query");
		expect(context).toContain("results");
	});
});

describe("makeConstrainedSchema", () => {
	it("narrows an enum field to specific values", () => {
		const base = z.object({
			category: z.enum(["security", "logic", "style", "docs", "perf"]),
			description: z.string(),
		});

		const securityOnly = makeConstrainedSchema(base, "category", [
			"security",
			"logic",
		]);
		const parsed = securityOnly.safeParse({
			category: "security",
			description: "test",
		});
		expect(parsed.success).toBe(true);

		const rejected = securityOnly.safeParse({
			category: "style",
			description: "test",
		});
		expect(rejected.success).toBe(false);
	});

	it("preserves other fields", () => {
		const base = z.object({
			category: z.enum(["a", "b", "c"]),
			value: z.number(),
		});

		const constrained = makeConstrainedSchema(base, "category", ["a"]);
		const parsed = constrained.safeParse({ category: "a", value: 42 });
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.value).toBe(42);
		}
	});
});
