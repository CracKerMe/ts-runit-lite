# ts-runit-lite 四维改进计划

> **背景**：项目 v2.2.0 功能已趋于完善，但在命名一致性、架构可选性、生产案例覆盖和存储可插拔性上存在短板，容易被更聚焦的竞品淹没。以下按四个维度拆解问题并给出可执行的改进路线。
>
> **2026-09-16（v3.0.0）**：存储层的**吞吐**问题已在本计划之外单独做完（写放大、重复克隆、写合并、二级索引、清理与启动恢复的 O(N) 扫描），详见 CLAUDE.md 更新日志。本计划第四节因此只剩**设计**问题（接口门槛、继承耦合、类型安全）；推进 4.4 前请先读该节新增的前置约束，剩余的规模瓶颈见新增的 4.5（内存占用）。

---

## 一、统一命名

### 0. 项目名称统一 ✅（2026-09-16 已完成，仅剩 git 仓库名/本地目录名待定）

Logger Symbol、Schema ID、测试 tmpdir 前缀、代码注释中的包名均已统一为
`ts-workflow-engine-lite`（tmpdir 前缀 `tswe-*`）。`WorkflowEngineV2` →
`WorkflowEngine` 重命名见 `006aa34`。

**2026-09-16 追加**：「完整版 ts-runit」并非真实存在或计划中的产品，已从
`AppConfig.ts`、`CLAUDE.md`、`docs/BUSINESS_SCENARIOS.md` 中移除该表述，
替换为具体的外部方案（Temporal、Cadence）或直接删除该分句。
`.env.example` 中的 `@ts-runit/cli` 同样不是真实存在的工具——`RUNIT_SERVER`/
`RUNIT_TOKEN` 在代码中未被任何地方读取，是从未落地的规划残留，已整段移除。

**仍保留 `ts-runit-data` 引用的位置**（有意保留，非遗留问题）：

- `src/storage/index.ts` 的 `LEGACY_DEFAULT_DIR = ".ts-runit-data"`：迁移兼容用途，
  故意保留旧目录名以便检测和提示用户迁移

**仍未改动**（已决定暂不处理，避免破坏现有协作者的 clone URL）：

| 改动项     | 现状             | 说明                                                     |
| ---------- | ---------------- | --------------------------------------------------------- |
| git 仓库名 | `ts-runit-lite`  | 两个 remote（内网 git 服务器 + GitHub）均未重命名          |
| 本地目录名 | `ts-runit-lite`  | 开发者本地操作，改了需要重新 clone/更新本地路径             |

---

当前项目同时使用了 **三个不同的名字**，在代码库中制造了大量混乱：

| 名称                      | 出现位置                                                                                                              | 数量   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| `ts-runit-lite`           | 目录名、git 仓库（2 个 remote）、Logger Symbol、schema ID、默认存储目录 `.ts-runit-data/`、代码注释、测试 tmpdir 前缀 | ~25 处 |
| `ts-workflow-engine-lite` | package.json `name`、README 标题、API 页面标题（welcome/docs/playground）、代码注释、docs                             | ~15 处 |
| `ts-runit`                | CLAUDE.md（提及父项目）、AppConfig 注释                                                                               | ~5 处  |

**根本原因**：项目从 `ts-runit` fork 出来时改了 npm 包名，但目录名、git 仓库和内部引用没跟上。

#### 统一方案

**选定名称：`ts-workflow-engine-lite`**

理由：

1. 已经是 npm publish 的包名，改动成本最高
2. 语义清晰——用户一看就知道是什么
3. `ts-runit` 作为父项目名保留引用（"基于 ts-runit 的精简 fork"），不再混用

**需要改的位置**：

