# Changelog

All notable changes to ts-workflow-engine-lite will be documented in this file.

## [Unreleased]

No unreleased changes.

## [3.0.3] - 2026-09-17

### Breaking Changes

- **内部 Manager 类按职责重命名为 `*Policy`（决策/策略类）或 `*Tracker`（状态跟踪类）**，其余名副其实的 `*Manager`（CRUD/生命周期编排类）保持不变：
  - `CanaryReleaseManager` → `CanaryReleasePolicy`（灰度发布晋升/回滚的决策逻辑）—— **内部类，未从包根导出，无公开 API 影响**
  - `ContinueAsNewManager` → `ContinueAsNewTracker`（跟踪待处理的续期状态）—— **内部类，无公开 API 影响**
  - `SearchAttributeManager` → `SearchAttributeTracker`（跟踪可查询的实例索引状态）—— **内部类，无公开 API 影响**
  - `HeartbeatManager` → `HeartbeatTracker`（跟踪心跳状态与截止时间）—— **内部类，无公开 API 影响**
  - `StickyExecutionManager` → `StickyExecutionPolicy`（决策实例应路由到哪个 Worker）—— **从包根导出**，旧名称 `StickyExecutionManager` / `stickyExecutionManager` 保留为 `@deprecated` 别名
  - `BreakpointManager` → `BreakpointTracker`（跟踪断点命中状态）—— 仅在 `src/debug` 内部导出（未从包根导出），无 `@deprecated` 别名，直接改用新名称
  - `NotificationManager`、`WebhookManager`、`InstanceManager`、`LifecycleManager`、`TaskQueueManager`、`WorkflowVersionManager`、`HookManager`、`ArchiveManager`、`ConsoleWebSocketManager`、`SecretManager` **未重命名**：这些类的主要职责是 CRUD/生命周期编排或注册表，"Manager" 是准确的命名，重命名只会制造churn而无实质收益。
- **删除已废弃的初始化 API 别名**：
  - `createEngineV2` **已删除**（此前标记 `@deprecated`，本版本正式移除）。改用 `createEngine`。
  - `startServer` **已删除**（`src/index.ts`/`src/api/index.ts`/`src/api/server.ts` 三处别名一并移除）。改用 `startApiServer`。
  - `createContainer` / `setContainer` / `getContainer` **不再从包根导出**（`src/index.ts`）。这三个函数仍存在于 `src/container.ts` 并被 `bootstrap()` 内部使用，但不再是公开 API——进程容器只能通过 `bootstrap()` 创建。`AppContainer` 类型与 `destroyContainer` 函数继续导出，因为 `bootstrap()` 返回的容器仍需要一种公开的方式来清理。

### Deprecations

以下导出仍可用，仅标注 `@deprecated`，保留给依赖旧名称的宿主应用：

- `StickyExecutionManager` / `stickyExecutionManager` → 改用 `StickyExecutionPolicy` / `stickyExecutionPolicy`

### New Features

- **存储中间件**：新增 `withStorageMetrics(storage, onTiming)` 与 `withStorageCache(storage, options)`，均从包根与 `src/storage/index.ts` 导出。两者都基于 `Proxy` 透明包装任意 `StorageProvider` 实现，不需要为 40+ 方法的接口手写委托：
  - `withStorageMetrics`：记录每次方法调用的耗时，通过回调上报，不改变返回值或异常行为。
  - `withStorageCache`：为 `loadInstance`/`loadWorkflow`（可配置）加一层短期内存读缓存，命中写方法时整体失效。仅适用于单进程部署；多进程共享同一存储后端时不安全（没有跨进程失效信号）。

### Internal

