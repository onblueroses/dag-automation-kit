# Contributing

This project is provided as-is, with no support or maintenance commitment. It is a starter
template: clone it, adapt it, and build your own workflows on top.

Pull requests are welcome but not guaranteed a review or a response. If you find it useful,
fork it and make it yours.

## Local development

```bash
npm install
npm run build
npm test
```

- TypeScript, ESM, NodeNext. Comments explain *why*, not *what*.
- New nodes follow the `defineNode()` pattern with Zod input/output schemas.
- Tests live under `tests/` and run with vitest.