| 改动项           | 从                                            | 到                                                      | 影响                      |
| ---------------- | --------------------------------------------- | ------------------------------------------------------- | ------------------------- |
| 默认存储目录     | `.ts-runit-data/`                             | `.ts-workflow-engine-data/`                             | ⚠️ 需迁移现有用户数据     |
| Logger Symbol    | `ts-runit-lite.logger.exitListener`           | `ts-workflow-engine-lite.logger.exitListener`           | 低风险                    |
| Schema ID        | `https://ts-runit.local/workflow.schema.json` | `https://ts-workflow-engine.local/workflow.schema.json` | 低风险                    |
| 代码注释中的包名 | 混用                                          | 统一 `ts-workflow-engine-lite`                          | 零风险                    |
| 测试 tmpdir 前缀 | `ts-runit-*`                                  | `tswe-*`（缩短）                                        | 零风险                    |
| git 仓库名       | `ts-runit-lite`                               | `ts-workflow-engine-lite`                               | 需在 GitLab/GitHub 重命名 |
| 本地目录名       | `ts-runit-lite`                               | `ts-workflow-engine-lite`                               | 开发者本地操作            |

**向后兼容**：

- `STORAGE_DIR` 环境变量：如果用户未设置，新版本自动检测旧目录 `.ts-runit-data/` 并发出 deprecation 警告，同时在新目录启动
- 提供迁移脚本 `scripts/migrate-storage-dir.ts`：`mv .ts-runit-data .ts-workflow-engine-data`

#### 0.1 引擎类重命名

```
WorkflowEngineV2  →  WorkflowEngine
```

保留 `type WorkflowEngineV2 = WorkflowEngine` 别名做向后兼容，`@deprecated` 标记。

#### 0.2 初始化 API 统一为两条路径

| 类别       | 现状                                                                                                                                                                                                                | 问题                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 引擎类     | `WorkflowEngineV2`                                                                                                                                                                                                  | "V2" 是历史遗留，新用户会困惑 V1 在哪 |
| 初始化     | `bootstrap()` / `createContainer()` / `createEngine()` / `createEngineV2()`                                                                                                                                         | 四种入口，语义重叠                    |
| 执行器     | `DryRunExecutor` (class) / `ParallelExecutor` (class) / `TaskExecutor` (plain object export)                                                                                                                        | 同层概念，形态不一                    |
| Manager 类 | `CanaryReleaseManager` / `ContinueAsNewManager` / `HeartbeatManager` / `InstanceManager` / `LifecycleManager` / `SearchAttributeManager` / `StickyExecutionManager` / `TaskQueueManager` / `WorkflowVersionManager` | 9 个 Manager，职责粒度不均            |
| 导出别名   | `startApiServer` ↔ `startServer` / `createEngine` ↔ `createEngineV2`                                                                                                                                                | 别名制造歧义                          |
| 模块内部   | `TaskExecutor` 是 `export const TaskExecutor = {...}` 对象，同名文件是 `TaskExecutor.ts`                                                                                                                            | 文件暗示 class，导出是 object         |

### 改进方案

#### 1.1 引擎类重命名

```
WorkflowEngineV2  →  WorkflowEngine
```

保留 `type WorkflowEngineV2 = WorkflowEngine` 别名做向后兼容，`@deprecated` 标记。

#### 1.2 初始化 API 统一为两条路径

| 路径         | API                                        | 适用场景                             |
| ------------ | ------------------------------------------ | ------------------------------------ |
| **快速启动** | `bootstrap(options)`                       | 单引擎、无特殊需求（保持不变）       |
| **精细控制** | `createEngine({ storage, eventBus, ... })` | 自定义依赖注入、多引擎、嵌入宿主应用 |

删除 `createEngineV2`，删除 `createContainer` / `setContainer` / `getContainer` 的公开导出（内部仍使用，但不暴露给库消费方）。`createEngine` 直接接收配置对象而非读全局单例。

#### 1.3 Manager 合并精简

| 当前                                                                       | 合并为                    | 理由                           |
| -------------------------------------------------------------------------- | ------------------------- | ------------------------------ |
| `HeartbeatManager`                                                         | `HeartbeatTracker`        | 与 "管理" 无关，是心跳跟踪     |
| `StickyExecutionManager` + `StickyWorker`                                  | `WorkerAffinity`          | 名字更短、语义更准             |
| `TaskQueueManager`                                                         | `TaskDispatcher`          | 它做的是任务分发，不是队列管理 |
| `InstanceManager`                                                          | 并入 `WorkflowEngine`     | 实例 CRUD 本就是引擎职责       |
| `LifecycleManager`                                                         | 并入 `WorkflowEngine`     | 生命周期跟随引擎               |
| `CanaryReleaseManager` / `ContinueAsNewManager` / `WorkflowVersionManager` | 保留但统一后缀为 `Policy` | 它们是策略，不是"管理者"       |

