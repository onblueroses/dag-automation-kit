# dag-automation-kit (archived)

This repo merged into [pipewright](https://github.com/onblueroses/pipewright) on 2026-11-16. Use pipewright.

- DAG runner, graph checks, store, `resumeById`, structured errors: pipewright `src/core/`.
- Integration and AI nodes: the `pipewright/nodes` entry. Node types are now kebab-case, for example `http-request`.
- SQLite store, approval server, e-mail notifier: the `pipewright/infra` entry.
- Examples (community-responder, daily-content-publisher, source-monitor, video-pipeline): pipewright `examples/`.
- Dropped: the Gondolin sandbox, the `parallel`, `retry` and `rate_limiter` nodes. See pipewright `docs/details.md`.
- The history of this repo stays here. pipewright holds a plain port of the code.
