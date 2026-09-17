# ts-workflow-engine-lite

一个用于嵌入式、单进程应用的轻量级 TypeScript 工作流引擎。它包含工作流执行、REST API、事件、Cron 调度、重试和本地文件持久化。本地使用无需依赖 Redis 或数据库。

项目介绍页：**[在线访问落地页](https://crackerme.github.io/ts-runit-lite/)**，可查看引擎的可视化总览
（DAG 执行动画、实例生命周期与示例集）；也支持离线使用：在浏览器中打开 [`index.html`](./index.html)。

## 安装

将该库添加到现有的 TypeScript 项目中：

```bash
pnpm add ts-workflow-engine-lite
```

需要 Node.js 18 或更高版本。

该包作为 ES 模块发布。在 JavaScript 或 TypeScript 中使用 ESM 导入：

```js
import { bootstrap, destroyContainer } from "ts-workflow-engine-lite";
```

TypeScript 使用者可以使用 `moduleResolution: "NodeNext"` 或 `"Bundler"`。此仓库在其 TypeScript 源码中保留了无扩展名的相对导入；构建步骤仅会将所需的 `.js` 扩展名添加到生成的 `dist` 文件中。

如果直接在此仓库中进行开发，请安装开发依赖并运行内置的快速入门示例：

```bash
pnpm install
pnpm example quickstart
```

## 5分钟 TypeScript 快速入门

该包的入口点是无副作用的。导入它不会启动服务器、注册进程处理程序或运行演示。

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

  console.log(instance.status); // completed (已完成)
  console.log(instance.state?.nodes?.greet?.output);
} finally {
  engine.destroy();
  await destroyContainer(container);
}
```

`waitForCompletion()` 会在实例状态变为 `completed`（已完成）、`failed`（失败）或 `cancelled`（已取消）时返回。它接受 `timeoutMs`（超时时间）、`pollIntervalMs`（轮询间隔）和一个 `AbortSignal`（中止信号）。

### 我应该使用哪个初始化 API？

该包提供了两种获取运行中 `WorkflowEngineV2` 的方式：

| API                                                                              | 适用场景                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrap(options)`                                                             | **默认选择。** 一次调用即可配置存储、密钥管理器、可选的线程池和归档功能以及优雅关闭，然后返回 `{ engine, container }`。与 CLI 和上述快速入门中的用法一致。                                                                                                                                                         |
| `createContainer(options)` + `setContainer(container)` + `createEngine(options)` | 当你需要更精细地控制初始化顺序（例如，在创建容器和引擎之间注册工作流或自定义 `SecretManager`），或者你需要针对自己管理的容器组合多个引擎时使用。`createEngine()` 会从 `setContainer()` 设置的全进程单例中读取其容器——请先调用 `createContainer` 和 `setContainer`，否则会抛出 `"Container not initialized"` 错误。 |

`bootstrap()` 内部也会调用 `setContainer(container)`，因此它返回的 `container` 与 `createEngine()` 读取的全进程单例是同一个——你仍然可以在之后再次调用 `createEngine()`（例如，创建共享该容器的第二个引擎），而无需自己调用 `setContainer`。

## 运行示例

```bash
pnpm example quickstart            # 最小化的嵌入式工作流
pnpm example order-processing      # 条件分支和多步骤订单工作流
pnpm example embedded-express-app  # 将 createWorkflowRouter 挂载到宿主的 Express 应用中
pnpm example error-handling        # 捕获 WorkflowNotFoundError / InstanceNotFoundError
pnpm dev                           # 事件驱动的内置演示
```

## 运行 REST API

```bash
pnpm dev:api
```

API 将在 `http://localhost:3345` 启动，并使用本地文件存储：

```bash
curl http://localhost:3345/workflow-api/v1/workflows
```

交互式 OpenAPI 文档位于：

```text
http://localhost:3345/api-docs
```

CLI 入口点会在需要时从 `.env.example` 创建 `.env` 文件。嵌入式的 `bootstrap()` API 会读取当前环境变量，但不会自动创建或加载 `.env` 文件。

### 挂载到现有的 Express 应用中

