import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { NodeExecutionConfig } from "./config.js";
import { resolveNodeConfig } from "./config.js";
import { ExecutionContext } from "./context.js";
import type { CostTracker } from "./cost.js";
import { BudgetExceededError } from "./cost.js";
import type { DAGDefinition } from "./graph.js";
import { topologicalSort, validateDAG } from "./graph.js";
import type { NodeRegistry } from "./registry.js";
import type { WorkflowState, WorkflowStore } from "./store.js";
import type { CacheStore, RateLimitStore } from "./stores.js";
import type {
	NodeResult,
	NodeServices,
	StepEvent,
	WorkflowErrorCode,
	WorkflowResult,
	WorkflowStep,
} from "./types.js";

const DEFAULT_MAX_STEPS = 100;

function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
	}
	return (hash >>> 0).toString(36);
}

export interface WorkflowOptions {
	maxSteps?: number;
	onStep?: (event: StepEvent) => void;
	store?: WorkflowStore;
	id?: string;
	costTracker?: CostTracker;
	cacheStore?: CacheStore;
	rateLimitStore?: RateLimitStore;
	nodeConfig?: Record<string, Partial<NodeExecutionConfig>>;
}

export async function runWorkflow(
	steps: Record<string, WorkflowStep>,
	startNode: string,
	registry: NodeRegistry,
	context: ExecutionContext,
	options?: WorkflowOptions,
): Promise<WorkflowResult> {
	return executeFromNode(steps, startNode, registry, context, [], options);
}

/**
 * Resume a workflow that was paused by an approvalRequired gate.
 * Picks up from the paused node's nextNode and continues execution.
 * The context should be the same instance (or restored via fromJSON) that
 * was used when the workflow was paused - it contains all prior node outputs.
 */
export async function resumeWorkflow(
	pausedResult: WorkflowResult,
	steps: Record<string, WorkflowStep>,
	registry: NodeRegistry,
	context: ExecutionContext,
	options?: WorkflowOptions,
): Promise<WorkflowResult> {
	if (!pausedResult.pausedAt) {
		return {
			steps: [],
			success: false,
			error: {
				code: "RESUME_INVALID",
				message: "Cannot resume: workflow was not paused (no pausedAt)",
			},
		};
	}

	// Find the nextNode from the last executed step's result
	const lastStep = pausedResult.steps[pausedResult.steps.length - 1];
	if (!lastStep) {
		return {
			steps: [],
			success: false,
			error: {
				code: "RESUME_INVALID",
				message: "Cannot resume: paused result has no executed steps",
			},
		};
	}

	const nextNode = lastStep.result.nextNode;
	if (!nextNode) {
		// Paused node had no nextNode - workflow is complete
		return {
			steps: [...pausedResult.steps],
			success: true,
		};
	}

	return executeFromNode(
		steps,
		nextNode,
		registry,
		context,
		[...pausedResult.steps],
		options,
	);
}

/**
 * Resume a workflow by ID from a store.
 * Loads the persisted state, reconstructs context, and resumes execution.
 */
export async function resumeById(
	id: string,
	store: WorkflowStore,
	registry: NodeRegistry,
	services?: NodeServices,
	options?: WorkflowOptions,
): Promise<WorkflowResult> {
	const state = await store.load(id);
	if (!state) {
		return {
			id,
			steps: [],
			success: false,
			error: {
				code: "RESUME_INVALID",
				message: `Cannot resume: no workflow found with id "${id}"`,
			},
		};
	}

	const context = ExecutionContext.fromJSON(state.contextSnapshot, services);
	const resumeOptions: WorkflowOptions = { ...options, store, id };

	return resumeWorkflow(
		state.result,
		state.steps,
		registry,
		context,
		resumeOptions,
	);
}

