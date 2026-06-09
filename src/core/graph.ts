/** DAG definition types and topological sort for wave-parallel execution. */

export interface DAGNode {
	id: string;
	nodeType: string;
	input: Record<string, unknown>;
}

export interface DAGEdge {
	from: string;
	to: string;
}

export interface DAGDefinition {
	nodes: DAGNode[];
	edges: DAGEdge[];
}

export interface DAGValidationResult {
	valid: boolean;
	errors: string[];
}

/**
 * Validate a DAG definition for structural correctness.
 * Checks: node existence for all edge endpoints, no duplicate IDs, no self-edges, no cycles.
 */
export function validateDAG(dag: DAGDefinition): DAGValidationResult {
	const errors: string[] = [];
	const nodeIds = new Set<string>();

	// Check for duplicate IDs
	for (const node of dag.nodes) {
		if (nodeIds.has(node.id)) {
			errors.push(`Duplicate node ID: "${node.id}"`);
		}
		nodeIds.add(node.id);
	}

	// Check edges
	for (const edge of dag.edges) {
		if (edge.from === edge.to) {
			errors.push(`Self-edge on node "${edge.from}"`);
		}
		if (!nodeIds.has(edge.from)) {
			errors.push(`Edge references missing node "${edge.from}"`);
		}
		if (!nodeIds.has(edge.to)) {
			errors.push(`Edge references missing node "${edge.to}"`);
		}
	}

	// Check for cycles via topological sort attempt
	if (errors.length === 0) {
		try {
			topologicalSort(dag);
		} catch (err) {
			if (err instanceof Error) {
				errors.push(err.message);
			}
		}
	}

	return { valid: errors.length === 0, errors };
}

/**
 * Topological sort using Kahn's algorithm. Returns waves of independent nodes.
 * Each wave can be executed in parallel. Throws on cycle detection.
 */
export function topologicalSort(dag: DAGDefinition): string[][] {
	const inDegree = new Map<string, number>();
	const adjacency = new Map<string, string[]>();

	// Initialize
	for (const node of dag.nodes) {
		inDegree.set(node.id, 0);
		adjacency.set(node.id, []);
	}

	// Build graph
	for (const edge of dag.edges) {
		const neighbors = adjacency.get(edge.from);
		if (neighbors) neighbors.push(edge.to);
		inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
	}

	// Collect initial wave (nodes with no incoming edges)
	const waves: string[][] = [];
	let queue: string[] = [];
	for (const [id, degree] of inDegree) {
		if (degree === 0) queue.push(id);
	}

	let processed = 0;

	while (queue.length > 0) {
		waves.push([...queue]);
		processed += queue.length;

		const nextQueue: string[] = [];
		for (const id of queue) {
			for (const neighbor of adjacency.get(id) ?? []) {
				const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
				inDegree.set(neighbor, newDegree);
				if (newDegree === 0) {
					nextQueue.push(neighbor);
				}
			}
		}
		queue = nextQueue;
	}

	if (processed < dag.nodes.length) {
		// Find cycle participants for error message
		const cycleNodes = dag.nodes
			.filter((n) => (inDegree.get(n.id) ?? 0) > 0)
			.map((n) => n.id);
		throw new Error(`Cycle detected involving nodes: ${cycleNodes.join(", ")}`);
	}

	return waves;
}
