# ts-workflow-engine-lite

A lightweight TypeScript workflow engine for embedded, single-process
applications. It includes workflow execution, a REST API, events, Cron
scheduling, retries, and local file persistence. Redis and databases are not
required for local use.

## Install

Add the library to an existing TypeScript project:

```bash
pnpm add ts-workflow-engine-lite
```

Node.js 18 or newer is required.

The package is published as an ES module. Use ESM imports from JavaScript or
TypeScript:

```js
import { bootstrap, destroyContainer } from "ts-workflow-engine-lite";
```

TypeScript consumers can use either `moduleResolution: "NodeNext"` or
`"Bundler"`. This repository keeps extensionless relative imports in its
TypeScript source; the build step adds the required `.js` extensions only to
the generated `dist` files.

When working from this repository instead, install the development dependencies
and run the checked-in quick start:

```bash
pnpm install
pnpm example:quickstart
```

## 5-minute TypeScript quick start

The package entry point is side-effect free. Importing it does not start a
server, register process handlers, or run a demo.

```ts
import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "ts-workflow-engine-lite";

const workflow: WorkflowDefinition = {
  id: "hello",
  name: "Hello workflow",
  startNode: "greet",
  nodes: {
    greet: {
      id: "greet",
      type: "action",
      action: async (instance) => ({
        message: `Hello, ${instance?.context?.name ?? "world"}!`,
      }),
      next: [],
    },
  },
};

const { engine, container } = await bootstrap({
  skipGracefulShutdown: true,
  logLevel: "WARN",
});

try {
  await engine.register(workflow);
  const instanceId = await engine.start("hello", { name: "Ada" });
  const instance = await engine.waitForCompletion(instanceId);

  console.log(instance.status); // completed
  console.log(instance.state?.nodes?.greet?.output);
} finally {
  engine.destroy();
  await destroyContainer(container);
}
```

`waitForCompletion()` returns when an instance is `completed`, `failed`, or
`cancelled`. It accepts `timeoutMs`, `pollIntervalMs`, and an `AbortSignal`.

### Which initialization API should I use?

The package exposes two ways to get a running `WorkflowEngineV2`:

| API                                                                              | Use when                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap(options)`                                                             | **Default choice.** One call wires storage, secret manager, optional worker pool and archiving, and graceful shutdown, then returns `{ engine, container }`. Matches what the CLI and the quick start above use.                                                                                                                                                                                                          |
| `createContainer(options)` + `setContainer(container)` + `createEngine(options)` | You need finer control over initialization order (e.g. registering workflows or a custom `SecretManager` between container and engine creation), or you're composing multiple engines against containers you manage yourself. `createEngine()` reads its container from the process-wide singleton set by `setContainer()` — call `createContainer` and `setContainer` first, or it throws `"Container not initialized"`. |

`bootstrap()` also calls `setContainer(container)` internally, so its
returned `container` is the same process-wide singleton `createEngine()`
reads from — you can still call `createEngine()` again afterwards (e.g. to
create a second engine sharing that container) without calling
`setContainer` yourself.

## Run the examples

```bash
pnpm example:quickstart        # minimal embedded workflow
pnpm example:order             # condition branch and multi-step order workflow
pnpm example:embedded-express  # mounting createWorkflowRouter into a host Express app
pnpm example:error-handling    # catching WorkflowNotFoundError / InstanceNotFoundError
pnpm dev                       # event-driven built-in demo
```

## Run the REST API

```bash
pnpm dev:api
```

The API starts on `http://localhost:3345` with local file storage:

```bash
curl http://localhost:3345/workflow-api/v1/workflows
```

Interactive OpenAPI documentation is available at:

```text
http://localhost:3345/api-docs
```

The CLI entry point creates `.env` from `.env.example` when needed. The
embedded `bootstrap()` API reads the current environment but does not create or
load an `.env` file automatically.

### Mounting into an existing Express app

`startApiServer()` above creates and starts its own standalone `express()`
app — use it when this package should run as its own HTTP service. To
instead mount the workflow API as a router inside a host application's
existing Express app (sharing its port, body parser, and auth middleware),
use `createWorkflowRouter()`:

```ts
import express from "express";
import { bootstrap, createWorkflowRouter } from "ts-workflow-engine-lite";

const { engine, container } = await bootstrap({ skipGracefulShutdown: true });

const app = express();
app.use(express.json());
// Apply your own auth/rate-limit middleware here if needed.
app.use(
  "/workflow-api/v1",
  await createWorkflowRouter(engine, container.storage),
);

app.listen(3000);
```