- **`LocalFileStorage` 由继承改为组合**：`class LocalFileStorage extends MemoryStorage` 改为 `class LocalFileStorage implements StorageProvider`，内部持有私有的 `MemoryStorage` 实例作为查询层，不再是它的子类。**`LocalFileStorage` 的公开方法表面（`StorageProvider` 接口）完全不变，不是破坏性变更**——外部消费方无需改动任何调用代码。
  - `MemoryStorage` 新增了一批具体类方法（`saveInstanceAndPeek`/`casUpdateInstanceAndPeek`/`saveHeartbeatAndPeek`/`saveInstanceMetricsAndPeek`/`updateNodeMetricsAndPeek`/`getInstanceRef`/`getHeartbeatRef`/`peekInstanceMetricsForOwner`/`cleanupStaleEventsWithIds`/`cleanupExpiredHeartbeatsWithIds`/`cleanupStaleInstancesWithIds`），供 `LocalFileStorage` 通过持有的具体 `MemoryStorage` 类型引用调用，替代此前依赖的 `protected` 成员（`peekInstance`/`peekInstanceMetrics`/`peekHeartbeat`/`lastCleaned*Ids`）。这些方法**不在** `StorageProvider` 接口上，纯属 `MemoryStorage` 具体类新增的公开方法，属于签名放宽而非收窄，通常不会破坏现有 TypeScript 消费方；`StorageProvider.ts` 与 `src/storage/database-adapters.ts` 均未改动。
  - 二级索引一致性、`updateNodeMetrics` 的"替换而非就地修改"语义、启动时全量恢复进内存（运行期读取从不落盘）等既有行为均未改变。
  - 回归验证：`pnpm test`（148 个测试文件、1539 个用例）、`pnpm typecheck`、`pnpm lint` 全部通过，重点覆盖 `MemoryStorage.indexes.test.ts` 的索引规模断言、`LocalFileStorage.coalescing.test.ts` 的失败回滚、`src/__tests__/benchmarks/` 下的堆内存与吞吐基准。

### Documentation

- README / README.zh 补充 npm 包名（`ts-workflow-engine-lite`）与 GitHub 仓库名（`ts-runit-lite`）不一致的说明。
- README / README.zh 的"何时使用此引擎"一节补充超大实例量 / 长节点历史场景的建议（自定义存储适配器）。
- README / README.zh 新增内置 `sqlite` / `postgres` 存储适配器（快照式持久化，需可选依赖）的说明。
- README / README.zh 新增"测试你的工作流"一节，介绍此前未在 README 中出现过的 `testWorkflow` / `MutationTester`。
- README / README.zh 的"初始化 API"对照表更新为反映 `createContainer`/`setContainer`/`getContainer` 不再公开导出，仅保留 `bootstrap()` 与 `createEngine()` 两条路径。
- 源码与文档中残留的 "V2" 措辞（`WorkflowEngine` 相关注释与 README 引擎类型提法）已清理，不影响导出的类型/函数名。
- `docs/BUSINESS_SCENARIOS.md` 的能力速查表与内部注释同步更新为重命名后的类名。

## [3.0.2] - 2026-09-17

### Bug Fixes

- **表达式引擎：连字符节点 ID 被误判为减法**：`${check-stock.output.x}` 这类含连字符的节点 ID 此前会被 tokenizer 切成 `check` `-` `stock.output.x`，当作减法静默求值成 `NaN`/`null`。现在按"紧邻书写且拼接后在上下文中存在"的条件把片段合并回完整标识符；带空格的 `a - b` 仍按减法处理。见 `src/engine/ExpressionEvaluator.ts`。
- **表达式引擎：内置字符串函数在 `undefined` 参数下抛错**：`validateExpression` 实际是用空上下文执行一遍表达式（而非纯语法检查），`substring`/`toLowerCase`/`toUpperCase`/`trim`/`startsWith`/`endsWith` 之前假设入参一定是字符串，导致合法表达式在校验阶段被误判为语法错误。现在统一 `String(x ?? "")` 兜底。
- **优雅关闭：Ctrl+C 后监听端口可能残留**：HTTP keep-alive 连接和未响应关闭帧的 WebSocket 会让 `server.close()` 迟迟不 resolve，开发模式下表现为 `tsx watch` 报 "Previous process hasn't exited yet"。现在关闭时立即释放空闲连接（`closeIdleConnections`），并给在途连接一个可配置的宽限期（`API_CLOSE_GRACE_MS`，默认 5s）后强制销毁（`closeAllConnections`）；`ConsoleWebSocketManager` 对每个 WebSocket 连接同样加了 1s 兜底 `terminate()`。
- **优雅关闭：单个回调挂死会拖累后续清理**：`GracefulShutdown` 关闭链此前是整体一个 30s 超时，任一回调卡住会导致后面的回调完全不执行、直到整体超时强制退出。现在为单个回调加超时（默认 8s，`callbackTimeout` 可配置），超时后放弃等待、继续执行后续清理步骤。
- **优雅关闭：父进程先于本进程退出时信号收不到**：`tsx watch` 等 watcher 在 Ctrl+C 时可能先于子进程退出或被强杀，子进程被 init 收养后既收不到信号也感知不到，导致监听端口一直占用。新增 `watchParentProcess()` 轮询 `ppid`，检测到被收养后主动走 `GracefulShutdown.trigger()` 关闭链，已接入 `src/cli.ts`。
- **默认存储目录命名不一致**：`.env.example` 与 `scripts/migrate-storage-dir.ts` 中残留的旧目录名 `.ts-runit-data` 统一改为当前默认值 `.ts-workflow-engine-data`。

