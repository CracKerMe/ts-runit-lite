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
stored below `.ts-runit-data/` using one JSON file per record and atomic temp
file replacement:

```bash
STORAGE_TYPE=file
STORAGE_DIR=.ts-runit-data
```

The storage directory is organized by record type:

```text
.ts-runit-data/
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
provide clustering, multi-tenancy isolation, GraphQL, or a visual editor.

## Development scripts

```bash
pnpm build          # clean and compile TypeScript to dist/
pnpm test           # run Vitest
pnpm typecheck      # type-check source, tests, and examples
pnpm lint           # run oxlint checks
pnpm format:check   # verify formatting
```

## License

MIT
