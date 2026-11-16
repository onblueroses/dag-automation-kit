# dag-automation-kit

dag-automation-kit is a typed, Zod-validated DAG workflow engine for TypeScript. It is a starter template: clone
it, read the examples, replace the nodes with your own, and build from there.

## What you get

- A small core engine with typed nodes, context interpolation and branching.
- Two runners. `runWorkflow` is linear and supports approval gates. `runDAGWorkflow` runs parallel branches but
  does not support approval gates.
- A library of integration nodes: HTTP, SQLite, OpenRouter, OpenAI, FFmpeg, ElevenLabs, RSS, YouTube, Discord,
  Firecrawl, Tavily, Google Sheets, Git, SSH, Unsplash, dev.to, WordPress, and read-only social monitors.
- Optional persistence, and an approval-gate HTTP server for human-in-the-loop workflows.
- Four worked examples that run offline.

## Example

```typescript
import { createExecutionContext, createRegistry, defineNode, endNode, runWorkflow } from "dag-automation-kit";
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

Core concepts, the two runners, approval gates, persistence and configuration:
[dag-automation-kit in detail](./docs/details.md). Sandboxed node execution: [docs/sandbox.md](./docs/sandbox.md).

## Examples

| Example | What it shows |
|---------|---------------|
| [community-responder](./docs/examples/community-responder.md) | monitor, score, draft, then human approval (no autoposting) |
| [daily-content-publisher](./docs/examples/daily-content-publisher.md) | pick a topic, generate, quality-gate, deploy |
| [video-pipeline](./docs/examples/video-pipeline.md) | script, slides, TTS, compose, upload |
| [source-monitor](./docs/examples/source-monitor.md) | fetch public sources, rank, digest |

Reusable techniques are in [docs/techniques](./docs/techniques).

## Install and run

Clone the template and build on it:

```bash
git clone <your-fork-url> my-workflows
cd my-workflows
npm install
npm run build
npm test
```

For the approval server, copy `.env.example` to `.env`.

## Layout

```text
src/core/       engine: registry, context, runners, stores
src/nodes/      logic, transform, AI and integration nodes
src/infra/      SQLite store, approval server, email notifier
src/examples/   the four worked examples
tests/          tests
docs/           details, examples and techniques
```

## Contributing and license

The project is provided as-is. Read [CONTRIBUTING](./CONTRIBUTING.md). The license is MIT, see [LICENSE](./LICENSE).