The router exposes `/workflows`, `/instances`, `/events`, `/webhooks`,
`/dlq`, `/templates`, `/analytics`, `/functions`, `/health`, and (unless
`{ enableMetrics: false }` is passed) `/metrics`. It expects
`express.json()` to already have run, and does **not** include
`startApiServer`'s standalone-service concerns — helmet/CORS, rate
limiting, JWT auth, the welcome/docs pages, or the WebSocket console
stream. Add whatever of those the host app needs on its own app instance
before mounting this router.

## Configuration

Set `WORKFLOW_ENGINE_LOG_LEVEL` to `DEBUG`, `INFO`, `WARN`, or `ERROR`.
Embedded applications can override it with `bootstrap({ logLevel: "WARN" })`
or change it later with `Logger.setLevel()`.

### Storage modes

| Mode     | Intended use                          | Restart recovery |
| -------- | ------------------------------------- | ---------------- |
| `file`   | Default single-process runtime        | Yes              |
| `memory` | Tests and intentionally ephemeral use | No               |

Local file persistence is enabled by default outside tests. Runtime state is
stored below `.ts-workflow-engine-data/` using one JSON file per record and atomic temp
file replacement:

```bash
STORAGE_TYPE=file
STORAGE_DIR=.ts-workflow-engine-data
```

The storage directory is organized by record type:

```text
.ts-workflow-engine-data/
├── instances/
├── workflows/
├── workflow-metadata/
├── workflow-versions/
├── waiting/
├── metrics/
├── events/
├── heartbeats/
└── dlq/
```

Each collection also has a `corrupt/` directory. A record that cannot be parsed
during startup is moved there so one damaged file does not prevent the engine
from starting. Inspect and recover quarantined files manually; they are not
loaded automatically.

### Restart recovery

JSON/config-based workflow definitions are restored automatically. Workflow
definitions containing JavaScript functions or closures cannot be serialized,
so application code must register those definitions again before resuming
unfinished instances:

```ts
const { engine } = await bootstrap({
  storageType: "file",
  resumeRunningInstances: false,
});

await engine.register(workflowWithFunctions);
await engine.resumeRunningInstancesFromStorage();
```

`RESUME_ON_STARTUP=true` applies to API mode. Leave it disabled, or set
`resumeRunningInstances: false` in embedded use, when closure-based workflows
must be registered first. Embedded applications otherwise opt into recovery
with `resumeRunningInstances: true`.

#### Restart/recovery checklist

Treat recovery as an application startup protocol:

1. Use `storageType: "file"` with a durable, instance-specific
   `storageDirectory`; never share it between engine processes.
2. Register every workflow containing function-valued `action` or `rollback`
   handlers before `resumeRunningInstancesFromStorage()`.
3. Stop cleanly before backing up or replacing storage. File persistence is
   restart-safe, but it is not a database transaction.
4. Make external effects idempotent. A crash can happen after an effect
   succeeds but before its result is persisted, so include instance and node
   attempt identity in downstream idempotency keys.
5. Use retries for transient errors, `failureNext` for deliberate recovery,
   `rollback` for compensating effects, and the DLQ for exhausted/manual cases.
   Rollback is Saga-style compensation, not an atomic undo.
6. Inspect each `*/corrupt/` directory after startup; quarantined records are
   not restored automatically.

Durable `wait` nodes persist their original deadline: after a restart they
wait only for the remaining time, and fire immediately if it has passed. This
fits “eventually after N days”, not a deadline that must fire while the process
is down. For that case, use an external scheduler to publish an `event`.

### Node handbook: semantics and failure behavior

The complete field-by-field reference, examples, and common mistakes are in
[`docs/NODE_REFERENCE.md`](./docs/NODE_REFERENCE.md). The core execution model
is:

| Node family | Success | Failure / recovery |
| --- | --- | --- |
| `action`, `http`, `sql`, `queue`, `notification` | Persist output, then follow `next` | Retry; then `failureNext`, otherwise instance failure / DLQ |
| `condition`, `router` | Evaluate and follow the selected branch | Invalid expression or unmatched route fails the node |
| `transform` | Build an output object from expressions | Expression errors fail the node; prior outputs are unchanged |
| `wait`, `event`, `approval` | Persist waiting state and resume via `next` | Timeout/cancellation is failure unless explicitly handled |
| `loop`, `subworkflow`, `join` | Complete aggregate/child work and continue | Body/child failure or missing join branch propagates |
| `rollback` | Run compensation and follow `rollbackTo` / `next` | Compensation can fail; it is not a transaction boundary |