#### 1.4 导出清理

- 删除 `startServer` 别名（只保留 `startApiServer`）
- 删除 `createEngineV2` 别名
- `TaskExecutor` 改为导出 class 或重命名为 `nodeDispatch` 函数

#### 1.5 向后兼容策略

所有重命名均保留 `@deprecated` 导出别名，持续 2 个大版本后移除。在 `CHANGELOG.md` 中记录迁移路径。

---

## 二、API 层可选化

### 问题诊断

当前 `package.json` 的 `dependencies` 包含 `express`、`helmet`、`cors`、`morgan`、`ws`、`swagger-ui-dist`、`jsonwebtoken` 等 11 个仅 API 层使用的包。即使用户只用引擎核心，也必须安装这些依赖。这是轻量级引擎最大的定位矛盾。

### 改进方案

#### 2.1 依赖分层

**核心层（`dependencies`）**：

```
uuid, dotenv, node-cron, zod, json-schema-to-zod, axios
```

**API 层（`optionalDependencies` 或 `peerDependencies`）**：

```
express, helmet, cors, morgan, ws, swagger-ui-dist,
jsonwebtoken, express-validator, body-parser
```

#### 2.2 代码隔离

```
src/
├── core/                    # 纯引擎，零 HTTP 依赖
│   ├── engine/             # WorkflowEngine, executors, expressions
│   ├── storage/            # StorageProvider 接口 + 实现
│   ├── event/              # EventBus, HookManager
│   ├── scheduler/          # CronScheduler
│   └── model/              # 类型定义
├── api/                     # REST API（可选）
│   ├── server.ts
│   ├── router.ts
│   └── middleware/
├── integrations/            # 外部集成（可选）
│   └── express/            # Express 集成辅助
└── index.ts                 # 统一入口，条件重导出
```

#### 2.3 入口文件条件导出

```typescript
// index.ts — 核心永远可用
export { WorkflowEngine } from "./core/engine/WorkflowEngine";
export { createStorage, MemoryStorage, LocalFileStorage } from "./core/storage";
export type { StorageProvider } from "./core/storage";
// ... 其他核心导出

// API 导出延迟加载，不影响 tree-shaking
export async function createWorkflowRouter(...) { ... }
export async function startApiServer(...) { ... }
```

#### 2.4 安装体验

```bash
# 只用引擎
pnpm add ts-workflow-engine-lite

# 需要 REST API
pnpm add ts-workflow-engine-lite express helmet cors
```

在 `package.json` 中用 `peerDependenciesMeta` 标记 API 相关依赖为 `optional: true`，让 pnpm/npm 不强制安装。

---

## 三、生产使用案例

### 现有案例分析

| 案例         | 文件                      | 覆盖场景              |
| ------------ | ------------------------- | --------------------- |
| 快速上手     | `quickstart.ts`           | 单节点、同步完成      |
| 订单处理     | `order-processing.ts`     | 多节点串行（demo 级） |
| Express 嵌入 | `embedded-express-app.ts` | API 挂载              |
| 错误处理     | `error-handling.ts`       | 命名错误类            |

**缺失的关键生产场景**：

### 3.1 待补充案例

| 案例                   | 文件名                              | 覆盖的能力点                                    |
| ---------------------- | ----------------------------------- | ----------------------------------------------- |
| **多租户 SaaS 工作流** | `examples/multi-tenant-workflow.ts` | 按租户隔离工作流、条件路由、数据隔离            |
| **长时运行审批流**     | `examples/approval-pipeline.ts`     | approval 节点、event 触发、超时处理、持久化恢复 |
| **HTTP 集成编排**      | `examples/http-orchestration.ts`    | http 节点、secret 解析、重试策略、并发控制      |
| **定时数据同步**       | `examples/cron-data-sync.ts`        | cron 调度、子工作流、loop 节点、错误回滚        |
| **多分支并行处理**     | `examples/parallel-fan-out.ts`      | next 数组并行、join 汇合、transform 输出重塑    |
| **优雅降级与 DLQ**     | `examples/graceful-degradation.ts`  | failureNext、死信队列、重试策略、监控指标       |
| **嵌入式无 API 使用**  | `examples/headless-engine.ts`       | 不启动 API、纯编程接口、自定义存储              |
| **Worker 线程池**      | `examples/worker-pool.ts`           | WORKER_POOL_ENABLED、sticky 亲和、任务队列路由  |

