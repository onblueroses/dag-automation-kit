import type { ZodType } from "zod";

// Accepts any Zod schema that outputs T, regardless of input type (handles .default())
type AnyZodType<T> = ZodType<T, any, any>;

import type { CostReport, StepCostReport } from "./cost.js";

export type NodeCategory =
	| "action"
	| "logic"
	| "integration"
	| "transform"
	| "workflow";

// Credentials for API authentication.
// Nodes use these to make direct HTTP calls without requiring injected services.
export interface KnownCredentials {
	firecrawl?: {
		bearerToken?: string;
	};
	twitter?: {
		clientId?: string;
		clientSecret?: string;
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: number;
		bearerToken?: string;
		twitterApiIoKey?: string;
		consumerKey?: string;
		consumerSecret?: string;
		accessTokenSecret?: string;
	};
	dataForSeo?: {
		apiToken: string;
	};
	openai?: {
		apiKey: string;
	};
	anthropic?: {
		apiKey: string;
	};
	discordBot?: {
		botToken: string;
	};
	discordWebhook?: {
		webhookUrl: string;
	};
	devto?: {
		apiKey: string;
	};
	wordpress?: {
		siteUrl: string;
		username: string;
		applicationPassword: string;
	};
	apify?: {
		apiToken: string;
	};
	googleSheets?: {
		clientId: string;
		clientSecret: string;
		accessToken: string;
		refreshToken: string;
		expiresAt: number;
	};
	openRouter?: {
		apiKey: string;
	};
	openRouterDraft?: {
		apiKey: string;
	};
	youtube?: {
		apiKey: string;
	};
	elevenlabs?: {
		apiKey: string;
	};
	unsplash?: {
		accessKey: string;
	};
	tavily?: {
		apiKey: string;
	};
	ssh?: {
		privateKey: string;
		host: string;
		user: string;
		port?: number;
	};
}

/** Extensible credentials: typed known services + arbitrary string-keyed services. */
export type NodeCredentials = KnownCredentials &
	Record<string, Record<string, unknown> | undefined>;

export interface CredentialField {
	type: "header" | "query" | "body" | "basic";
	required?: boolean;
	description?: string;
}

export interface NodeCapabilities {
	supportsRerun?: boolean;
	supportsBulkActions?: boolean;
	supportsApproval?: boolean;
	supportsEnrichment?: boolean;
	supportsCancel?: boolean;
}

export interface NodeDefinition<TInput = unknown, TOutput = unknown> {
	type: string;
	name: string;
	description?: string;
	category: NodeCategory;
	inputSchema: AnyZodType<TInput>;
	outputSchema: AnyZodType<TOutput>;
	executor: NodeExecutor<TInput, TOutput>;
	estimatedDuration?: number;
	capabilities?: NodeCapabilities;
	/** Declarative credential requirements. Keys are service names matching NodeCredentials keys. */
	credentials?: Record<string, CredentialField>;
}

export interface NodeResult<TOutput = unknown> {
	success: boolean;
	output?: TOutput;
	error?: string;
	nextNode?: string;
	approvalRequired?: boolean;
	parallel?: string[];
}

export type NodeExecutor<TInput, TOutput> = (
	input: TInput,
	context: ExecutionContext,
) => Promise<NodeResult<TOutput>>;

export interface NodeServices {
	anthropic?: AnthropicService;
	[key: string]: unknown;
}

export interface AnthropicService {
	generateText(params: {
		prompt: string;
		model?: string;
		maxTokens?: number;
	}): Promise<string>;
	generateStructured<T>(params: {
		prompt: string;
		schema: ZodType<T>;
		model?: string;
	}): Promise<T>;
}

// Metadata only - safe to expose to frontend/UI (no executor, no schemas).
// Includes credentials definitions (metadata about what auth is needed, not secrets).
export type NodeMetadata = Omit<
	NodeDefinition,
	"executor" | "inputSchema" | "outputSchema"
>;

// ExecutionContext is declared here as an interface so types.ts stays self-contained.
// The concrete class lives in context.ts.
export interface ExecutionContext {
	readonly services: NodeServices;
	readonly credentials?: NodeCredentials;
	setNodeOutput(nodeType: string, output: unknown): void;
	get(path: string): unknown;
	set(key: string, value: unknown): void;
	resolveNestedPath(path: string): unknown;
	interpolate(template: string): unknown;
	/**
	 * Recursively interpolate {{path}} references in an object's string values.
	 *
	 * NOTE: This is a runtime transform, not a type-safe operation. String values
	 * like '{{ref}}' may become arrays, objects, or numbers after interpolation
	 * (via single-var resolution). The returned type `T` matches the input shape
	 * at compile time, but runtime types may differ. Zod schema validation in
	 * registry.execute() catches mismatches at the boundary.
	 */
	interpolateObject<T extends Record<string, unknown>>(obj: T): T;
	snapshot(): Record<string, unknown>;
}

export interface WorkflowStep {
	nodeType: string;
	input: Record<string, unknown>;
}

export type WorkflowErrorCode =
	| "NODE_FAILED"
	| "NODE_THREW"
	| "VALIDATION_ERROR"
	| "STEP_NOT_FOUND"
	| "MAX_STEPS_EXCEEDED"
	| "RESUME_INVALID"
	| "BUDGET_EXCEEDED";

export interface WorkflowError {
	code: WorkflowErrorCode;
	message: string;
	stepId?: string;
	nodeType?: string;
	cause?: unknown;
}

export interface WorkflowResult {
	id?: string;
	steps: Array<{ stepId: string; nodeType: string; result: NodeResult }>;
	success: boolean;
	pausedAt?: string;
	error?: WorkflowError;
	cost?: CostReport;
}

export interface StepEvent {
	stepId: string;
	nodeType: string;
	result: NodeResult;
	durationMs: number;
	cost?: StepCostReport;
}