上述的 `startApiServer()` 会创建并启动其独立的 `express()` 应用——当此包需要作为独立的 HTTP 服务运行时使用它。如果要将工作流 API 作为路由挂载到宿主应用现有的 Express 应用中（共享其端口、body 解析器和认证中间件），请使用 `createWorkflowRouter()`：

```ts
import express from "express";
import { bootstrap, createWorkflowRouter } from "ts-workflow-engine-lite";

const { engine, container } = await bootstrap({ skipGracefulShutdown: true });

const app = express();
app.use(express.json());
// 如果需要，在此处应用你自己的认证/限流中间件。
app.use(
  "/workflow-api/v1",
  await createWorkflowRouter(engine, container.storage),
);

app.listen(3000);
```

该路由暴露了 `/workflows`、`/instances`、`/events`、`/webhooks`、`/dlq`、`/templates`、`/analytics`、`/functions`、`/health`，以及（除非传入 `{ enableMetrics: false }`）`/metrics`。它假定 `express.json()` 已经执行，并且**不包含** `startApiServer` 的独立服务相关配置——如 helmet/CORS、限流、JWT 认证、欢迎/文档页面或 WebSocket 控制台流。请在挂载此路由之前，在宿主应用实例上自行添加所需的功能。

## 配置

将 `WORKFLOW_ENGINE_LOG_LEVEL` 设置为 `DEBUG`、`INFO`、`WARN` 或 `ERROR`。嵌入式应用可以通过 `bootstrap({ logLevel: "WARN" })` 覆盖它，或者稍后使用 `Logger.setLevel()` 进行更改。

### 存储模式

| 模式     | 预期用途                 | 重启恢复 |
| -------- | ------------------------ | -------- |
| `file`   | 默认的单进程运行时       | 支持     |
| `memory` | 测试和有意为之的临时用途 | 不支持   |

在测试环境之外，默认启用本地文件持久化。运行时状态存储在 `.ts-workflow-engine-data/` 目录下，每条记录使用一个 JSON 文件，并通过原子化的临时文件替换来写入：

```bash
STORAGE_TYPE=file
STORAGE_DIR=.ts-workflow-engine-data
```

存储目录按记录类型组织：

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

每个集合还有一个 `corrupt/`（损坏）目录。如果在启动期间无法解析某条记录，它会被移动到该目录，以防止单个损坏的文件阻止引擎启动。请手动检查并恢复被隔离的文件；它们不会被自动加载。

### 重启恢复

基于 JSON/配置的工作流定义会自动恢复。包含 JavaScript 函数或闭包的工作流定义无法被序列化，因此应用代码必须在恢复未完成的实例之前重新注册这些定义：

```ts
const { engine } = await bootstrap({
  storageType: "file",
  resumeRunningInstances: false,
});

await engine.register(workflowWithFunctions);
await engine.resumeRunningInstancesFromStorage();
```

`RESUME_ON_STARTUP=true` 适用于 API 模式。在嵌入式使用时，如果必须先注册基于闭包的工作流，请将其保持禁用状态，或设置 `resumeRunningInstances: false`。否则，嵌入式应用可以通过设置 `resumeRunningInstances: true` 来选择启用恢复功能。

#### 重启/恢复检查清单

将恢复过程视为应用程序的启动协议：

1. 使用 `storageType: "file"` 并配置一个持久的、特定于实例的 `storageDirectory`；绝不要在多个引擎进程之间共享它。
2. 在调用 `resumeRunningInstancesFromStorage()` 之前，注册所有包含函数类型 `action` 或 `rollback` 处理程序的工作流。
3. 在备份或替换存储之前，请干净地停止引擎。文件持久化是重启安全的，但它不是数据库事务。
4. 使外部效应具备幂等性。崩溃可能发生在效应成功执行之后但其结果被持久化之前，因此请在下游的幂等键中包含实例和节点尝试的身份标识。
5. 使用重试处理瞬时错误，使用 `failureNext` 进行主动恢复，使用 `rollback` 进行效应补偿，并使用 DLQ（死信队列）处理耗尽重试或需要手动干预的情况。Rollback 是 Saga 风格的补偿，而不是原子撤销。
6. 启动后检查每个 `*/corrupt/` 目录；被隔离的记录不会自动恢复。

