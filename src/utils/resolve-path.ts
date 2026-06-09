/**
 * Resolves a dot-notation path string against an arbitrary object.
 * Operates on any object rather than the workflow variable store.
 *
 * Supported: dot notation, keyed array access, standalone array index, empty path.
 */
export function resolvePath(obj: unknown, path: string): unknown {
	if (!path) {
		return obj;
	}

	const parts = path.split(".");
	let current: unknown = obj;

	for (const part of parts) {
		if (current === null || current === undefined) {
			return undefined;
		}

		const keyedArrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
		if (keyedArrayMatch) {
			const [, key, index] = keyedArrayMatch;
			current = (current as Record<string, unknown>)[key!];
			if (Array.isArray(current)) {
				current = current[parseInt(index!, 10)];
			} else {
				return undefined;
			}
			continue;
		}

		const standaloneIndexMatch = part.match(/^\[(\d+)\]$/);
		if (standaloneIndexMatch) {
			if (Array.isArray(current)) {
				current = current[parseInt(standaloneIndexMatch[1]!, 10)];
			} else {
				return undefined;
			}
			continue;
		}

		current = (current as Record<string, unknown>)[part];
	}

	return current;
}
