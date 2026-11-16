# dag-automation-kit in detail

This page holds the longer explanation behind the [README](../README.md).

## Core concepts

- **Node**: the unit of work. Define one with `defineNode()`. Zod schemas validate its input and output.
- **Registry**: a catalog of nodes. `registry.execute()` validates input and output, then runs the executor.
- **ExecutionContext**: moves `{{step.field}}` variables between steps and holds injected services (your LLM
  client, your database, and so on). Inject services. Do not import them inside a node.
- **Workflow**: a map of `stepId -> { nodeType, input }`. Execution follows the `nextNode` that each step returns.

> **Naming tip:** give a step an id that is different from all field names in the output of that step. The
> engine merges output fields into the root context for convenience. Thus a step named `score` whose output has
> a `score` field shadows itself.

## Two runners

`runWorkflow(steps, start, registry, context)` is linear. Each step goes to the next step through the
`nextNode` that it returns. Approval gates work here.

`runDAGWorkflow(dag, registry, context)` takes explicit nodes and edges and runs parallel branches. It does not
support approval gates, so keep human-approval workflows linear.

## Approval gates (human-in-the-loop)

To pause a linear workflow, return `approvalRequired: true` from a node. The built-in `approval-gate` does
exactly that. `runWorkflow` then returns `{ success: true, pausedAt }`, and you continue later with
`resumeWorkflow()`. The `src/infra` layer adds a SQLite store and a small Hono server. The server sends a
reviewer an email with an approve or reject link. See the
[community-responder example](./examples/community-responder.md).

## Persistence

Give a `WorkflowStore` to the runner, and it saves the workflow on pause, on error and on completion. Then call
`resumeById()` to continue. `createMemoryStore()` is for tests. Use `SqliteWorkflowStore` in production.

## Configuration

Copy `.env.example` to `.env` for the approval server. Node credentials (API keys) go in through
`createExecutionContext(services, vars, credentials)`. The nodes never read them from the environment.