持久化的 `wait`（等待）节点会保留其原始截止时间：重启后，它们只会等待剩余的时间，如果时间已过则立即触发。这适用于“N天后最终执行”的场景，而不适用于必须在进程宕机期间触发的严格截止时间。对于后一种情况，请使用外部调度器来发布 `event`（事件）。

### 节点手册：语义和故障行为

完整的字段级参考、示例和常见错误请参阅 [`docs/NODE_REFERENCE.md`](./docs/NODE_REFERENCE.md)。核心执行模型如下：

| 节点族                                           | 成功                                 | 失败 / 恢复                                           |
| ------------------------------------------------ | ------------------------------------ | ----------------------------------------------------- |
| `action`, `http`, `sql`, `queue`, `notification` | 持久化输出，然后跟随 `next`          | 重试；然后执行 `failureNext`，否则实例失败 / 进入 DLQ |
| `condition`, `router`                            | 计算并跟随选定的分支                 | 无效的表达式或未匹配的路由会导致节点失败              |
| `transform`                                      | 从表达式构建输出对象                 | 表达式错误会导致节点失败；先前的输出保持不变          |
| `wait`, `event`, `approval`                      | 持久化等待状态并通过 `next` 恢复     | 超时/取消即为失败，除非显式处理                       |
| `loop`, `subworkflow`, `join`                    | 完成聚合/子任务并继续                | 循环体/子任务失败或缺失 join 分支会向上传播失败       |
| `rollback`                                       | 运行补偿并跟随 `rollbackTo` / `next` | 补偿可能会失败；它不是事务边界                        |

`next` 是后继 ID 的集合，可以扇出（fan out）。`failureNext` 是失败路径，不是隐式的回滚。运行时输出存放在 `state.nodes[id].output` 中；请勿自行定义 `output`。输入 Schema 在执行前进行检查，输出 Schema 在返回后进行检查。

### 表达式能力和边界

表达式是一个小型的计算器，而不是任意的 TypeScript/JavaScript。它们可以使用点表示法读取 `context` 和先前的输出，执行算术、比较和逻辑运算，并调用注册的内置函数来处理数学、字符串、集合和日期。自定义函数必须显式注册。表达式不能导入模块、执行 I/O、访问不受限制的全局变量，也不能作为业务代码的替代品。请将副作用保留在 `action` 或集成节点中，并保持表达式的确定性和轻量级。

