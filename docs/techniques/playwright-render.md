# Technique: headless browser render

`src/nodes/integrations/playwright-render`

`playwrightScreenshotNode` drives a headless browser to render a page and capture a
screenshot (or rendered HTML). Use it for visual checks, rendering pages that need
JavaScript, capturing slides/cards, or scraping content that only exists after
client-side rendering.

```typescript
import { playwrightScreenshotNode } from "dag-automation-kit";

registry.register(playwrightScreenshotNode);
// step input: { url, ...options }  ->  output: a rendered artifact
```

Keep browser automation to things you are allowed to do: rendering your own pages,
testing, and reading public content. It is not a tool for automating logins or
posting as other identities.