### 3.2 案例结构规范

每个案例应包含：

1. **场景描述**（注释块）：为什么需要这个模式
2. **完整可运行代码**：`pnpm example:<name>` 可直接执行
3. **package.json script**：注册到 scripts 中
4. **对应的文档段落**：在 `docs/BUSINESS_SCENARIOS.md` 中引用

---

## 四、存储接口可插拔

### 问题诊断

| 问题                                     | 严重程度 | 说明                                             |
| ---------------------------------------- | -------- | ------------------------------------------------ |
| `StorageProvider` 接口 40+ 方法          | 🔴 高    | 实现者需要实现 DLQ、Webhook 等可选能力，门槛过高 |
| `LocalFileStorage extends MemoryStorage` | 🔴 高    | 继承耦合——文件存储的查询能力完全依赖内存基类     |
| 无存储适配器注册机制                     | 🟡 中    | 新增存储后端需要修改 `createStorage()` 的 switch |
| 无中间件/拦截器模式                      | 🟡 中    | 缓存、审计、指标等横切关注点无法在存储层统一处理 |
| `StorageClient` 是 `any`                 | 🟡 中    | 类型安全缺失                                     |

> **2026-09-16 更新**：吞吐相关的问题已在 v3.0.0 单独处理完毕（见 CLAUDE.md 更新日志），**不在**本节的重构范围内，也不应作为推进本节重构的理由：
>
> - metrics 的 Θ(nodes²) 写放大（改为按节点拆文件）
> - 实例写入的重复 deepClone（借用 `protected peek*` 引用）
> - 写队列只串行不合并
> - 查询无二级索引
> - 清理与启动恢复的 O(N) 扫描
>
> 上表剩下的都是**设计问题**（接口门槛、继承耦合、类型安全），性能已不是推进它们的动因。同时注意这轮改动给 4.4 增加了新的约束，见该节。

### 改进方案

#### 4.1 接口分层：核心 + 可选能力

```typescript
// ===== 核心接口（必须实现）=====
interface StorageProvider {
  connect(): Promise<void>;
  close(): Promise<void>;

  // 实例
  saveInstance(instance: WorkflowInstance): Promise<void>;
  loadInstance(instanceId: string): Promise<WorkflowInstance | null>;
  deleteInstance(instanceId: string): Promise<void>;
  listInstances(): Promise<string[]>;
  queryInstances(
    params: InstanceQueryParams,
  ): Promise<{ instances: WorkflowInstance[]; total: number }>;
  casUpdateInstance(instance: WorkflowInstance): Promise<boolean>;

  // 工作流定义
  saveWorkflow(workflow: WorkflowDefinition): Promise<void>;
  loadWorkflow(workflowId: string): Promise<WorkflowDefinition | null>;
  deleteWorkflow(workflowId: string): Promise<void>;
  listWorkflows(): Promise<string[]>;

  // 事件等待
  saveEventWaitingState(state: EventWaitingState): Promise<void>;
  loadEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<EventWaitingState | null>;
  loadAllEventWaitingStates(): Promise<EventWaitingState[]>;
  deleteEventWaitingState(instanceId: string, nodeId: string): Promise<void>;
}

// ===== 可选能力接口（按需实现）=====
interface MetricsStorage {
  saveInstanceMetrics(metrics: InstanceMetrics): Promise<void>;
  loadInstanceMetrics(instanceId: string): Promise<InstanceMetrics | null>;
  updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void>;
}

interface EventHistoryStorage {
  saveEvent(event: EventRecord): Promise<void>;
  loadEvent(eventId: string): Promise<EventRecord | null>;
  queryEvents(
    params: EventQueryParams,
  ): Promise<{ events: EventRecord[]; total: number }>;
  deleteEvent(eventId: string): Promise<void>;
}

interface HeartbeatStorage {
  saveHeartbeat(state: HeartbeatState): Promise<void>;
  loadAllHeartbeats(): Promise<HeartbeatState[]>;
  deleteHeartbeat(instanceId: string, nodeId: string): Promise<void>;
}

interface WorkflowMetadataStorage {
  saveWorkflowWithMetadata(workflow: StoredWorkflow): Promise<void>;
  loadWorkflowWithMetadata(workflowId: string): Promise<StoredWorkflow | null>;
  listWorkflowsWithMetadata(): Promise<StoredWorkflow[]>;
  saveWorkflowVersion(version: StoredWorkflowVersion): Promise<void>;
  loadWorkflowVersion(
    workflowId: string,
    version: number,
  ): Promise<StoredWorkflowVersion | null>;
  listWorkflowVersions(workflowId: string): Promise<number[]>;
}

interface CleanupStorage {
  cleanupStaleEvents?(retentionDays: number): Promise<number>;
  cleanupExpiredHeartbeats?(): Promise<number>;
  cleanupStaleInstances?(maxAgeMs: number): number | Promise<number>;
}

// ===== 组合接口 =====
interface FullStorageProvider
  extends
    StorageProvider,
    MetricsStorage,
    EventHistoryStorage,
    HeartbeatStorage,
    WorkflowMetadataStorage,
    CleanupStorage {}
```