使用 `${nodeId.output.field}` 和 `${context.tenantId}`。首选标识符安全的节点 ID：访问是基于点的，不支持任意的括号查找。完整的操作符/函数列表请参阅[表达式参考](./docs/NODE_REFERENCE.md#表达式语法速查)。

### 多租户使用模式

该引擎不提供数据库级别的租户隔离、授权或跨进程协调。`context` 中的租户 ID 仅仅是数据。请在 API/服务边界强制执行租户范围，从受信任的身份派生存储和队列命名空间，并在每次外部调用和幂等键中传递租户 ID：

```ts
const tenantId = authenticatedTenantId; // 绝不信任 request.body.tenantId
const instanceId = await engine.start("order", {
  tenantId,
  orderId,
  idempotencyKey: `${tenantId}:order:${orderId}`,
});
```

如果每个查询/信号都经过授权和过滤，一个引擎可以服务于多个租户。为了实现更强的故障隔离，请为每个租户或租户组运行一个引擎和存储目录。[`multi-tenant-workflow.ts`](./examples/multi-tenant-workflow.ts) 示例展示了 context 的约定，而非授权或存储隔离。

### 归档管理

默认情况下禁用终态实例归档，以便已完成的实例在正常的 TTL 清理之前仍可供查询。若要将终态实例归档为按日期分区的本地 JSON 并将其从热存储中驱逐，请开启此功能：

```bash
ARCHIVE_ENABLED=true
ARCHIVE_DIR=./archive
ARCHIVE_RETENTION_DAYS=90
ARCHIVE_CLEANUP_INTERVAL_MS=21600000
```

归档文件使用 `archive/YYYY-MM-DD/<instanceId>.json` 格式。只有在归档文件成功写入后，实例才会从热存储中移除。过期的日期分区将在启动时和配置的清理间隔按照 `ARCHIVE_RETENTION_DAYS` 进行删除。归档的实例是冷文件：正常的实例查询不会自动返回它们，也不会将它们恢复到热存储中。

等效的嵌入式选项为 `storageType`、`storageDirectory`、`enableArchiving`、`archiveDirectory` 和 `archiveRetentionDays`。

### 备份和恢复

请分别备份处于活动状态的 `STORAGE_DIR` 和启用归档时的 `ARCHIVE_DIR`。为了获得跨集合的一致性备份，请在复制目录前干净地停止引擎。通过在启动前将目录复制回配置的路径来进行恢复。请勿在引擎运行时编辑活动的 JSON 文件。

## 错误处理

针对最高频的查找/并发失败模式，引擎会抛出命名的错误类（从包根目录导出），因此调用者可以使用 `instanceof` 进行检查，而不是匹配 `Error.message` 字符串：

| 类                         | 抛出时机                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WorkflowNotFoundError`    | `engine.start()` / `engine.dryRun()` / 内部执行引用了未注册的 `workflowId`（可选特定 `version`）。包含 `.workflowId` 和 `.version`。             |
| `InstanceNotFoundError`    | `engine.signal()` / `engine.query()` / `engine.update()` / `waitForCompletion()` 引用了无法解析为已存储实例的 `instanceId`。包含 `.instanceId`。 |
| `ConcurrencyConflictError` | 乐观并发控制 (CAS) 在持久化实例更新时耗尽了其重试预算——另一个写入者一直在 `instance.version` 的竞争中获胜。包含 `.instanceId` 和 `.attempts`。   |
| `LockAcquisitionError`     | `ConcurrencyControl.withLock()` 无法在其重试预算内获取锁。包含 `.resourceId`。                                                                   |

其他失败（超时、无效的状态转换、最大实例数限制、通过 `DataValidationError` 进行的 Schema 验证）仍然会抛出普通的 `Error` 或其现有的错误类——请参阅 [`examples/error-handling.ts`](./examples/error-handling.ts) 以获取可运行的演示。

## 支持的工作流特性

- 节点类型：`action`、`wait`、`event`、`rollback`、`subworkflow`、`condition`、`router`、`loop`、`http`、`sql`、`queue`、`notification` 和 `approval`
- 事件总线、钩子、去重、Cron 调度、重试、心跳和死信队列处理
- 用于工作流、实例、信号、查询、更新、模板、Webhooks、事件、分析和死信队列的 REST API
- 包含内置和自定义函数的表达式计算

## 范围和局限性

此项目有意设计为单进程。本地文件存储可以在普通的进程重启期间保护状态，但它不是事务型数据库，并且同一个 `STORAGE_DIR` 绝不能被多个引擎进程共享。进程本地的租约、限流、幂等键、事件总线和 Cron 调度不提供分布式协调。该项目也不提供集群、数据库级别的多租户隔离、GraphQL 或可视化编辑器。多租户约定可以在应用边界实现；隔离是你的责任。

### 何时使用此引擎——以及何时切换

当工作流嵌入在单个 Node.js 服务中，本地文件持久化已足够，工作量适中，并且你需要一个带有 HTTP/事件集成、人工等待、重试和显式补偿路径的小型 TypeScript API 时，请选择此引擎。

当你需要分布式工作流平台时，请选择 [Temporal](https://temporal.io/)：众多 Worker 和服务、Worker 宕机时的持久计时器、更强的执行历史/重放保证、运营可见性以及跨主机的水平扩展。请接受其运营负担和 Temporal 的工作流/活动编程模型。

当 PostgreSQL 已经是事实上的记录系统，并且你希望队列、锁定和工作流状态共享同一个事务型数据库时，请选择支持 PostgreSQL 的引擎，例如 [pg-workflows](https://github.com/boazsegev/pg-workflows)。当多个进程必须通过 Postgres 进行协调时，它是更好的选择；当期望的部署边界是单个嵌入式服务和本地文件时，它的吸引力较小。

| 需求                                          | 最佳选择                  |
| --------------------------------------------- | ------------------------- |
| 嵌入式、单进程、低运营开销                    | `ts-workflow-engine-lite` |
| 分布式 Worker、长生命周期计时器、平台化工作流 | Temporal                  |
| Postgres 原生协调和事务状态                   | pg-workflows              |

关键的界限不在于“有多少种节点类型可用”，而在于你的工作流所需的持久性和协调模型。

## 开发脚本

```bash
pnpm build          # 清理并编译 TypeScript 到 dist/
pnpm test           # 运行 Vitest
pnpm typecheck      # 对源码、测试和示例进行类型检查
pnpm lint           # 运行 oxlint 检查
pnpm format:check   # 验证代码格式
```

## 可选的 API 层

REST API 是可选的。核心引擎的导入绝不会引入 `express`、`cors`、`helmet` 或任何 HTTP 框架。如果你只需要工作流引擎，请完全跳过这些依赖：

```bash
# 仅核心（无 REST API）
pnpm add ts-workflow-engine-lite
```

如果你需要 REST API，请安装对等依赖（peer dependencies）：

```bash
# 包含 REST API 的完整安装
pnpm add ts-workflow-engine-lite express cors helmet morgan ws swagger-ui-dist
```

与 API 相关的导出（`startApiServer`、`createWorkflowRouter`）在内部使用动态 `import()`，如果未安装 HTTP 相关的包，将会抛出明确的错误。

## 示例

| 示例                                                              | 脚本                                  | 描述                                |
| ----------------------------------------------------------------- | ------------------------------------- | ----------------------------------- |
| [quickstart.ts](./examples/quickstart.ts)                         | `pnpm example quickstart`             | 带有条件路由的最小化工作流          |
| [order-processing.ts](./examples/order-processing.ts)             | `pnpm example order-processing`       | 多步骤订单处理流水线                |
| [embedded-express-app.ts](./examples/embedded-express-app.ts)     | `pnpm example embedded-express-app`   | 将 API 嵌入到宿主 Express 应用中    |
| [error-handling.ts](./examples/error-handling.ts)                 | `pnpm example error-handling`         | 命名的错误类和重试处理              |
| [multi-tenant-workflow.ts](./examples/multi-tenant-workflow.ts)   | `pnpm example multi-tenant-workflow`  | 带有条件路由的租户隔离工作流        |
| [approval-pipeline.ts](./examples/approval-pipeline.ts)           | `pnpm example approval-pipeline`      | 带有超时的长时间运行审批            |
| [http-orchestration.ts](./examples/http-orchestration.ts)         | `pnpm example http-orchestration`     | 带有条件路由的 HTTP 集成            |
| [parallel-fan-out.ts](./examples/parallel-fan-out.ts)             | `pnpm example parallel-fan-out`       | 带有合并的并行处理                  |
| [graceful-degradation.ts](./examples/graceful-degradation.ts)     | `pnpm example graceful-degradation`   | 降级路径和死信队列                  |
| [headless-engine.ts](./examples/headless-engine.ts)               | `pnpm example headless-engine`        | 纯编程方式使用，无 API 服务器       |
| [worker-pool.ts](./examples/worker-pool.ts)                       | `pnpm example worker-pool`            | 使用 Worker 线程处理 CPU 密集型任务 |
| [cron-data-sync.ts](./examples/cron-data-sync.ts)                 | `pnpm example cron-data-sync`         | 计划内的数据同步                    |
| [demo-onboarding.ts](./examples/demo-onboarding.ts)               | `pnpm example demo-onboarding`        | 事件驱动的入职演示                  |
| [headless-no-express.ts](./examples/headless-no-express.ts)       | `pnpm example headless-no-express`    | 未安装 Express 时的无头引擎         |
| [data-processing.ts](./examples/data-processing.ts)               | `pnpm example data-processing`        | CSV 导入流水线，含清洗与校验        |
| [event-timeout-workflow.ts](./examples/event-timeout-workflow.ts) | `pnpm example event-timeout-workflow` | 事件等待、超时与回滚路径            |
| [instance-control-api.ts](./examples/instance-control-api.ts)     | `pnpm example instance-control-api`   | 重试 / 跳过 / 补偿的实例控制 API    |
| [output-injection.ts](./examples/output-injection.ts)             | `pnpm example output-injection`       | 通过 ${...} 引用上游节点输出        |

## 许可证

MIT