### New Features

- 新增项目可视化落地页 [`index.html`](./index.html)（DAG 执行动画、实例生命周期图示），README / README.zh / 业务场景文档 / 节点参考文档均已加上入口链接。
- Playground 新增两个示例工作流：购物车结算（`map`/`reduce`/`filter` 聚合计算）与工单分级派单（`router` 优先级路由 + SLA 计算）。

### Tests

- 新增 `ExpressionEvaluator` 连字符标识符与内置字符串函数校验的单元测试。
- 新增 `GracefulShutdown` 生命周期测试，覆盖单回调超时与父进程退出检测路径。

## [3.0.1] - 2026-09-17

无破坏性变更。本次以内置文档站重写为主，附带一处 `wait` 外部定时器的错误处理修复。

### New Features

- **内置文档站重写为分页版式**：概念、节点、REST 端点三类文档改由同一套渲染器（`src/api/docs/renderer.ts`）生成，按主题分页而非单页锚点。
  - `GET /docs/concepts` 概念索引，`GET /docs/concepts/:topic` 单主题页
  - `GET /docs/nodes` 节点索引，`GET /docs/nodes/:type` 单节点页（结构由 `WorkflowSchema` 生成，逐参数展开必填/可选字段）
  - `GET /api-docs` 端点索引，`GET /api-docs/:slug` 单端点页（数据源为 `openApiSpec`）
  - `GET /api-docs/openapi.json` 保持不变
  - 未匹配的 `:topic` / `:type` / `:slug` 交给 404 处理，不会返回空页面
- **节点文档目录统一为 `NODE_DOCS`**（`src/api/nodeDocs.ts`）：首页节点卡片与节点文档页共用同一份数据，不再各自维护一份节点清单；首页卡片现可点击跳转到对应节点文档页。
- **新增导出**：`generateConceptIndexHtml` / `generateConceptDocHtml`、`generateNodeIndexHtml` / `generateNodeDocHtml`、`generateApiIndexHtml` / `generateApiEndpointHtml`。

### Bug Fixes

- **`wait` 节点的外部定时器路径不再产生未处理的 Promise rejection**：该分支中的 `updateInstance()` / `externalTimer.schedule()` 此前在一个未被 catch 的异步流程里 await，失败会逃逸成 unhandled rejection 而不是走节点的 `onError`。现已整体包裹并转交 `onError`，调度失败按节点失败处理。

### Improvements

- **OpenAPI 规范补全字段描述**：`tags`、Signal/Query/Update 的 `name` 与 `payload`、`correlationId`（含幂等语义说明）等此前无描述的字段已补齐，新的端点文档页直接取用这些描述。
- 全仓 oxfmt 格式化收敛（`scripts/fix-esm-imports.ts`、`src/storage/database-adapters.ts`、`src/engine/WorkflowEngine.ts` 等）。

### Deprecations

以下导出仍可用，仅标注 `@deprecated`，保留给依赖旧版式的宿主应用：

