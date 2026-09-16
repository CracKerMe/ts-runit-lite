# ts-runit-lite 四维改进计划

> **背景**：项目 v2.2.0 功能已趋于完善，但在命名一致性、架构可选性、生产案例覆盖和存储可插拔性上存在短板，容易被更聚焦的竞品淹没。以下按四个维度拆解问题并给出可执行的改进路线。

---

## 一、统一命名

### 0. 项目名称统一

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

---

## 五、实施路线图

### Phase 1：存储可插拔（2 周）— 优先级最高

> 存储接口是扩展性的基础，其他改进都依赖它。

| 周  | 任务                                       | 产出                         |
| --- | ------------------------------------------ | ---------------------------- |
| W1  | 1. StorageProvider 接口分层（核心 + 可选） | 类型定义 + 迁移指南          |
| W1  | 2. 存储适配器注册机制                      | `storage/registry.ts`        |
| W1  | 3. LocalFileStorage 改为组合模式           | 重构 + 测试                  |
| W2  | 4. 内置中间件（Metrics、Cache、Audit）     | 中间件实现                   |
| W2  | 5. 更新 bootstrap/createStorage 使用注册表 | 向后兼容                     |
| W2  | 6. 添加 SQLite 存储适配器示例              | `examples/storage-sqlite.ts` |

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
