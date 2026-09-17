# CLAUDE.md - AI Agent 项目协作指南

本文件为 AI Agent（如 Claude Code）提供项目协作的关键信息。

## 项目信息

**项目名**: ts-workflow-engine-lite  
**版本**: 3.0.2（2026 年 9 月）  
**类型**: 轻量级 TypeScript 工作流引擎，面向单进程嵌入式场景  
**语言**: TypeScript + Express v5  
**包管理**: pnpm

## 项目目标

提供一个可独立运行、依赖最小化的工作流编排引擎核心，支持：

- ✅ 15 种核心节点类型（action、wait、event、rollback、subworkflow、http、sql、queue、condition、router、loop、approval、notification、join、transform）
- ✅ 事件驱动、Cron 调度、Signal/Query/Update 消息机制
- ✅ 本地文件持久化（默认）与内存存储，面向单进程部署（不含 Redis/分布式集群），可选 `FSYNC_ON_WRITE` 换取主机级崩溃后的持久性
- ✅ 并发控制（CAS）、单进程 Lease 自动续期、运行期 Heartbeat 跟踪
- ✅ 完整的可观测性（结构化日志、Prometheus 指标）
- ✅ 开发友好的 REST API（工作流、实例、模板、事件、Webhook、分析等端点），也可通过 `createWorkflowRouter()` 挂载到宿主 Express 应用
- ✅ 表达式引擎（数学/比较/逻辑运算、20+ 内置函数、自定义函数注册）

`AppConfig` 中仍保留少量 Redis/Cluster 配置字段用于兼容旧调用方，但当前 lite 版本不会把它们作为可用的存储或集群后端。

## 开发规范

### 代码风格

```typescript
// ✅ 推荐
class WorkflowEngine {
  async executeNode(instanceId: string, nodeId: string): Promise<NodeOutput> {
    Logger.info(instanceId, nodeId, "Executing node", { nodeId });
    // 实现逻辑
  }
}

// ❌ 避免
class badEngine {
  executeNode(nodeId) {
    console.log("Executing node: " + nodeId);
  }
}
```

**命名规范**:

- 类名: `PascalCase` — `WorkflowEngine`, `TaskExecutor`
- 函数/变量: `camelCase` — `executeNode`, `workflowId`
- 常量: `UPPER_SNAKE_CASE` — `MAX_RETRIES`, `DEFAULT_TIMEOUT`
- 接口/类型: `PascalCase` — `WorkflowDefinition`, `NodeExecutor`

### 日志规范

Logger 签名为 `Logger.info(context1, context2, message, data?)`，支持两种合法用法：

```typescript
// ✅ 工作流实例内（有 instanceId 上下文）
Logger.info(instance.instanceId, "validate-order", "Node started", {
  workflowId,
});
Logger.error(instance.instanceId, "validate-order", "Node failed", error.stack);

// ✅ 模块级代码（无实例上下文）
Logger.info("system", "storage", "Local file storage initialized");
Logger.info("system", "scheduler", "Cron job triggered", { workflowId });

// ❌ 避免
console.log("Node started: " + nodeId);
```

### TypeScript 要求

- 启用严格模式 (`strict: true`)，目标 ES2022，模块系统 CommonJS
- 所有函数必须有明确的返回类型
- 避免使用 `any`，优先使用泛型或 `unknown`
- 使用 oxlint 进行 lint，oxfmt 进行格式化

