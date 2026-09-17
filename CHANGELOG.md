# Changelog

All notable changes to ts-workflow-engine-lite will be documented in this file.

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