#### 4.2 存储适配器注册机制

```typescript
// storage/registry.ts
type StorageFactory = (
  config: Record<string, unknown>,
) => Promise<StorageProvider>;

const storageRegistry = new Map<string, StorageFactory>();

export function registerStorageAdapter(
  name: string,
  factory: StorageFactory,
): void {
  storageRegistry.set(name, factory);
}

export async function createStorage(
  name?: string,
  config?: Record<string, unknown>,
): Promise<StorageProvider> {
  const adapterName = name ?? process.env.STORAGE_ADAPTER ?? "local-file";
  const factory = storageRegistry.get(adapterName);
  if (!factory) {
    throw new Error(
      `Unknown storage adapter: "${adapterName}". Registered: ${[...storageRegistry.keys()].join(", ")}`,
    );
  }
  return factory(config ?? {});
}

// 内置注册
registerStorageAdapter("memory", async () => new MemoryStorage());
registerStorageAdapter("local-file", async (config) => {
  const storage = new LocalFileStorage({
    directory: (config.directory as string) ?? ".ts-runit-data",
    fsyncOnWrite: (config.fsyncOnWrite as boolean) ?? false,
  });
  await storage.connect();
  return storage;
});
```

#### 4.3 存储中间件（横切关注点）

```typescript
// storage/middleware.ts
class MetricsStorageMiddleware implements MetricsStorage {
  constructor(
    private inner: StorageProvider,
    private metrics: MetricsCollector,
  ) {}

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    const start = Date.now();
    await this.inner.saveInstance(instance);
    this.metrics.record("storage.saveInstance", Date.now() - start);
  }
  // ...
}

class CacheStorageMiddleware implements StorageProvider {
  private cache = new Map<string, { data: unknown; expiry: number }>();

  async loadInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const cached = this.cache.get(`instance:${instanceId}`);
    if (cached && cached.expiry > Date.now())
      return cached.data as WorkflowInstance;
    const result = await this.inner.loadInstance(instanceId);
    if (result)
      this.cache.set(`instance:${instanceId}`, {
        data: result,
        expiry: Date.now() + 5000,
      });
    return result;
  }
  // ...
}
```

#### 4.4 LocalFileStorage 重构