### 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```bash
feat(engine): add parallel node execution
fix(api): correct instance status response
refactor(storage): optimize local file recovery
docs(readme): update installation
test(engine): add retry mechanism tests
```

## 项目结构

### 核心模块

```
src/
├── engine/             # 工作流执行引擎（核心）
│   ├── WorkflowEngine.ts       # 主引擎类
│   ├── TaskExecutor.ts          # 节点执行分发（nodeDispatch/ 子模块）
│   ├── StateMachine.ts          # 状态机
│   ├── ExpressionEvaluator.ts   # 表达式引擎
│   ├── ConcurrencyControl.ts    # CAS 并发控制
│   ├── HeartbeatManager.ts      # 心跳持久化（单进程）
│   ├── InstanceManager.ts       # 实例管理
│   ├── WorkflowRegistry.ts      # 工作流注册表
│   └── executors/               # 节点执行器：action/http/sql/queue/condition/
│                                 # router/loop/approval/notification/subworkflow/
│                                 # join/transform 等
├── api/                # REST API 服务
│   ├── server.ts                # Express 服务器
│   ├── routes/                  # 路由处理（workflows/instances/templates/events/
│   │                             # webhooks/analytics/functions/dlq）
│   └── middleware/              # 认证、限流中间件（内存限流，无 Redis 后端）
├── event/              # 事件系统
│   ├── EventBus.ts              # 事件总线（进程内）
│   ├── HookManager.ts           # Hook 管理（生命周期）
│   ├── EventCoordinator.ts      # 事件协调
│   └── EventDeduplicator.ts     # 事件去重（内存）
├── storage/            # 存储层（可插拔架构）
│   ├── StorageProvider.ts        # 核心接口 StorageCore + 7 个能力子接口
│   ├── registry.ts               # 适配器注册表（registerStorageAdapter）
│   ├── builtin-adapters.ts       # 内置适配器注册（memory / local-file）
│   ├── MemoryStorage.ts          # 内存存储 + 二级索引（查询层）
│   ├── LocalFileStorage.ts       # 本地文件持久化（继承 MemoryStorage 作为查询层）
│   └── ArchiveManager.ts         # 终态实例归档
├── scheduler/          # 定时调度（Cron，单进程）
├── metrics/            # 指标聚合
├── utils/              # 工具类（Logger、审计、LeaseStore 等）
├── index.ts            # 无启动副作用的公共包入口
├── cli.ts              # Demo / REST API 可执行入口
└── bootstrap.ts        # 应用组件初始化
```

### 关键文件

| 文件                                | 用途           | 修改频度               |
| ----------------------------------- | -------------- | ---------------------- |
| `src/model/Workflow.ts`             | 工作流定义类型 | 低（扩展新节点类型时） |
| `src/engine/TaskExecutor.ts`        | 节点执行分发   | 低（新增节点执行器时） |
| `src/engine/WorkflowEngine.ts`      | 核心执行逻辑   | 低（核心算法改进时）   |
| `src/api/routes/`                   | API 端点实现   | 中（新增 API 端点时）  |
| `src/engine/ExpressionEvaluator.ts` | 表达式解析     | 低（扩展表达式函数时） |
| `.env.example`                      | 环境变量配置   | 中（新增配置项时）     |
| `package.json`                      | 依赖管理       | 低（升级依赖时）       |

## 开发命令

```bash
# 基础命令
pnpm install                         # 安装依赖
pnpm dev                             # 开发模式（默认本地文件存储）
pnpm dev:api                         # 启动 API 服务器
pnpm build                           # 编译 TypeScript
pnpm test                            # 运行单元测试
pnpm test:watch                      # 监视模式测试
pnpm test:coverage                   # 生成测试覆盖率报告

# 代码检查
pnpm typecheck                       # TypeScript 类型检查（tsc --noEmit）
pnpm lint                            # oxlint 检查
pnpm lint:fix                        # oxlint 检查（自动修复）
pnpm format                          # oxfmt 格式化（自动修复）
pnpm format:check                    # oxfmt 格式检查（不修复）
pnpm check                           # oxlint + oxfmt（自动修复）
pnpm check:ci                        # oxlint + oxfmt 检查（不修复）
pnpm check:all                       # 全量检查（typecheck + check:ci）