async function executeFromNode(
	steps: Record<string, WorkflowStep>,
	startNode: string,
	registry: NodeRegistry,
	context: ExecutionContext,
	priorSteps: Array<{ stepId: string; nodeType: string; result: NodeResult }>,
	options?: WorkflowOptions,
): Promise<WorkflowResult> {
	const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
	const onStep = options?.onStep;
	const store = options?.store;
	const workflowId = store ? (options?.id ?? randomUUID()) : undefined;
	const executedSteps = [...priorSteps];
	let currentId: string | undefined = startNode;
	let stepCount = priorSteps.length;

	const persist = async (
		result: WorkflowResult,
		status: WorkflowState["status"],
	): Promise<WorkflowResult> => {
		if (options?.costTracker) {
			result.cost = options.costTracker.report();
		}
		if (store && workflowId) {
			result.id = workflowId;
			await store.save({
				id: workflowId,
				status,
				result,
				contextSnapshot: context.snapshot(),
				steps,
				startNode,
			});
		}
		return result;
	};

	while (currentId !== undefined) {
		if (stepCount >= maxSteps) {
			return persist(
				{
					id: workflowId,
					steps: executedSteps,
					success: false,
					error: {
						code: "MAX_STEPS_EXCEEDED",
						message: `Workflow exceeded maximum of ${maxSteps} steps (possible cycle). Last step: "${currentId}"`,
						stepId: currentId,
					},
				},
				"error",
			);
		}
		stepCount++;

		const step = steps[currentId];
		if (!step) {
			return persist(
				{
					id: workflowId,
					steps: executedSteps,
					success: false,
					error: {
						code: "STEP_NOT_FOUND",
						message: `Step "${currentId}" not found in workflow`,
						stepId: currentId,
					},
				},
				"error",
			);
		}

		// Interpolate string values in input using current context
		const interpolatedInput = context.interpolateObject(step.input);

		let result: NodeResult;
		const startTime = Date.now();
		const config = resolveNodeConfig(
			step.nodeType,
			currentId,
			options?.nodeConfig,
		);

		if (options?.costTracker) {
			options.costTracker.currentStepId = currentId;
		}

		// Check cache before executing
		const cacheKey =
			config.cacheKey ??
			`node:${step.nodeType}:${currentId}:${simpleHash(JSON.stringify(interpolatedInput))}`;
		if (config.cacheTtlMs && options?.cacheStore) {
			const cached = await options.cacheStore.get(cacheKey);
			if (cached !== undefined) {
				result = cached as NodeResult;
				executedSteps.push({
					stepId: currentId,
					nodeType: step.nodeType,
					result,
				});
				if (result.output !== undefined) {
					context.setNodeOutput(currentId, result.output);
					if (currentId !== step.nodeType) {
						context.setNodeOutput(step.nodeType, result.output);
					}
				}
				if (onStep) {
					onStep({
						stepId: currentId,
						nodeType: step.nodeType,
						result,
						durationMs: Date.now() - startTime,
					});
				}
				currentId = result.nextNode;
				continue;
			}
		}

		try {
			result = await executeWithConfig(
				registry,
				step.nodeType,
				interpolatedInput,
				context,
				config,
			);
		} catch (err) {
			if (err instanceof BudgetExceededError) {
				return persist(
					{
						id: workflowId,
						steps: executedSteps,
						success: false,
						error: {
							code: "BUDGET_EXCEEDED",
							message: err.message,
							stepId: currentId,
							nodeType: step.nodeType,
							cause: err,
						},
					},
					"error",
				);
			}
			const isValidation = err instanceof z.ZodError;
			const message = err instanceof Error ? err.message : String(err);
			return persist(
				{
					id: workflowId,
					steps: executedSteps,
					success: false,
					error: {
						code: isValidation ? "VALIDATION_ERROR" : "NODE_THREW",
						message: `Node "${step.nodeType}" (step "${currentId}") threw: ${message}`,
						stepId: currentId,
						nodeType: step.nodeType,
						cause: err,
					},
				},
				"error",
			);
		}

		// Cache successful result if configured
		if (config.cacheTtlMs && options?.cacheStore && result.success) {
			await options.cacheStore.set(cacheKey, result, config.cacheTtlMs);
		}

		executedSteps.push({ stepId: currentId, nodeType: step.nodeType, result });

		if (onStep) {
			onStep({
				stepId: currentId,
				nodeType: step.nodeType,
				result,
				durationMs: Date.now() - startTime,
				cost: options?.costTracker?.stepReport(currentId),
			});
		}

		// Store output in context under the step ID AND the node type
		if (result.output !== undefined) {
			context.setNodeOutput(currentId, result.output);
			// Also store under nodeType for nodes that use type-based lookup
			if (currentId !== step.nodeType) {
				context.setNodeOutput(step.nodeType, result.output);
			}
		}

		if (!result.success) {
			return persist(
				{
					id: workflowId,
					steps: executedSteps,
					success: false,
					error: {
						code: "NODE_FAILED",
						message: result.error ?? `Node "${step.nodeType}" failed`,
						stepId: currentId,
						nodeType: step.nodeType,
					},
				},
				"error",
			);
		}

		// Approval gate - halt and wait for human
		if (result.approvalRequired) {
			return persist(
				{
					id: workflowId,
					steps: executedSteps,
					success: true,
					pausedAt: currentId,
				},
				"paused",
			);
		}

		// Parallel execution - fork context per branch, run concurrently, merge
		if (result.parallel && result.parallel.length > 0) {
			const remainingSteps = maxSteps - stepCount;
			const branchResults = await Promise.allSettled(
				result.parallel.map((branchStart) => {
					const forkedContext = ExecutionContext.fromJSON(
						structuredClone(context.snapshot()),
						context.services,
					);
					return executeFromNode(
						steps,
						branchStart,
						registry,
						forkedContext,
						[],
						{
							maxSteps: remainingSteps,
							nodeConfig: options?.nodeConfig,
							cacheStore: options?.cacheStore,
							rateLimitStore: options?.rateLimitStore,
							costTracker: options?.costTracker,
						},
					);
				}),
			);

			// Collect branch steps, check for failures and approval gates
			for (let i = 0; i < branchResults.length; i++) {
				const settled = branchResults[i];
				const branchId = result.parallel[i];

				if (settled.status === "rejected") {
					return persist(
						{
							id: workflowId,
							steps: executedSteps,
							success: false,
							error: {
								code: "NODE_THREW",
								message: `Parallel branch "${branchId}" threw: ${settled.reason instanceof Error ? settled.reason.message : String(settled.reason)}`,
								stepId: branchId,
								cause: settled.reason,
							},
						},
						"error",
					);
				}

				const branchResult = settled.value;

				// Check for approval gates inside parallel branches (not supported in v1)
				if (branchResult.pausedAt) {
					return persist(
						{
							id: workflowId,
							steps: [...executedSteps, ...branchResult.steps],
							success: false,
							error: {
								code: "VALIDATION_ERROR",
								message: `Approval gates inside parallel branches are not supported (branch "${branchId}" paused at "${branchResult.pausedAt}")`,
								stepId: branchResult.pausedAt,
							},
						},
						"error",
					);
				}

				if (!branchResult.success) {
					return persist(
						{
							id: workflowId,
							steps: [...executedSteps, ...branchResult.steps],
							success: false,
							error: branchResult.error,
						},
						"error",
					);
				}

				// Merge branch steps and outputs into parent
				for (const branchStep of branchResult.steps) {
					executedSteps.push(branchStep);
					stepCount++;
					if (branchStep.result.output !== undefined) {
						context.setNodeOutput(branchStep.stepId, branchStep.result.output);
					}
					if (onStep) {
						onStep({
							stepId: branchStep.stepId,
							nodeType: branchStep.nodeType,
							result: branchStep.result,
							durationMs: 0,
						});
					}
				}
			}

			// After all branches complete, continue to nextNode if set
			currentId = result.nextNode;
			continue;
		}

		// Follow nextNode if set, otherwise terminate
		currentId = result.nextNode;
	}

	return persist(
		{
			id: workflowId,
			steps: executedSteps,
			success: true,
		},
		"completed",
	);
}