`next` is a batch of successor IDs and may fan out. `failureNext` is a failure
path, not an implicit rollback. Runtime outputs live in
`state.nodes[id].output`; do not define `output` yourself. Input schemas are
checked before execution and output schemas after it returns.

### Expression capability and boundary

Expressions are a small evaluator, not arbitrary TypeScript/JavaScript. They
can read `context` and prior outputs with dot notation, perform arithmetic,
comparison, and logical operations, and call registered built-ins for math,
strings, collections, and dates. Custom functions must be registered
explicitly. Expressions cannot import modules, perform I/O, access unrestricted
globals, or serve as a replacement for business code. Keep side effects in
`action` or integration nodes, and expressions deterministic and cheap.

Use `${nodeId.output.field}` and `${context.tenantId}`. Prefer identifier-safe
node IDs: access is dot-based and does not support arbitrary bracket lookup.
See the [expression reference](./docs/NODE_REFERENCE.md#表达式语法速查) for the
full operator/function list.

### Multi-tenant usage pattern

The engine does not provide database-level tenant isolation, authorization, or
cross-process coordination. A tenant ID in `context` is only data. Enforce
tenant scope at the API/service boundary, derive storage and queue namespaces
from a trusted identity, and pass the tenant ID through every external call
and idempotency key:

```ts
const tenantId = authenticatedTenantId; // never trust request.body.tenantId
const instanceId = await engine.start("order", {
  tenantId,
  orderId,
  idempotencyKey: `${tenantId}:order:${orderId}`,
});
```

One engine can serve many tenants if every query/signal is authorized and
filtered. For stronger blast-radius isolation, run one engine and storage
directory per tenant or tenant group. The
[`multi-tenant-workflow.ts`](./examples/multi-tenant-workflow.ts) example shows
the context convention, not authorization or storage isolation.

### Archive management

Terminal-instance archiving is disabled by default so completed instances stay
available to queries until normal TTL cleanup. To archive terminal instances
as date-partitioned local JSON and evict them from hot storage, opt in:

```bash
ARCHIVE_ENABLED=true
ARCHIVE_DIR=./archive
ARCHIVE_RETENTION_DAYS=90
ARCHIVE_CLEANUP_INTERVAL_MS=21600000
```

Archive files use `archive/YYYY-MM-DD/<instanceId>.json`. An instance is removed
from hot storage only after its archive file has been written successfully.
Expired date partitions are deleted according to `ARCHIVE_RETENTION_DAYS` on
startup and at the configured cleanup interval. Archived instances are cold
files: they are not automatically returned by normal instance queries or
restored into hot storage.

The equivalent embedded options are `storageType`, `storageDirectory`,
`enableArchiving`, `archiveDirectory`, and `archiveRetentionDays`.

### Backup and restore

Back up `STORAGE_DIR` for active state and `ARCHIVE_DIR` separately when
archiving is enabled. For a consistent backup across collections, stop the
engine cleanly before copying the directories. Restore by copying them back to
the configured paths before startup. Do not edit active JSON files while the
engine is running.

## Error handling

The engine throws named error classes (exported from the package root) for
the highest-frequency lookup/concurrency failure modes, so callers can
`instanceof`-check them instead of matching `Error.message` strings:

| Class                      | Thrown when                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowNotFoundError`    | `engine.start()` / `engine.dryRun()` / internal execution reference a `workflowId` (optionally a specific `version`) that isn't registered. Has `.workflowId` and `.version`.                 |
| `InstanceNotFoundError`    | `engine.signal()` / `engine.query()` / `engine.update()` / `waitForCompletion()` reference an `instanceId` that doesn't resolve to a stored instance. Has `.instanceId`.                      |
| `ConcurrencyConflictError` | Optimistic concurrency control (CAS) exhausts its retry budget persisting an instance update — another writer kept winning the race on `instance.version`. Has `.instanceId` and `.attempts`. |
| `LockAcquisitionError`     | `ConcurrencyControl.withLock()` fails to acquire a lock within its retry budget. Has `.resourceId`.                                                                                           |

Other failures (timeouts, invalid state transitions, the max-instances
limit, schema validation via `DataValidationError`) still throw plain
`Error` or their own existing error class — see
[`examples/error-handling.ts`](./examples/error-handling.ts) for a runnable
demonstration.

## Supported workflow features

- Node types: `action`, `wait`, `event`, `rollback`, `subworkflow`, `condition`,
  `router`, `loop`, `http`, `sql`, `queue`, `notification`, and `approval`
- Event bus, hooks, deduplication, Cron scheduling, retries, heartbeats, and
  dead-letter queue handling
- REST API for workflows, instances, signals, queries, updates, templates,
  webhooks, events, analytics, and the dead-letter queue
- Expression evaluation with built-in and custom functions

## Scope and limitations

This project is intentionally single-process. Local file storage protects state
across ordinary process restarts, but it is not a transactional database and
the same `STORAGE_DIR` must never be shared by multiple engine processes.
Process-local leases, rate limits, idempotency keys, the event bus, and Cron
scheduling do not provide distributed coordination. The project also does not
provide clustering, database-level multi-tenancy isolation, GraphQL, or a
visual editor. Multi-tenant conventions are possible at the application
boundary; isolation is your responsibility.

### When to use this engine—and when to switch

Choose this engine when the workflow is embedded in one Node.js service, local
file persistence is sufficient, the workload is modest, and you want a small
TypeScript API with HTTP/event integrations, human waits, retries, and explicit
compensation paths.

Choose [Temporal](https://temporal.io/) when you need a distributed workflow
platform: many workers and services, durable timers while workers are down,
stronger execution history/replay guarantees, operational visibility, and
horizontal scaling across hosts. Accept the operational footprint and
Temporal's workflow/activity programming model.

Choose a PostgreSQL-backed engine such as
[pg-workflows](https://github.com/boazsegev/pg-workflows) when PostgreSQL is
already the system of record and you want queueing, locking, and workflow state
to share one transactional database. It is a better fit when multiple
processes must coordinate through Postgres; it is less attractive when a
single embedded service and local files are the desired deployment boundary.

| Requirement | Best fit |
| --- | --- |
| Embedded, single-process, low operational overhead | `ts-workflow-engine-lite` |
| Distributed workers, long-lived timers, workflow-as-a-platform | Temporal |
| Postgres-native coordination and transactional state | pg-workflows |

The key boundary is not “how many node types are available”; it is the
durability and coordination model your workflow requires.

## Development scripts

```bash
pnpm build          # clean and compile TypeScript to dist/
pnpm test           # run Vitest
pnpm typecheck      # type-check source, tests, and examples
pnpm lint           # run oxlint checks
pnpm format:check   # verify formatting
```

## Optional API layer

The REST API is optional. Core engine imports never pull in `express`, `cors`,
`helmet`, or any HTTP framework. If you only need the workflow engine, skip
those dependencies entirely:

```bash
# Core only (no REST API)
pnpm add ts-workflow-engine-lite
```

If you need the REST API, install the peer dependencies:

```bash
# Full install with REST API
pnpm add ts-workflow-engine-lite express cors helmet morgan ws swagger-ui-dist
```

API-related exports (`startApiServer`, `createWorkflowRouter`) use dynamic
`import()` internally and will throw a clear error if the HTTP packages
are not installed.

## Examples

| Example                                                         | Script                          | Description                                      |
| --------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| [quickstart.ts](./examples/quickstart.ts)                       | `pnpm example:quickstart`       | Minimal workflow with condition routing          |
| [order-processing.ts](./examples/order-processing.ts)           | `pnpm example:order`            | Multi-step order processing pipeline             |
| [embedded-express-app.ts](./examples/embedded-express-app.ts)   | `pnpm example:embedded-express` | Embed API in a host Express app                  |
| [error-handling.ts](./examples/error-handling.ts)               | `pnpm example:error-handling`   | Named error classes and retry handling           |
| [multi-tenant-workflow.ts](./examples/multi-tenant-workflow.ts) | `pnpm example:multi-tenant`     | Tenant-isolated workflows with condition routing |
| [approval-pipeline.ts](./examples/approval-pipeline.ts)         | `pnpm example:approval`         | Long-running approval with timeout               |
| [http-orchestration.ts](./examples/http-orchestration.ts)       | `pnpm example:http`             | HTTP integration with conditional routing        |
| [parallel-fan-out.ts](./examples/parallel-fan-out.ts)           | `pnpm example:parallel`         | Parallel processing with merge                   |
| [graceful-degradation.ts](./examples/graceful-degradation.ts)   | `pnpm example:degradation`      | Fallback paths and dead letter queues            |
| [headless-engine.ts](./examples/headless-engine.ts)             | `pnpm example:headless`         | Pure programmatic usage, no API server           |
| [worker-pool.ts](./examples/worker-pool.ts)                     | `pnpm example:worker-pool`      | CPU-intensive tasks with worker threads          |
| [cron-data-sync.ts](./examples/cron-data-sync.ts)               | `pnpm example:cron-sync`        | Scheduled data synchronization                   |

## License

MIT