- `generateConceptsDocHtml`（旧单页锚点版式）→ 改用 `generateConceptIndexHtml` / `generateConceptDocHtml`
- `generateApiDocsHtml`（Swagger UI 页面）→ 改用 `generateApiIndexHtml`

## [3.0.0] - 2026-09-16

### Breaking Changes

- **Default storage directory** changed from `.ts-runit-data/` to `.ts-workflow-engine-data/`. Run `npx tsx scripts/migrate-storage-dir.ts` to migrate existing data.
- **`WorkflowEngineV2`** renamed to `WorkflowEngine`. The old name is available as a deprecated alias and will be removed in v5.0.0.
- **Project name** unified to `ts-workflow-engine-lite` across all code, docs, and internal references.

### New Features

- **Pluggable storage adapter registry**: `registerStorageAdapter()`, `createStorageFromRegistry()`, `listStorageAdapters()`. Add custom storage backends without modifying engine internals.
- **Storage interface decomposition**: `StorageCore` (15 required methods) + 7 optional capability interfaces (`MetricsStorage`, `EventHistoryStorage`, `WorkflowMetadataStorage`, `HeartbeatStorage`, `CleanupStorage`, `DlqStorage`, `WebhookStorage`). Custom backends only need `StorageCore`.
- **8 new production examples**:
  - `multi-tenant-workflow.ts` — Tenant-isolated workflows with condition routing
  - `approval-pipeline.ts` — Long-running approval with timeout handling
  - `http-orchestration.ts` — HTTP integration with conditional routing
  - `parallel-fan-out.ts` — Parallel processing with multiple branches
  - `graceful-degradation.ts` — Fallback paths and dead letter queues
  - `headless-engine.ts` — Pure programmatic usage without API
  - `worker-pool.ts` — CPU-intensive tasks with worker threads
  - `cron-data-sync.ts` — Scheduled data synchronization

### Improvements

- All naming unified to `ts-workflow-engine-lite` (Logger Symbol, Schema ID, test tmpdir prefixes, docs, comments)
- Internal Logger Symbol updated to `ts-workflow-engine-lite.logger.exitListener`
- Schema ID updated to `https://ts-workflow-engine.local/workflow.schema.json`
- Test tmpdir prefixes shortened to `tswe-`
- Migration script provided: `scripts/migrate-storage-dir.ts`

### Migration Guide

1. **Storage directory**: Run `npx tsx scripts/migrate-storage-dir.ts` to rename `.ts-runit-data` to `.ts-workflow-engine-data`
2. **Class imports**: Replace `WorkflowEngineV2` with `WorkflowEngine` (old name still works but shows deprecation warning)
3. **Custom storage**: If you implemented `StorageProvider`, no changes needed — the interface is backward compatible. For new implementations, consider implementing only `StorageCore`.

### 存储层吞吐（2026-09-16）

保持单进程 + 本地文件存储不变（不引入 Redis / 集群 / 外部数据库），消除热路径上的浪费。此部分本身向后兼容——公开 API 与 `StorageProvider` 接口均未出现破坏性变更，新增的 `deleteInstanceMetrics()` 是可选方法，旧的整实例 metrics 文件仍可恢复。

**写入路径**

- `metrics` 改为**按节点一个文件**（`metrics/<instanceId>__<nodeId>.json`）。此前每次 `updateNodeMetrics` 都会重写整份含所有节点的记录，累计写入量是 Θ(nodes²)——100 节点工作流要写 1.55MB 才存下 15KB。内存形态与公开 API 不变，只有磁盘布局变了；旧的整实例文件仍能恢复
- `saveInstance`/`casUpdateInstance` 的全量 deepClone 从 3 次降到 1 次（借用 `protected peek*` 引用替代两次重复 `loadInstance`）
- `persist()` 按 key 合并已排队的写入：同一条记录的并发写只落盘一次。**不引入持久性窗口**——调用方仍要等到"含自己的值或更新的值"落盘才返回
- 新增 `deleteInstanceMetrics()`（可选方法），`ArchiveManager` 归档后一并清理 metrics，修掉随归档量增长的内存/磁盘泄漏