async function executeWithConfig(
	registry: NodeRegistry,
	nodeType: string,
	input: unknown,
	context: ExecutionContext,
	config: NodeExecutionConfig,
): Promise<NodeResult> {
	let lastErr: unknown;
	const maxAttempts = Math.max(1, config.retryCount + 1);

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		let timedOut = false;

		try {
			// Delegate to sandbox executor when sandbox config is present
			if (config.sandbox) {
				const { executeSandboxed } = await import("./sandbox-executor.js");
				return await executeSandboxed(nodeType, input, context, config.sandbox);
			}

			if (config.timeoutMs > 0 && config.timeoutMs < 30000) {
				const result = await Promise.race([
					registry.execute(nodeType, input, context),
					new Promise<never>((_, reject) =>
						setTimeout(() => {
							timedOut = true;
							reject(
								new Error(
									`Node "${nodeType}" timed out after ${config.timeoutMs}ms`,
								),
							);
						}, config.timeoutMs),
					),
				]);
				return result;
			}
			return await registry.execute(nodeType, input, context);
		} catch (err) {
			lastErr = err;
			// Don't retry if the node timed out - the previous attempt may still be running
			if (timedOut) throw err;
			if (attempt < maxAttempts - 1) {
				await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
			}
		}
	}
	throw lastErr;
}

