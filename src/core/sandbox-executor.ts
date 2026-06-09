import type { SandboxConfig } from "./config.js";
import type { ExecutionContext } from "./context.js";
import { buildSandboxSecrets } from "./sandbox-credentials.js";
import type { NodeResult } from "./types.js";

/**
 * Execute a node inside a Gondolin micro-VM with credential placeholder swap.
 *
 * The node's input is serialized as JSON and run as a script inside the VM.
 * Credentials are converted to Gondolin secrets - the guest only sees placeholder
 * env vars, and real values are substituted at the MITM proxy boundary.
 *
 * This limits sandboxing to nodes whose execution can be expressed as a standalone
 * HTTP script - which is exactly the "HTTP integration" nodes that benefit from
 * sandboxing.
 */
export async function executeSandboxed(
	nodeType: string,
	input: unknown,
	context: ExecutionContext,
	sandboxConfig: SandboxConfig,
): Promise<NodeResult> {
	// Lazy import to avoid requiring gondolin when sandbox isn't used
	const { VM, createHttpHooks, RealFSProvider, ReadonlyProvider } =
		await import("@earendil-works/gondolin");

	const { secrets } = buildSandboxSecrets(
		context.credentials,
		sandboxConfig.allowedHosts,
		sandboxConfig.secretHosts,
	);

	// Gondolin treats allowedHosts: [] as "allow all". Use a sentinel
	// that matches nothing to enforce deny-all when no hosts are specified.
	const effectiveHosts =
		sandboxConfig.allowedHosts.length > 0
			? sandboxConfig.allowedHosts
			: ["__gondolin_deny_all__"];

	const { httpHooks, env: secretEnv } = createHttpHooks({
		allowedHosts: effectiveHosts,
		secrets,
	});

	const guestEnv: Record<string, string> = {
		...secretEnv,
		...sandboxConfig.env,
	};

	const vmOptions: Parameters<(typeof VM)["create"]>[0] = {
		httpHooks,
		env: guestEnv,
	};

	if (sandboxConfig.mounts && sandboxConfig.mounts.length > 0) {
		vmOptions.vfs = {
			mounts: Object.fromEntries(
				sandboxConfig.mounts.map((m) => [
					m.guest,
					new ReadonlyProvider(new RealFSProvider(m.host)),
				]),
			),
		};
	}

	const vm = await VM.create(vmOptions);
	const timeoutMs = sandboxConfig.timeoutMs ?? 60000;

	try {
		// Write input to guest filesystem
		const inputJson = JSON.stringify(input);
		await vm.fs.writeFile("/tmp/input.json", inputJson);

		// Write executor script
		const script = buildGuestScript(nodeType);
		await vm.fs.writeFile("/tmp/run.sh", script);

		// Execute with timeout via AbortSignal
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		let result: Awaited<ReturnType<typeof vm.exec>>;
		try {
			result = await vm.exec("sh /tmp/run.sh", {
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}

		if (!result.ok) {
			return {
				success: false,
				error: `Sandbox execution failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
			};
		}

		// Read output
		let output: unknown;
		try {
			const outputText = await vm.fs.readFile("/tmp/output.json", {
				encoding: "utf-8",
			});
			output = JSON.parse(outputText as string);
		} catch {
			// If no structured output, use stdout
			output = { stdout: result.stdout, stderr: result.stderr };
		}

		return { success: true, output };
	} finally {
		await vm.close();
	}
}

/**
 * Build a shell script that the guest VM will execute.
 *
 * The script reads /tmp/input.json, processes it based on the node type,
 * and writes the result to /tmp/output.json. Credentials are available
 * as env vars (placeholder values swapped at MITM proxy boundary).
 */
function buildGuestScript(nodeType: string): string {
	// Uses jq (available in Alpine) for safe JSON parsing/encoding.
	// Auth headers injected from any env var containing token/key/secret.
	return `#!/bin/sh
set -e

export NODE_TYPE="${nodeType}"

# Extract fields using jq (safe JSON parsing)
URL=$(jq -r '.url // empty' /tmp/input.json)

if [ -n "$URL" ]; then
  METHOD=$(jq -r '.method // "GET"' /tmp/input.json)
  BODY=$(jq -c '.body // empty' /tmp/input.json)

  CURL_ARGS="-sS -w '\\n%{http_code}' -X $METHOD"

  # Add auth headers from any credential env var (API_KEY, TOKEN, BEARER_TOKEN, etc.)
  for var in $(env | grep -iE '^[A-Z_]*(API_KEY|TOKEN|BEARER|SECRET)=' | cut -d= -f1); do
    val=$(eval echo \\$$var)
    CURL_ARGS="$CURL_ARGS -H 'Authorization: Bearer $val'"
  done

  if [ -n "$BODY" ] && [ "$BODY" != "null" ]; then
    CURL_ARGS="$CURL_ARGS -H 'Content-Type: application/json' -d '$BODY'"
  fi

  # Capture response and HTTP status separately
  FULL_RESPONSE=$(eval curl $CURL_ARGS "$URL" 2>/tmp/curl_stderr)
  CURL_EXIT=$?
  STDERR=$(cat /tmp/curl_stderr 2>/dev/null || true)

  # Extract HTTP status from last line (from -w '%{http_code}')
  HTTP_STATUS=$(echo "$FULL_RESPONSE" | tail -1)
  RESPONSE_BODY=$(echo "$FULL_RESPONSE" | sed '$ d')

  if [ $CURL_EXIT -ne 0 ]; then
    # Curl failed - propagate as structured error
    jq -n --arg err "$STDERR" --arg code "$CURL_EXIT" \\
      '{"error": $err, "curlExitCode": ($code | tonumber)}' > /tmp/output.json
    exit 1
  fi

  # Encode response body as proper JSON string
  jq -n --arg body "$RESPONSE_BODY" --arg status "$HTTP_STATUS" --arg stderr "$STDERR" \\
    '{"response": $body, "status": ($status | tonumber? // 0), "stderr": $stderr}' > /tmp/output.json
else
  # No URL - echo input back as output
  cp /tmp/input.json /tmp/output.json
fi
`;
}
