# Example: community responder

`src/examples/community-responder.ts`

Watches a source, scores items for relevance to a topic, drafts a reply in a
configured voice, then **pauses for a human to approve before anything is sent**.

```
monitor_source -> relevance_score -> draft_reply -> approval-gate (pause)
```

**Nothing is posted automatically.** The workflow halts at the approval gate and
returns `{ success: true, pausedAt: "review" }`. A human approves or rejects each
draft; only then does `resumeWorkflow()` continue. There is no posting node, no
account handling, no proxy, and no multi-persona system; a single `voice` string
controls tone.

This is the only execution model where approval gates work: keep it a **linear**
`runWorkflow`, not a DAG (the DAG runner rejects approval gates).

## Run it

```typescript
import { runCommunityResponder } from "dag-automation-kit/examples";

const result = await runCommunityResponder({
  topic: "release notes",
  voice: "concise, friendly maintainer",
  items: [{ id: "1", text: "when do the release notes drop?", url: "https://example.com/1" }],
});
// result.pausedAt === "review"
```

## Adapt it

- `monitor_source` → swap for `redditMonitorNode`, `rssFetchNode`, or `twitterMonitorNode`.
- `relevance_score` → swap for `socialAiAnalyzeNode` or your own LLM scorer.
- `draft_reply` → swap for `openrouterGenerateNode` with your prompt. Pass an `llm`
  service via `createExecutionContext` to use a real model.
- Wire `SqliteWorkflowStore` + the approval server (`src/infra`) to email a reviewer.