**查询路径**

- `MemoryStorage` 新增二级索引：instances 按 `workflowId`/`status`/`parentInstanceId`，events 按 `instanceId`/`eventType`。查询从最小的匹配桶出发而非全量扫描
- 索引只在选择度足够高时使用（候选桶 ≤ 全量的 50%）；桶接近全量时走索引反而更慢，此时退回顺序扫描
- 所有对 `instances`/`events` 的增删**必须**走 `putInstance`/`dropInstance`/`putEvent`/`dropEvent` 四个私有入口，否则索引会静默失配
- 排序键提出比较器（decorate-sort-undecorate），`toEpochMs` 不再跑 O(N log N) 次

**清理与启动**

- 清理路径改为精确删除（按内存侧刚删掉的 id），不再物化整个事件库求差集；孤儿文件由每小时一次的低频清扫兜底
- `saveHeartbeat` 不再为找一个前值而深拷贝全部 heartbeat
- 启动恢复跨集合并行、集合内并发回放（`workflow-versions` 因读-改-写保持串行）；新增 `STORAGE_RESTORE_CONCURRENCY`

**顺带修掉的两个既有 bug**

- **内存/磁盘失配**：多个并发写同一条记录且共享的落盘失败时，只有最后一代回滚，回滚到的却是倒数第二个写入者的值，内存因此领先磁盘。改为回滚到这批写入开始前的状态
- **搜索索引陈旧**：`WorkflowInstanceControl` 直接写 `getInstancesMap()` 绕过索引同步，pause/resume/cancel 后按 status 检索仍返回旧值。改走新增的 `InstanceManager.replaceInstance()`

**实测（`pnpm bench`，见 `src/benchmarks/storage-writes.test.ts`）**

下表是单机单次运行的数字，run-to-run 有 10~20% 波动，看数量级而非精确值：

| 指标                                  | 改动前        | 改动后           |
| ------------------------------------- | ------------- | ---------------- |
| 完整节点循环                          | 853 ops/s     | 1,527 ops/s      |
| `casUpdateInstance`                   | 1,719 ops/s   | 2,482 ops/s      |
| metrics 累计写入（100 节点）          | 1,551,480 B   | 51,060 B         |
| metrics 增长（100 vs 50 节点）        | 3.92x（平方） | 2.00x（线性）    |
| 并发 200 次写同一记录                 | 200 次落盘    | 1 次落盘         |
| 完整节点循环（fsync=true）            | 35 ops/s      | ~87 ops/s        |
| `queryInstances` 高选择度（1/50k）    | 2,632 ops/s   | 134,187 ops/s    |
| `queryInstances` 中选择度（2.5k/50k） | 1,928 ops/s   | 4,009 ops/s      |
| 启动恢复                              | 未测量        | 17,205 records/s |

**未做（有意）**

- 实例写入的缓冲/刷盘间隔：实例是系统记录，刷盘窗口意味着已确认的工作流状态可能在崩溃时消失
- `ExecutionOrchestrator` 每次重试的整实例持久化：重试计数必须在退避期间的崩溃后存活，而实例是单个 JSON 文档、没有部分写入路径
- 公开的只读 borrow API：引擎会修改 load 出来的实例，返回活引用会破坏 CAS 契约

---

## [2.2.0] - 2026-09-15

- Added `join` and `transform` node types
- Added `config.durationMs` / `config.until` for `wait` nodes
- Added `FSYNC_ON_WRITE` for crash-safe persistence
- Added `createWorkflowRouter()` / `createWorkflowRouterBundle()` for host app embedding
- Added named error classes (`WorkflowNotFoundError`, etc.)

## [2.1.0] - 2026-08-xx

- Added default local file persistence
- Added corrupt JSON isolation
- Added terminal instance archiving

## [2.0.0] - 2026-04-xx

- CAS concurrency control, Lease auto-renewal, Heartbeat persistence
- 13 core node types, Signal/Query/Update mechanisms
- EnhancedCronScheduler, full OpenAPI docs