> **2026-09-16 前置约束（v3.0.0 之后必读）**
>
> 这轮吞吐改造在 `MemoryStorage` 上引入了若干**受保护/私有**的内部设施，`LocalFileStorage` 依赖它们工作。改成组合模式时必须一并设计好出路，否则会静默丢掉正确性或性能：
>
> 1. **`protected peek*`（`peekInstance`/`peekInstanceMetrics`/`peekHeartbeat`）**
>    持久化路径靠它们借用存储中的引用当快照，避免每次写入多做两次全量 deepClone。组合模式下 `LocalFileStorage` 不再是子类，拿不到 `protected` 成员。
>    **不要**为此把 `peek*` 提升到公开接口——引擎会修改 load 出来的实例，返回活引用会让内存状态在 CAS 校验前被改掉，破坏 CAS 契约。可行方向是让 `MemoryStorage` 的写入方法直接返回它存进 Map 的那份 clone（当初因 `StorageProvider` 声明 `Promise<void>` 而放弃，组合模式下内部接口可以自由些）。
>
> 2. **二级索引与四个写入入口**
>    `instances`/`events` 的增删只能走 `putInstance`/`dropInstance`/`putEvent`/`dropEvent`，索引才不会失配。组合模式下 `LocalFileStorage` 通过 `this.memory.saveInstance(...)` 调用，天然走公开方法，这一条反而更安全——但**不要**在外层再持有一份 instances Map，否则又出现两个真相来源。
>
> 3. **`updateNodeMetrics` 必须保持"替换而非就地修改"**
>    就地修改会让已借出的快照在脚下被改掉。
>
> 4. **`lastCleaned*Ids` 是 `protected` 的清理回执**
>    清理路径靠它精确删文件，不再物化整个事件库求差集。组合模式下需要把它变成清理方法的返回值。
>
> 5. **草图里"内存 miss 则读磁盘"的模型与现状不符**
>    当前 `LocalFileStorage` 启动时全量恢复进内存，**运行期读取从不落盘**。改成 lazy load 是一个独立的语义变更（影响 `queryInstances` 的完整性——按 workflowId 查询时磁盘上未加载的实例算不算数？），不要顺手夹带进重构里。真正的内存天花板问题见下方"内存占用"一节。
>
> 6. **回归护栏**
>    重构后必须保证 `src/storage/__tests__/` 下的 12 个文件全绿（尤其 `MemoryStorage.indexes.test.ts` 的索引规模断言、`LocalFileStorage.coalescing.test.ts` 的失败回滚），并用 `pnpm bench` 对照 CLAUDE.md v3.0.0 记录的基线，确认没有性能倒退。

将 `LocalFileStorage extends MemoryStorage` 改为组合模式：

```typescript
class LocalFileStorage implements StorageProvider {
  private memory: MemoryStorage; // 查询层

  constructor(options: LocalFileStorageOptions) {
    this.memory = new MemoryStorage(); // 组合，不继承
  }

  async loadInstance(id: string): Promise<WorkflowInstance | null> {
    // 先查内存，miss 则读磁盘
    const cached = await this.memory.loadInstance(id);
    if (cached) return cached;
    const fromDisk = await this.readFromDisk("instances", id);
    if (fromDisk) await this.memory.saveInstance(fromDisk);
    return fromDisk;
  }
}
```

#### 4.5 内存占用：v3.0.0 之后真正剩下的天花板

> 2026-09-16 新增。吞吐（CPU + 写放大）已经处理完毕，**内存**是单进程规模现在的主要限制，且未在 v3.0.0 中解决。

现状：

- `LocalFileStorage extends MemoryStorage` 意味着每条记录都常驻内存——磁盘只是恢复边界，不是冷存储
- `InstanceManager.loadFromStorage()` 会把每个实例**再深拷贝一份**进 `InstanceManager.instances`，与 `MemoryStorage.instances` 是同一批数据的两份常驻副本
- v3.0.0 已修掉归档实例的 metrics 泄漏（`deleteInstanceMetrics`），但 `InstanceManager.instances` 里的条目仍不会被 `ArchiveManager` 清掉

按影响/风险排序的增量做法（**不要**为此直接上大重构）：

1. **把 `instanceManager.removeInstance(instanceId)` 接进 `ArchiveManager` 的终态处理**（该方法已存在且会清理搜索索引）。改动小、独立可验证
2. **评估 `InstanceManager.instances` 这份副本是否必要**。`MemoryStorage.instances` 已经是同一批数据，若能读穿到存储层就能直接省掉一半实例内存。这是最大的单项内存收益，但耦合风险高，应单独立项
3. **只有在 1、2 都做完仍不够时**，才考虑 4.4 草图里的 lazy load / 冷热分层——注意它会改变 `queryInstances` 的完整性语义（见 4.4 前置约束第 5 条）

