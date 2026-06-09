# Sandbox Execution

Run individual workflow nodes inside disposable Gondolin micro-VMs with credential placeholder swap.

## How it works

When a node's `NodeExecutionConfig` includes a `sandbox` field, `executeWithConfig()` delegates to `executeSandboxed()` instead of the normal registry execution path. The sandboxed execution:

1. Converts `context.credentials` into Gondolin secret definitions via `buildSandboxSecrets()`
2. Calls `createHttpHooks()` to set up the MITM proxy with credential placeholder swap
3. Boots a fresh Alpine Linux VM (~3.5s)
4. Serializes the node input as JSON, writes it to `/tmp/input.json` inside the guest
5. Runs a generated shell script that processes the input (makes HTTP requests if a `url` field is present)
6. Reads `/tmp/output.json` from the guest and parses it as the node's output
7. Tears down the VM

Credentials never enter the VM. The guest sees placeholder env vars; the real values are substituted by the host-side MITM proxy only for requests to allowed hosts.

## Configuration

Add `sandbox` to `nodeConfig` in `WorkflowOptions`:

```typescript
const result = await runWorkflow(steps, startNode, registry, context, {
  nodeConfig: {
    "fetch-api": {
      sandbox: {
        allowedHosts: ["api.github.com"],
        timeoutMs: 30000,
        env: { CUSTOM_VAR: "value" },
        mounts: [{ host: "/data/assets", guest: "/assets" }],
      },
    },
  },
});
```

### SandboxConfig fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowedHosts` | `string[]` | (required) | Hosts the node can reach via HTTP(S) |
| `timeoutMs` | `number` | `60000` | VM execution timeout |
| `env` | `Record<string, string>` | `{}` | Extra env vars for the guest |
| `mounts` | `Array<{host, guest}>` | `[]` | Host dirs mounted read-only into the VM |

## Credential placeholder swap

When credentials are on `context.credentials`, `buildSandboxSecrets()` maps each string-valued credential field to a Gondolin `SecretDefinition`:

- Service `anthropic`, field `apiKey` becomes env var `ANTHROPIC_API_KEY`
- The real value is scoped to `allowedHosts` only
- The guest sees a random placeholder (e.g., `GONDOLIN_SECRET_<hex>`)
- The MITM proxy substitutes the real value in outgoing HTTP headers

This means even if the guest process is compromised, it cannot exfiltrate credentials; it only has meaningless placeholder strings.

## Limitations

- Only HTTP-integration nodes benefit from sandboxing (nodes that make external API calls)
- Nodes that depend on injected `NodeServices` (e.g., `context.services.anthropic`) cannot run sandboxed; the service object doesn't exist in the VM
- ~3.5s boot overhead per sandboxed execution (no VM pooling yet)
- Guest script uses `curl`; complex request patterns may need custom adapters

## Testing

```bash
# Unit tests (no VM required)
npx vitest run tests/core/sandbox-executor.test.ts

# Integration tests (requires QEMU + gondolin)
GONDOLIN_INTEGRATION=1 npx vitest run tests/integration/sandbox-*.test.ts
```