/**
 * Run a workflow defined as a DAG with wave-parallel execution.
 * Nodes within each wave execute concurrently via Promise.allSettled.
 * Context from earlier waves is available to later waves via interpolation.
 */
export async function runDAGWorkflow(
	dag: DAGDefinition,
	registry: NodeRegistry,
	context: ExecutionContext,
	options?: WorkflowOptions,
): Promise<WorkflowResult> {
	const onStep = options?.onStep;
	const executedSteps: Array<{
		stepId: string;
		nodeType: string;
		result: NodeResult;
	}> = [];
	const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));

	// Validate DAG structure before execution
	const validation = validateDAG(dag);
	if (!validation.valid) {
		const result: WorkflowResult = {
			steps: [],
			success: false,
			error: {
				code: "VALIDATION_ERROR",
				message: `Invalid DAG: ${validation.errors.join("; ")}`,
			},
		};
		if (options?.costTracker) result.cost = options.costTracker.report();
		return result;
	}

	const waves = topologicalSort(dag);

	const makeError = (
		code: WorkflowErrorCode,
		message: string,
		stepId?: string,
		nodeType?: string,
		cause?: unknown,
	): WorkflowResult => {
		const result: WorkflowResult = {
			steps: executedSteps,
			success: false,
			error: { code, message, stepId, nodeType, cause },
		};
		if (options?.costTracker) result.cost = options.costTracker.report();
		return result;
	};

	for (const wave of waves) {
		const waveResults = await Promise.allSettled(
			wave.map(async (nodeId) => {
				const node = nodeMap.get(nodeId)!;
				const config = resolveNodeConfig(
					node.nodeType,
					nodeId,
					options?.nodeConfig,
				);
				const interpolatedInput = context.interpolateObject(node.input);

				// Note: costTracker.currentStepId is not set here because concurrent wave
				// nodes would race on the shared mutable field. Cost tracking for DAG waves
				// requires explicit per-call step ID passing (future CostTracker API change).

				// Check cache
				const cacheKey =
					config.cacheKey ??
					`node:${node.nodeType}:${nodeId}:${simpleHash(JSON.stringify(interpolatedInput))}`;
				if (config.cacheTtlMs && options?.cacheStore) {
					const cached = await options.cacheStore.get(cacheKey);
					if (cached !== undefined) {
						return {
							nodeId,
							nodeType: node.nodeType,
							result: cached as NodeResult,
							durationMs: 0,
						};
					}
				}

				const startTime = Date.now();
				const result = await executeWithConfig(
					registry,
					node.nodeType,
					interpolatedInput,
					context,
					config,
				);

				// Cache on success
				if (config.cacheTtlMs && options?.cacheStore && result.success) {
					await options.cacheStore.set(cacheKey, result, config.cacheTtlMs);
				}

				return {
					nodeId,
					nodeType: node.nodeType,
					result,
					durationMs: Date.now() - startTime,
				};
			}),
		);

		// Process wave results
		for (const settled of waveResults) {
			if (settled.status === "rejected") {
				const err = settled.reason;
				const message = err instanceof Error ? err.message : String(err);
				return makeError("NODE_THREW", message);
			}

			const { nodeId, nodeType, result, durationMs } = settled.value;
			executedSteps.push({ stepId: nodeId, nodeType, result });

			if (onStep) {
				onStep({ stepId: nodeId, nodeType, result, durationMs });
			}

			if (result.output !== undefined) {
				context.setNodeOutput(nodeId, result.output);
				if (nodeId !== nodeType) {
					context.setNodeOutput(nodeType, result.output);
				}
			}

			if (!result.success) {
				return makeError(
					"NODE_FAILED",
					result.error ?? `Node "${nodeType}" failed`,
					nodeId,
					nodeType,
				);
			}

			if (result.approvalRequired) {
				return makeError(
					"VALIDATION_ERROR",
					`Approval gates inside DAG workflows are not supported (node "${nodeId}")`,
					nodeId,
					nodeType,
				);
			}
		}
	}

	const finalResult: WorkflowResult = { steps: executedSteps, success: true };
	if (options?.costTracker) finalResult.cost = options.costTracker.report();
	return finalResult;
}