护栏：`src/benchmarks/workflow-engine.test.ts` 有堆 <200MB 的断言，`src/benchmarks/load-test.test.ts` 有「100 个实例堆增量 <20MB」的断言。任何内存相关改动都应先看这两条。

---

## 五、实施路线图

### Phase 1：存储可插拔（2 周）— 优先级最高

> 存储接口是扩展性的基础，其他改进都依赖它。

| 周  | 任务                                       | 产出                             |
| --- | ------------------------------------------ | -------------------------------- |
| W1  | 1. StorageProvider 接口分层（核心 + 可选） | 类型定义 + 迁移指南              |
| W1  | 2. 存储适配器注册机制                      | `storage/registry.ts`            |
| W1  | 3. LocalFileStorage 改为组合模式           | 重构 + 测试（先读 4.4 前置约束） |
| W2  | 4. 内置中间件（Metrics、Cache、Audit）     | 中间件实现                       |
| W2  | 5. 更新 bootstrap/createStorage 使用注册表 | 向后兼容                         |
| W2  | 6. 添加 SQLite 存储适配器示例              | `examples/storage-sqlite.ts`     |

### Phase 2：API 层可选化（1.5 周）

| 周  | 任务                                            | 产出              |
| --- | ----------------------------------------------- | ----------------- |
| W3  | 1. 目录结构重组（core/ + api/ + integrations/） | 文件迁移          |
| W3  | 2. 依赖分层（dependencies vs peerDependencies） | package.json      |
| W3  | 3. index.ts 条件导出                            | tree-shaking 友好 |
| W4  | 4. 验证：无 express 安装时引擎可用              | 集成测试          |
| W4  | 5. 文档：安装指南分 core / full 两种            | README 更新       |

### Phase 3：命名统一（1 周）

| 周  | 任务                                                    | 产出     |
| --- | ------------------------------------------------------- | -------- |
| W5  | 1. WorkflowEngineV2 → WorkflowEngine + 别名             | 重命名   |
| W5  | 2. 初始化 API 统一（删 createEngineV2/createContainer） | 清理导出 |
| W5  | 3. Manager 类合并精简                                   | 重命名   |
| W5  | 4. TaskExecutor 对象 → class 或函数                     | 统一形态 |
| W5  | 5. 所有 @deprecated 别名 + CHANGELOG                    | 向后兼容 |

### Phase 4：生产案例（1 周）

| 周  | 任务                          | 产出             |
| --- | ----------------------------- | ---------------- |
| W6  | 1. 8 个生产案例编写           | examples/*.ts    |
| W6  | 2. package.json scripts 注册  | `pnpm example:*` |
| W6  | 3. BUSINESS_SCENARIOS.md 更新 | 文档             |
| W6  | 4. README 案例导航            | 快速入口         |

---

## 六、风险与缓解

| 风险                              | 影响 | 缓解                                                      |
| --------------------------------- | ---- | --------------------------------------------------------- |
| 接口分层导致现有实现者需适配      | 高   | 默认导出 `FullStorageProvider` 组合接口，现有实现无需改动 |
| 目录重组破坏 git blame            | 中   | 一次大批量迁移 + .gitattributes                           |
| 命名变更破坏下游消费方            | 高   | 所有旧名保留 @deprecated 别名 2 个大版本                  |
| Express 依赖移除后 API 功能不可用 | 中   | 显式 peerDependency + 安装提示                            |
| 存储中间件增加复杂度              | 低   | 仅在需要时使用，默认不启用                                |

---

## 七、成功指标

| 指标                               | 当前                 | 目标 |
| ---------------------------------- | -------------------- | ---- |
| 核心引擎安装体积（不含可选依赖）   | ~15MB (node_modules) | <5MB |
| StorageProvider 方法数（核心接口） | 40+                  | ≤15  |
| 生产案例数                         | 4                    | 12+  |
| 初始化 API 路径数                  | 4                    | 2    |
| Tree-shaking 后 API 层残留         | 有                   | 无   |

---

_计划版本：v1.0 | 日期：2026-09-16 | 作者：MiMo_
