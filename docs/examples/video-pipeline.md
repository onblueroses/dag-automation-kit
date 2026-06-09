# Example: video pipeline

`src/examples/video-pipeline.ts`

Turns a topic into a narrated slide video and uploads it to a channel you own.

```
write (script) -> deck (slides) -> tts -> compose -> publish
```

Every node is an illustrative stand-in so the example runs offline. The `channel` is
a config parameter; there are no hardcoded channel identifiers.

## Run it

```typescript
import { runVideoPipeline } from "dag-automation-kit/examples";

const result = await runVideoPipeline({ topic: "intro to typescript", channel: "my-channel" });
```

## Adapt it

- `tts` → `elevenlabsTtsNode`.
- `compose` → `ffmpegComposeNode`.
- `publish` → a YouTube upload node (uploads to the channel you own and authorize).
- `write` → an LLM provider behind the `llm` service for real narration.
