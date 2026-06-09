# Example: daily content publisher

`src/examples/daily-content-publisher.ts`

Picks a topic, generates a draft, scores its quality, and deploys only if the score
clears a threshold.

```
pick -> write -> grade -> deploy
```

The `write` step uses an injected `llm` service when present (else a deterministic
stub). `grade` is an illustrative heuristic; `deploy` is a stand-in. Swap it for
`gitOperationsNode` to commit and push to a real content repo.

## Run it

```typescript
import { runDailyContentPublisher } from "dag-automation-kit/examples";

const result = await runDailyContentPublisher(
  { topics: ["typescript-tips"], repoUrl: "https://example.com/content.git", qualityThreshold: 40 },
  { async generate(prompt) { /* call your model */ return "..."; } },
);
```

## Adapt it

- `write` → `openrouterGenerateNode` / `openai` / your provider SDK behind the `llm` service.
- `grade` → a real quality model or rubric scorer.
- `deploy` → `gitOperationsNode` (commit + push) or an HTTP deploy to your host.
- Gate on `grade.passed` to branch with the built-in `conditional` node if you want a
  separate "skip" path.
