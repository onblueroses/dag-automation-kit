# Technique: contextual drafter

Drafting a response to some context, in a defined voice, is a reusable pattern. The
[community-responder example](../examples/community-responder.md) shows it as
`example_draft_reply`: it takes an item plus a single `voice` string and produces a
draft, using an injected `llm` service when present.

```typescript
const draft = llm
  ? await llm.generate(`Write a reply in this voice: "${voice}".\n\n${item.text}`)
  : `[${voice}] ...`; // offline fallback
```

The important design choices:

- **One voice parameter, not many personas.** A single declared tone keeps the output
  honest and consistent. Do not build a roster of fake identities.
- **Inject the model as a service.** The node stays testable offline and provider-agnostic;
  swap OpenRouter, Anthropic, or OpenAI without touching the node.
- **Draft, then let a human decide.** Pair the drafter with an `approval-gate` so a
  person reviews before anything is published.

For production, replace the stub with `openrouterGenerateNode` (or your provider's node)
and your own prompt template.