# 演示和示例
pnpm dev                             # 运行内置演示工作流
pnpm example event-timeout-workflow  # 运行事件/超时示例
pnpm example data-processing         # 运行数据处理示例
```

## 测试准则

### 单元测试

使用 Vitest 框架，测试文件命名为 `*.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;

  beforeEach(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
  });

  it("should execute workflow successfully", async () => {
    const result = await engine.start("test-workflow", {});
    expect(result).toBeDefined();
  });
});
```

**测试覆盖场景**:

- ✅ 正常流程、错误流程、边界条件
- ✅ 并发冲突、版本控制、CAS 重试
- ✅ Heartbeat 持久化与恢复
- ✅ 本地文件存储的重启恢复、损坏记录隔离与归档清理
- ✅ 资源限制与容量（自动清理）
- ✅ 存储层：二级索引一致性（随机序列对照暴力扫描 + 断言索引规模）、写合并与失败回滚、并行恢复、metrics 布局兼容

### 运行测试

```bash
pnpm test              # 运行所有测试
pnpm test:watch        # 监视模式
pnpm test:coverage     # 覆盖率报告
```

## 常见任务

### 添加新节点类型

1. 在 `src/engine/executors/` 创建 `CustomExecutor.ts`
2. 实现 `NodeExecutor` 接口
3. 在 `TaskExecutor.ts` 注册执行器
4. 在 `src/model/Workflow.ts` 的 `TaskType` 中添加新类型
5. 添加单元测试到 `src/engine/executors/__tests__/`

### 添加 API 端点

1. 在 `src/api/routes/` 创建路由文件
2. 在 `src/api/server.ts` 注册路由
3. 更新 `src/api/openapi.ts` 中的 OpenAPI 规范
4. 添加测试到 `src/api/__tests__/`

### 修改工作流定义

编辑 `src/model/Workflow.ts`：

```typescript
export interface WorkflowDefinition {
  id: string; // 工作流 ID
  name: string; // 工作流名称
  version: string; // 版本号
  description?: string; // 描述
  startNode: string; // 起始节点 ID
  nodes: Record<string, TaskNode>; // 节点定义
  triggerEvents?: string[]; // 触发事件
  // ... 其他字段
}
```

## 关键概念

### 1. 节点输出引用

```typescript
// 后续节点可以通过 ${nodeId.output.path} 引用前面节点的输出
"${validate-order.output.amount}"; // 引用对象字段
"${node1.output.price * 0.8}"; // 表达式计算
```

实现见 `src/engine/ExpressionEvaluator.ts` 和对应测试。

### 2. 表达式引擎

支持数学、比较、逻辑运算和 20+ 内置函数：

```typescript
"${max(a, b)}";
"${round(price * 1.1, 2)}";
"${node1.output.age >= 18}";
```

实现见 `src/engine/ExpressionEvaluator.ts` 和 `src/engine/functions/`。

### 3. 并发控制 (CAS)

- `WorkflowInstance` 包含 `version` 字段
- 更新时检测版本冲突，自动重试
- 完全解决 Lost Update 问题

### 4. Lease 自动续期

- 防止长运行任务超时导致重复执行
- `LeaseStore.startAutoRenewal()` 后台续期（单进程内存实现）

### 5. Heartbeat 跟踪

- 长时运行任务的进度报告
- `HeartbeatManager` 通过 `StorageProvider` 保存和恢复 Heartbeat 状态
- 使用默认 `LocalFileStorage` 时可跨普通进程重启恢复
- 使用 `MemoryStorage` 时仅在当前进程生命周期内保留

### 6. 本地文件持久化与恢复

- 非测试环境默认使用 `LocalFileStorage`，数据目录为 `.ts-workflow-engine-data/`
- 每条记录独立保存为 JSON，通过临时文件和原子 rename 更新
- 数据按 `instances`、`workflows`、`workflow-versions`、`waiting`、`metrics`、`events`、`heartbeats`、`dlq` 等目录分类
- `metrics` 的粒度是**每节点一个文件**（`metrics/<instanceId>__<nodeId>.json`），不是每实例一个；旧的整实例布局仍可恢复并会被逐步取代
- 同一条记录的并发写入会合并成一次落盘，但 `persist()` 返回时保证"本次或更新的值"已原子落盘，不会丢失已确认的写入
- 启动恢复跨集合并行，集合内并发回放；并发度可用 `STORAGE_RESTORE_CONCURRENCY` 调整（默认 16）
- 启动时无法解析的记录会移动到对应分类的 `corrupt/`，不阻断其他数据恢复
- 包含 JavaScript 函数或闭包的工作流定义不能序列化；启动时应先关闭自动恢复，重新注册定义，再调用 `engine.resumeRunningInstancesFromStorage()`
- 本地文件存储不提供跨进程锁，同一个 `STORAGE_DIR` 只能由一个引擎进程使用

### 7. 密钥解析（SecretManager）

- 节点配置中可写 `${secret:NAME}`，在 `http` / `sql` / `queue` 节点执行前解析（含嵌套字段）
- 由 `SECRET_PROVIDER` 选择后端，默认 `env`（从环境变量读取）
- `vault` / `aws-secrets-manager` 尚未实现，配置后在启动时抛 `UnsupportedSecretProviderError`，不会静默回退
- 未找到的密钥保留原样并记录 warn，不会替换成 `undefined`
- 实现见 `src/utils/SecretManager.ts` 与 `src/utils/secrets.ts`

### 8. Worker 线程池与 Sticky 亲和性

- `WORKER_POOL_ENABLED=true` 时，`http` 节点卸载到 worker 线程执行
- 每个 worker 有稳定 `workerId`；同一实例的后续任务优先路由回已绑定的 worker（`WORKER_STICKY_ENABLED`）
- 绑定的 worker 忙碌时回退到任意空闲 worker——亲和性只做优化，不会阻塞任务
- worker 退出或池关闭时释放绑定，避免实例被绑死在已终止的线程上
- 实现见 `src/engine/worker/WorkerPool.ts` 与 `src/engine/StickyExecutionManager.ts`

### 9. 任务队列路由（TaskQueueManager）

- action / rollback 节点可通过 `taskQueue: "queue-name"` 路由到命名队列
- 队列 worker 通过 `taskQueueManager.registerWorker()` 注册，受 `maxConcurrent` 限流
- 队列无 worker 时回退为本地直接执行，节点不会被卡住
- 与 `queue` 节点类型不同：后者对接外部消息中间件，前者是进程内的工作分发
- 实现见 `src/engine/TaskQueueManager.ts`

### 10. 终态实例归档

- 归档默认关闭，通过 `ARCHIVE_ENABLED=true` 启用
- 终态实例写入 `archive/YYYY-MM-DD/<instanceId>.json` 后，才从热存储移除
- `ARCHIVE_RETENTION_DAYS` 控制日期分区保留时间，`ARCHIVE_CLEANUP_INTERVAL_MS` 控制清理周期
- 归档文件是冷数据，不会自动参与实例查询或启动恢复

### 11. join / transform 节点与 durable wait

- `join`：等待 `config.waitFor` 列出的分支节点完成，`mode: "all" | "any"`；依赖引擎批量 fan-out 执行，单进程场景下无需额外 CAS/加锁
- `transform`：通过类型化表达式求值重塑节点输出（而非字符串插值），数字/数组/对象保持原生类型，不强制转成字符串
- `wait` 节点新增 `config.durationMs` / `config.until`（绝对截止时间）作为相对时长/绝对时间的显式写法，优先级高于旧的顶层 `timeout` 字段
- `wait` 默认是 **durable** 的（`config.durable` 缺省即 `true`）：首次进入时把绝对 deadline 固化到 `instance.state.nodes[nodeId].deadline` 并持久化，进程重启恢复后按原 deadline 续等剩余时长而非从头计时；停机期间已过期的等待恢复后立即触发。`config.durable: false` 恢复旧行为（每次进入都重新计时），用于 loop 体内需要每轮完整等待的场景
  - 仍不是"进程外"计时——引擎不会替你在进程下线期间推进时间，触发时刻的上限是"进程恢复的那一刻"；要求**秒级准时**触发，或进程不保证常驻/会重启，仍需改用外部调度器到期后调用 `event` 节点触发（见 [docs/BUSINESS_SCENARIOS.md](./docs/BUSINESS_SCENARIOS.md) 的 P-11 模式）
- 三者均已接入 `SchemaValidator`、`WorkflowSchema`（Zod/OpenAPI 的唯一事实来源）、`DryRunExecutor` 与节点模板目录
- 字段详情见 [docs/NODE_REFERENCE.md](./docs/NODE_REFERENCE.md) 的 `join`/`transform`/`wait` 章节，业务场景与选型见 [docs/BUSINESS_SCENARIOS.md](./docs/BUSINESS_SCENARIOS.md)

### 12. 数据持久化与外部集成增强

- `FSYNC_ON_WRITE=true` 时，`LocalFileStorage` 写入会 fsync 临时文件和所在目录，换取主机级崩溃/断电下的持久性（代价是写入延迟明显增加）；默认 `false`，仅保证原子 rename 后文件本身完整
- fsync 按集合生效：`instances`/`events`/`waiting`/`workflows*`/`dlq`/`webhooks*` 等系统记录与审计历史会 fsync；`metrics` 与 `heartbeats` **不会**——它们是纯派生的可观测性数据，却占了每节点 3 次写入中的 2 次。代价是主机级崩溃可能丢失最近的 metrics 与 heartbeat，实例状态与事件历史不受影响；需要时用 `LocalFileStorageOptions.fsyncCollections` 显式覆盖
- `createWorkflowRouter()` / `createWorkflowRouterBundle()` 允许宿主 Express 应用将工作流 API 挂载为普通 `express.Router`，无需通过 `startApiServer()` 独立运行；`server.ts` 内部也复用同一套路由装配逻辑
- 高频查找/并发错误改用具名错误类导出（`WorkflowNotFoundError`、`InstanceNotFoundError`、`ConcurrencyConflictError`、`LockAcquisitionError`），支持 `instanceof` 判断而非匹配错误消息字符串
- `HttpNodeConfig`/`SqlNodeConfig`/`QueueNodeConfig`/`ConditionNodeConfig`/`RouterNodeConfig`/`LoopNodeConfig` 等类型与 SQL/Queue 连接池注册函数已从包根重导出，外部消费方无需深入 `dist/src/engine/executors/*`
- 示例见 `examples/embedded-express-app.ts` 与 `examples/error-handling.ts`

## 环境配置

### 开发环境

```bash
LOG_LEVEL=debug
START_API_SERVER=true
STORAGE_TYPE=file
STORAGE_DIR=.ts-workflow-engine-data
```

### 生产环境

```bash
LOG_LEVEL=warn
AUTH_ENABLED=true
JWT_SECRET=strong-secret-key-at-least-32-chars
STORAGE_TYPE=file
STORAGE_DIR=/var/lib/ts-workflow-engine-lite
```

完整配置项及恢复、归档注意事项见 `.env.example`。生产环境应在引擎停止后分别备份 `STORAGE_DIR` 和 `ARCHIVE_DIR`。

## 文档导航

| 文档                                                               | 内容                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [README.md](./README.md)                                           | 项目概述、快速开始                                                         |
| [docs/NODE_REFERENCE.md](./docs/NODE_REFERENCE.md)                 | 15 种节点类型完整字段参考（AI Agent 友好，生成工作流 JSON 前建议先读这份） |
| [docs/BUSINESS_SCENARIOS.md](./docs/BUSINESS_SCENARIOS.md)         | 多节点组合模式与行业业务场景全景图、能力边界与选型清单                     |
| [src/engine/executors/README.md](./src/engine/executors/README.md) | HTTP、SQL、Queue 节点说明                                                  |
| [.env.example](./.env.example)                                     | 环境变量配置                                                               |

## 常见问题

**Q: 如何快速验证安装?**

```bash
pnpm dev:api      # 启动服务
# 另一终端
curl http://localhost:3345/workflow-api/v1/workflows
```

**Q: 如何添加一个新的条件路由?**

使用 `condition` 节点或 `conditionalNext` 字段：

```typescript
{
  type: "condition",
  config: {
    condition: "${amount > 1000}",
    trueBranch: "premium-process",
    falseBranch: "normal-process",
  },
}
```

**Q: 如何支持自定义节点类型?**

参见 `src/engine/executors/README.md` 和 `src/engine/TaskExecutor.ts`。

**Q: 生产环境如何保证数据不丢失?**

使用默认 `LocalFileStorage`，将 `STORAGE_DIR` 放在持久磁盘上，并在引擎停止后定期备份。启用归档时还要单独备份 `ARCHIVE_DIR`。包含函数或闭包的工作流定义需要由应用代码在重启后重新注册，再恢复未完成实例。

本地文件存储是单机进程重启保障，不等同于事务数据库，也没有主从复制或跨进程协调能力。同一个数据目录不能被多个实例共享；需要集群、高可用或分布式存储时应使用外部方案（如 Temporal、Cadence）。

## 性能优化建议

1. **并行执行** - 使用 `next: [node1, node2]` 并行多个节点
2. **并发控制** - 调整 `MAX_CONCURRENT_INSTANCES` 和 `MAX_CONCURRENT_NODES`
3. **资源清理** - 配置合理的 `INSTANCE_TTL_HOURS` 和 `EVENT_RETENTION_DAYS`
4. **日志优化** - 生产环境设置 `LOG_LEVEL=warn`
5. **fsync 取舍** - `FSYNC_ON_WRITE=true` 会让完整节点循环从约 1,500 ops/s 降到约 87 ops/s。只在必须扛住主机级崩溃/断电时开启；普通进程重启由原子 rename 保障，不需要它
6. **查询带上过滤条件** - `queryInstances`/`queryEvents` 在按 `workflowId`/`status`/`parentInstanceId`（事件为 `instanceId`/`eventType`）过滤时走二级索引；不带过滤条件是全量扫描
7. **启动慢时调 `STORAGE_RESTORE_CONCURRENCY`** - 默认 16 对 NVMe 偏保守；实例数上万时 `connect()` 本身就是可用规模的天花板

### 存储层改动注意事项

改 `MemoryStorage`/`LocalFileStorage` 前先读这几条，它们都是有意为之而非疏漏：

- **所有对 `instances`/`events` 的增删只能走 `putInstance`/`dropInstance`/`putEvent`/`dropEvent`**。绕过它们直接 `map.set(...)` 会让二级索引静默失配——查询结果仍然正确（narrowing 之后还会完整过滤一遍），只是索引退化成全表扫描，测不出来也报不了错
- **`updateNodeMetrics` 必须保持"替换而非就地修改"**。持久化路径借用 Map 里的引用当快照，就地修改会让快照在脚下被改掉
- **`peek*` 一律是 `protected`，不要提升到 `StorageProvider` 接口上**。引擎会修改 load 出来的实例，返回活引用会让内存状态在 CAS 校验前就被改掉
- **索引类改动要断言索引本身的规模**，不能只断言查询结果——参见 `src/storage/__tests__/MemoryStorage.indexes.test.ts` 里的 `indexSizesForTest`

## 安全建议

- ✅ 使用 `.env.example` 初始化 `.env`，不提交敏感信息
- ✅ 生产环境启用 JWT 认证（`AUTH_ENABLED=true`）
- ✅ 配置速率限制（`RATE_LIMIT_ENABLED=true`，单进程内存限流）
- ✅ 启用审计日志（`AUDIT_LOG_ENABLED=true`）

## 最后更新

- **日期**: 2026-09-17
- **版本**: 3.0.2
- **维护者**: Sario
- **许可证**: MIT
