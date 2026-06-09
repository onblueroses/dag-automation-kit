# Example: source monitor

`src/examples/source-monitor.ts`

Pulls items from public sources, ranks them for relevance to a set of topics, and
emits a markdown digest. No posting, no accounts; read-only.

```
fetch -> rank -> summarize
```

The `fetch` step is a stand-in that passes through supplied items; swap it for
`rssFetchNode` or `youtubeSearchNode`.

## Run it

```typescript
import { runSourceMonitor } from "dag-automation-kit/examples";

const result = await runSourceMonitor({
  topics: ["typescript release"],
  items: [{ id: "1", title: "TypeScript 6 release notes", url: "https://example.com/1" }],
});
// digest is in the "summarize" step output
```

## Adapt it

- `fetch` → `rssFetchNode` (feeds) and/or `youtubeSearchNode` (channels/queries), then
  merge with the `map`/`filter` transform nodes.
- `rank` → an LLM relevance scorer (`socialAiAnalyzeNode`) for nuance beyond keyword overlap.
- `summarize` → write the digest to a file (`fileWriteNode`) or post it to Discord
  (`discordSendWebhookNode`).
