# dag-automation-kit

A typed, Zod-validated DAG workflow engine for TypeScript. Compose small nodes into workflows with context interpolation, branching, parallel execution, optional persistence, and human-in-the-loop approval gates.

It's a starter template: clone it, read the examples, swap in your own nodes, and build from there. Provided as-is; see [CONTRIBUTING](./CONTRIBUTING.md).

## What you get

- A small core engine (`runWorkflow` / `runDAGWorkflow`) with typed nodes.
- A library of integration nodes: HTTP, SQLite, OpenRouter, OpenAI, Playwright render, FFmpeg, ElevenLabs, RSS, YouTube, Discord, Firecrawl, Tavily, Google Sheets, Git, SSH, Unsplash, dev.to, WordPress, and read-only social monitors.
- Persistence plus an approval-gate HTTP server for human-in-the-loop workflows.
- Four worked [examples](./docs/examples) that run offline and adapt cleanly.

## Install

It's a template; clone it and build on top:

```bash
git clone <your-fork-url> my-workflows
cd my-workflows
npm install
npm run build
npm test
```

## Core concepts

- **Node**: the unit of work. Define one with `defineNode()`; Zod schemas validate its input and output.
- **Registry**: catalogs nodes. `registry.execute()` validates input and output, then runs the executor.
- **ExecutionContext**: threads `{{step.field}}` variables between steps and holds injected services (your LLM client, DB, and so on). Inject services; never import them inside a node.
- **Workflow**: a map of `stepId -> { nodeType, input }`. Execution follows the `nextNode` each step returns.

## Quick example

```typescript
import {
  createExecutionContext,
  createRegistry,
  defineNode,
  endNode,
  runWorkflow,
} from "dag-automation-kit";
import { z } from "zod";

const greetNode = defineNode({
  type: "greet",
  name: "Greet",
  category: "action",
  inputSchema: z.object({ name: z.string(), nextNode: z.string() }),
  outputSchema: z.object({ greeting: z.string() }),
  executor: async (input) => ({
    success: true,
    output: { greeting: `Hello, ${input.name}!` },
    nextNode: input.nextNode,
  }),
});

const registry = createRegistry();
registry.register(greetNode);
registry.register(endNode);

const result = await runWorkflow(
  {
    greet: { nodeType: "greet", input: { name: "world", nextNode: "done" } },
    done: { nodeType: "end", input: { message: "{{greet.greeting}}" } },
  },
  "greet",
  registry,
  createExecutionContext(),
);

console.log(result.success, result.steps.length);
```

> **Naming tip:** give a step an id that differs from any field name in that step's output. Output fields are merged into the root context for convenience, so a step named `score` whose output has a `score` field shadows itself.

## Two runners

`runWorkflow(steps, start, registry, context)` is linear: each step routes to the next through the `nextNode` it returns. Approval gates work here.

`runDAGWorkflow(dag, registry, context)` takes explicit nodes and edges and runs parallel branches. It does not support approval gates, so keep human-approval workflows linear.

## Approval gates (human-in-the-loop)

Return `approvalRequired: true` from a node to pause a linear workflow; the built-in `approval-gate` does exactly that. `runWorkflow` then returns `{ success: true, pausedAt }`, and you resume later with `resumeWorkflow()`. The `src/infra` layer adds a SQLite store and a small Hono server that emails a reviewer an approve/reject link. See the [community-responder example](./docs/examples/community-responder.md).

## Persistence

Pass a `WorkflowStore` to auto-save on pause, error, and completion, then call `resumeById()` to continue. `createMemoryStore()` is provided for tests; use `SqliteWorkflowStore` in production.

## Examples

| Example | What it shows |
|---------|---------------|
| [community-responder](./docs/examples/community-responder.md) | monitor, score, draft, then human approval (no autoposting) |
| [daily-content-publisher](./docs/examples/daily-content-publisher.md) | pick a topic, generate, quality-gate, deploy |
| [video-pipeline](./docs/examples/video-pipeline.md) | script, slides, TTS, compose, upload |
| [source-monitor](./docs/examples/source-monitor.md) | fetch public sources, rank, digest |

Reusable techniques are written up in [docs/techniques](./docs/techniques).

## Configuration

Copy `.env.example` to `.env` for the approval server. Node credentials (API keys) are injected through `createExecutionContext(services, vars, credentials)`; the nodes never read them from the environment.

## License

MIT; see [LICENSE](./LICENSE).
