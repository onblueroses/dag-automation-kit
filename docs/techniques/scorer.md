# Technique: relevance scorer

Ranking a batch of items by how well they match a topic is a reusable filter step.
Two variants ship here:

- **Keyword overlap**: cheap and deterministic. The `source-monitor` and
  `community-responder` examples use it inline (count topic terms present in each item).
  Good for a first-pass filter with no API cost.
- **LLM scorer**: `socialAiAnalyzeNode` (`src/nodes/ai/analyze-posts.ts`) prompts a
  model to return a relevance score, sentiment, and a short reason per item. Use it
  when keyword overlap is too blunt.

```typescript
import { socialAiAnalyzeNode } from "dag-automation-kit";
registry.register(socialAiAnalyzeNode);
// input: { posts, topic, intent }  ->  output: scored items with relevance + reason
```

A common pattern is to chain them: keyword overlap to cut the obvious noise cheaply,
then the LLM scorer on what survives.
