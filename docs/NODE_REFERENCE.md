# 节点类型参考手册（AI Agent 友好版）

本文档面向需要**生成合法工作流 JSON/TypeScript 定义**的开发者与 AI 编码助手，
不依赖阅读源码即可正确构造任意节点类型。

> 权威类型定义：[`src/model/Workflow.ts`](../src/model/Workflow.ts)（`TaskNode` / `WorkflowDefinition`）
> 以及各执行器文件 `src/engine/executors/*.ts`。本文档是这些类型的结构化速查表；
> 若两者冲突，以源码为准。

## 目录

- [通用字段（所有节点共享）](#通用字段所有节点共享)
- [节点类型速查表](#节点类型速查表)
- [1. action](#1-action)
- [2. wait](#2-wait)
- [3. event](#3-event)
- [4. rollback](#4-rollback)
- [5. subworkflow](#5-subworkflow)
- [6. http](#6-http)
- [7. sql](#7-sql)
- [8. queue](#8-queue)
- [9. condition](#9-condition)
- [10. router](#10-router)
- [11. loop](#11-loop)
- [12. approval](#12-approval)
- [13. notification](#13-notification)
- [14. join](#14-join)
- [15. transform](#15-transform)
- [表达式语法速查](#表达式语法速查)
- [常见错误](#常见错误)

---

## 通用字段（所有节点共享）

每个 `TaskNode`（无论 `type` 为何）都可以携带以下顶层字段：

| 字段           | 类型                                          | 必填       | 说明                                                                                                       |
| -------------- | --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                                      | ✅         | 节点唯一标识，同一 `WorkflowDefinition.nodes` 内不可重复                                                   |
| `type`         | `TaskType`                                    | ✅         | 见下方 15 种类型                                                                                           |
| `next`         | `string[]`                                    | ❌         | 成功后要执行的下一批节点 ID（并行执行）                                                                    |
| `failureNext`  | `string[]`                                    | ❌         | 失败后要执行的节点 ID，用于自定义错误处理流程                                                              |
| `timeout`      | `number`                                      | ❌         | 节点超时（毫秒）；`wait` 节点用它作为等待时长的**旧写法**（优先级低于 `config.durationMs`/`config.until`） |
| `maxRetries`   | `number`                                      | ❌         | 最大重试次数，默认 2                                                                                       |
| `retryPolicy`  | `RetryPolicy`                                 | ❌         | 增强重试策略（见 [`RetryPolicy.ts`](../src/model/RetryPolicy.ts)）                                         |
| `heartbeat`    | `{ interval?, timeout?, onHeartbeat? }`       | ❌         | 长时运行 action 节点的心跳配置                                                                             |
| `taskQueue`    | `string`                                      | ❌         | 仅对 `action`/`rollback` 生效：路由到命名任务队列，无 worker 时回退本地执行                                |
| `inputSchema`  | `Record<string, unknown>`（JSON Schema 子集） | ❌         | 节点输入校验                                                                                               |
| `outputSchema` | `Record<string, unknown>`（JSON Schema 子集） | ❌         | 节点输出校验                                                                                               |
| `config`       | `Record<string, unknown>`                     | 视类型而定 | 节点特定配置，具体形状见下文各节点章节                                                                     |
| `output`       | `unknown`                                     | 运行时写入 | 节点执行输出，供后续节点通过 `${nodeId.output.xxx}` 引用                                                   |

> **不要手写 `output` 字段** —— 它由引擎在执行后写入，定义工作流时不需要提供。

---

## 节点类型速查表

| type           | 需要 `config`？                   | 需要其他顶层字段？                                                | 典型用途                          |
| -------------- | --------------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `action`       | 可选                              | `action`（函数）或 `config.action`（字符串）                      | 自定义业务逻辑                    |
| `wait`         | ✅ `WaitNodeConfig`（可选）       | `timeout`（三者互斥优先级最低，均缺省则不触发等待）               | 延时/定时等待                     |
| `event`        | ❌                                | `onEvent`（必填才会触发等待）                                     | 等待外部事件                      |
| `rollback`     | 可选                              | 与 `action` 相同语义，通常配合 `rollbackTo`                       | 补偿/回滚逻辑                     |
| `subworkflow`  | ❌                                | `subworkflowId` 必填，`subworkflowInput`/`waitForCompletion` 可选 | 调用子工作流                      |
| `http`         | ✅ `HttpNodeConfig`               | -                                                                 | 发起 HTTP 请求                    |
| `sql`          | ✅ `SqlNodeConfig`                | -                                                                 | 执行 SQL 查询                     |
| `queue`        | ✅ `QueueNodeConfig`              | -                                                                 | 消息队列发布/消费                 |
| `condition`    | ✅ `ConditionNodeConfig`          | -                                                                 | 二分支路由                        |
| `router`       | ✅ `RouterNodeConfig`             | -                                                                 | 多分支路由                        |
| `loop`         | ✅ `LoopNodeConfig`               | -                                                                 | 遍历集合执行子节点                |
| `approval`     | ✅ `ApprovalNodeConfig`（均可选） | -                                                                 | 人工审批                          |
| `notification` | ✅ `NotificationNodeConfig`       | -                                                                 | 发送通知（Slack/邮件/Webhook 等） |
| `join`         | ✅ `JoinNodeConfig`               | -                                                                 | 等待多个并行分支汇聚              |
| `transform`    | ✅ `TransformNodeConfig`          | -                                                                 | 按表达式重塑/合并节点输出         |

---

## 1. action

最通用的节点类型，执行任意业务逻辑。

**执行语义**（见 [`controlNodes.ts`](../src/engine/nodeDispatch/controlNodes.ts)）：

1. 若提供了顶层 `action` 函数（`(instance?: WorkflowInstance) => Promise<any>`），直接调用它。
2. 否则若 `config.action` 是字符串，会作为函数体在沙箱中执行：
   `(function(instance) { <config.action> })(context.instance)`，超时 5000ms。
3. 都没有时，默认返回 `{ status: "completed", timestamp: <ISO时间戳> }`。

**JSON 定义示例**（config.action 字符串形式，适合从 JSON 直接生成，无需运行时注入函数）：

```json
{
  "id": "log-step",
  "type": "action",
  "config": {
    "action": "return { greeted: instance.context.name };"
  },
  "next": ["next-node"]
}
```

**TypeScript 定义示例**（顶层 `action` 函数形式，需要代码运行时注册）：

```typescript
{
  id: "validate-order",
  type: "action",
  action: async (instance) => {
    const amount = instance?.context?.amount ?? 0;
    return { valid: amount > 0, amount };
  },
  next: ["charge-payment"],
  failureNext: ["notify-failure"],
}
```

**长时任务 + 心跳**：

```typescript
{
  id: "long-task",
  type: "action",
  action: async (instance) => { /* ... */ },
  heartbeat: { interval: 5000, timeout: 60000 },
}
```

---

## 2. wait

延时指定毫秒数，或等到指定的绝对时间点后继续。`config` 类型为 `WaitNodeConfig`（可选，两个字段都可选）：

```typescript
export interface WaitNodeConfig {
  durationMs?: number; // 相对等待时长（毫秒）
  until?: string; // 绝对到期时间（ISO 8601 字符串）
}
```

**取值优先级**：`config.until` > `config.durationMs` > 顶层 `timeout`（旧写法，仍受支持）。三者都缺省时节点不会触发等待逻辑，直接走 `next`。

```json
{
  "id": "cooldown",
  "type": "wait",
  "config": { "durationMs": 30000 },
  "next": ["resume"]
}
```

```json
{
  "id": "wait-until-midnight",
  "type": "wait",
  "config": { "until": "2026-10-01T00:00:00Z" },
  "next": ["resume"]
}
```

输出：`{ waited: <实际等待毫秒数>, deadline: <到期时间戳(ms)> }`，可通过 `${cooldown.output.waited}` 引用。

> **不是崩溃安全的长等待**：等待基于进程内 `setTimeout` 实现，进程重启会丢失未到期的等待。需要跨重启存活的长延时（例如"3 天后提醒"）目前不受支持，请改用外部调度器在到期后调用 API 触发事件（`event` 节点）。

---

## 3. event

暂停工作流，直到收到指定事件名。

**关键字段**：`onEvent`（**顶层字段，非 config**），事件名字符串。

```json
{
  "id": "wait-for-payment",
  "type": "event",
  "onEvent": "payment.completed",
  "next": ["fulfill-order"]
}
```

事件到达后由 `WorkflowEngine` 统一恢复调度，无需在节点内额外配置。

---

## 4. rollback

与 `action` 复用完全相同的执行语义（同一分发分支），通常用于补偿逻辑，配合顶层字段
`rollbackTo`（回滚跳转目标节点 ID）使用。

```json
{
  "id": "refund-payment",
  "type": "rollback",
  "config": {
    "action": "return { refunded: true };"
  },
  "rollbackTo": "order-cancelled"
}
```

---

## 5. subworkflow

调用另一个已注册的工作流作为子流程。**不使用 `config`**，直接用顶层字段：

| 字段                | 类型                     | 必填 | 说明                         |
| ------------------- | ------------------------ | ---- | ---------------------------- |
| `subworkflowId`     | `string`                 | ✅   | 目标工作流 ID                |
| `subworkflowInput`  | `Record<string, string>` | ❌   | 输入参数映射（值支持表达式） |
| `waitForCompletion` | `boolean`                | ❌   | 是否等待子工作流执行完成     |

```json
{
  "id": "run-billing-subflow",
  "type": "subworkflow",
  "subworkflowId": "billing-workflow-v1",
  "subworkflowInput": {
    "orderId": "${validate-order.output.orderId}",
    "amount": "${validate-order.output.amount}"
  },
  "waitForCompletion": true,
  "next": ["after-billing"]
}
```

> 注意：`subworkflow` 节点必须由 `ExecutionOrchestrator`/`SubworkflowExecutor` 路径调度，
> 不能直接调用 `TaskExecutor.execute()`，否则会抛错。正常通过 `engine.start()` 触发的工作流无需关心这一点。

---

## 6. http

发起 HTTP 请求。`config` 类型为 `HttpNodeConfig`：

```typescript
export interface HttpNodeConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS"; // 必填
  url: string; // 必填，支持表达式
  headers?: Record<string, string>; // 值支持表达式
  body?: any; // 支持表达式
  timeout?: number; // 毫秒
  retryPolicy?: {
    maxRetries: number; // 必填（若提供 retryPolicy）
    backoff: "linear" | "exponential"; // 必填（若提供 retryPolicy）
    initialDelay?: number; // 默认 1000ms
  };
  followRedirects?: boolean; // 默认 true
  validateStatus?: (status: number) => boolean; // 仅代码内可用，JSON 中不可序列化
}
```

**输出** `HttpNodeOutput`：`{ status, statusText, headers, body, duration }`

```json
{
  "id": "fetch-data",
  "type": "http",
  "config": {
    "method": "GET",
    "url": "https://api.example.com/data/${context.userId}",
    "headers": { "Authorization": "Bearer ${context.token}" },
    "timeout": 5000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential",
      "initialDelay": 1000
    }
  },
  "next": ["process-data"]
}
```

---

## 7. sql

执行 SQL 查询，需先通过 `registerSqlConnectionPool(name, pool)` 注册连接池
（见 [`executors/README.md`](../src/engine/executors/README.md)）。`config` 类型为 `SqlNodeConfig`：

```typescript
export interface SqlNodeConfig {
  connection: string; // 必填，对应已注册的连接池名
  query: string; // 必填，支持表达式
  parameters?: unknown[]; // 参数化查询值，支持表达式
  timeout?: number;
  database?: "postgres" | "mysql" | "sqlite" | "mssql" | "generic";
}
```

**输出** `SqlNodeOutput`：`{ rows, rowCount, duration }`

```json
{
  "id": "query-user",
  "type": "sql",
  "config": {
    "connection": "main-db",
    "query": "SELECT * FROM users WHERE id = $1",
    "parameters": ["${context.userId}"],
    "database": "postgres"
  },
  "next": ["use-user-data"]
}
```

> ⚠️ 务必使用参数化查询（`parameters`），不要把用户输入直接拼进 `query` 字符串。

---

## 8. queue

消息队列发布/消费，需先通过 `registerQueueProvider(name, provider)` 注册。`config` 类型为 `QueueNodeConfig`：

```typescript
export interface QueueNodeConfig {
  operation: "publish" | "consume"; // 必填
  queue: string; // 必填，支持表达式
  message?: unknown; // publish 时使用，支持表达式
  timeout?: number; // consume 超时（毫秒）
}
```

**输出** `QueueNodeOutput`：`{ messageId?, message? }`

```json
{
  "id": "publish-event",
  "type": "queue",
  "config": {
    "operation": "publish",
    "queue": "order-events",
    "message": { "orderId": "${validate-order.output.orderId}" }
  },
  "next": ["done"]
}
```

> 与 `taskQueue`（TaskQueueManager 的进程内工作分发）不同：`queue` 节点对接**外部消息中间件**。

---

## 9. condition

二分支路由，基于单个布尔表达式。`config` 类型为 `ConditionNodeConfig`：

```typescript
export interface ConditionNodeConfig {
  condition: string; // 必填，必须求值为 boolean
  trueBranch: string; // 必填，条件为真时跳转的节点 ID
  falseBranch: string; // 必填，条件为假时跳转的节点 ID
}
```

**输出** `ConditionNodeOutput`：`{ result: boolean, branch: "true" | "false" }`

```json
{
  "id": "check-amount",
  "type": "condition",
  "config": {
    "condition": "${validate-order.output.amount > 1000}",
    "trueBranch": "premium-process",
    "falseBranch": "normal-process"
  }
}
```

> 也可以用顶层字段 `conditionalNext: [{ condition, target }]` + `defaultNext` 实现类似逻辑，
> 二者是两套独立机制，不要混用同一节点。

---

## 10. router

多分支路由，按优先级依次求值多个条件。`config` 类型为 `RouterNodeConfig`：

```typescript
export interface RouterRoute {
  condition: string; // 必填，需返回 boolean
  target: string; // 必填，匹配时跳转的节点 ID
  priority?: number; // 数字越小优先级越高
}

export interface RouterNodeConfig {
  routes: RouterRoute[]; // 必填，至少 1 条
  defaultTarget?: string; // 所有条件都不满足时的兜底节点
}
```

**输出** `RouterNodeOutput`：`{ matchedRoute: number /* -1 表示走了 default */, target: string }`

```json
{
  "id": "route-by-tier",
  "type": "router",
  "config": {
    "routes": [
      {
        "condition": "${context.tier == 'gold'}",
        "target": "gold-flow",
        "priority": 1
      },
      {
        "condition": "${context.tier == 'silver'}",
        "target": "silver-flow",
        "priority": 2
      }
    ],
    "defaultTarget": "standard-flow"
  }
}
```

---

## 11. loop

遍历集合，对每个元素执行指定的 `body` 节点。`config` 类型为 `LoopNodeConfig`：

```typescript
export interface LoopNodeConfig {
  collection: string; // 必填，返回数组的表达式
  itemVariable: string; // 必填，当前元素的变量名，如 "item"
  indexVariable?: string; // 索引变量名，如 "index"
  body: string; // 必填，每次迭代要执行的节点 ID
  parallel?: boolean; // 默认 false（顺序执行）
  maxConcurrency?: number; // parallel=true 时的最大并发数，默认不限制
}
```

**输出** `LoopNodeOutput`：`{ iterations: number, results: any[], duration: number }`

```json
{
  "id": "process-items",
  "type": "loop",
  "config": {
    "collection": "${context.items}",
    "itemVariable": "item",
    "indexVariable": "index",
    "body": "process-single-item",
    "parallel": true,
    "maxConcurrency": 5
  },
  "next": ["all-done"]
}
```

> 单个 loop 节点最大迭代次数受环境变量 `MAX_LOOP_ITERATIONS` 限制（默认 10000）。

---

## 12. approval

暂停等待人工审批信号（`approval_response`）。`config` 类型为 `ApprovalNodeConfig`（**所有字段均可选**）：

```typescript
export interface ApprovalNodeConfig {
  eventType?: string; // 审批请求事件类型，默认 "approval:requested"
  prompt?: string; // 展示给审批人的提示文案
  approvedTarget?: string; // 批准后跳转节点 ID
  rejectedTarget?: string; // 拒绝后跳转节点 ID
  timeoutMs?: number; // 等待超时
  requireInstanceIdMatch?: boolean; // 是否要求 signal 携带匹配的 instanceId
}
```

**输出** `ApprovalNodeOutput`：`{ approved, approver?, comment?, timedOut, nextNode }`

```json
{
  "id": "manager-approval",
  "type": "approval",
  "config": {
    "prompt": "请审批订单 ${context.orderId} 的退款申请",
    "approvedTarget": "process-refund",
    "rejectedTarget": "reject-refund",
    "timeoutMs": 86400000
  }
}
```

---

## 13. notification

发送通知消息（Slack/飞书/钉钉/邮件/Webhook 等）。`config` 类型为 `NotificationNodeConfig`：

```typescript
export interface NotificationNodeConfig {
  channel: "slack" | "feishu" | "dingtalk" | "email" | "webhook" | string; // 必填
  target: string; // 必填，如频道 ID / 邮箱地址 / Webhook URL
  template: string; // 必填，消息正文模板，支持表达式插值
  subject?: string; // 邮件等渠道的主题
  severity?: "info" | "warning" | "critical";
  data?: Record<string, unknown>; // 模板可用的附加数据
}
```

```json
{
  "id": "notify-team",
  "type": "notification",
  "config": {
    "channel": "slack",
    "target": "#ops-alerts",
    "template": "订单 ${context.orderId} 处理失败：${context.error}",
    "severity": "critical"
  }
}
```

---

## 14. join

等待多个并行分支（`next` 扇出）全部或任一完成后再继续。`config` 类型为 `JoinNodeConfig`：

```typescript
export interface JoinNodeConfig {
  waitFor: string[]; // 必填，要等待的节点 ID 列表（非空）
  mode?: "all" | "any"; // 默认 "all"："all" 要求全部完成，"any" 任一完成即可
}
```

**工作原理**：引擎按批次顺序执行同一次 `next` 扇出中的所有节点，再统一推进到下一批 —— 也就是说 `waitFor` 里列出的分支只要都在同一次扇出中，`join` 节点执行时它们必然已经全部完成。`join` 只是从 `instance.state.nodes` 里读取这些分支的已有输出并做校验，不涉及跨进程锁或额外并发控制。

`mode: "all"`（默认）时，若 `waitFor` 中有节点没有输出（例如被错误路由跳过），`join` 节点会**直接失败**（可配合 `failureNext`/`retryPolicy` 处理）。`mode: "any"` 时，只要至少一个分支有输出就成功，未完成的分支会出现在输出的 `missing` 里。

```json
{
  "id": "fanout",
  "type": "action",
  "next": ["fetchInventory", "fetchPricing"]
},
{
  "id": "fetchInventory",
  "type": "http",
  "config": { "method": "GET", "url": "https://api.example.com/inventory" },
  "next": ["merge"]
},
{
  "id": "fetchPricing",
  "type": "http",
  "config": { "method": "GET", "url": "https://api.example.com/pricing" },
  "next": ["merge"]
},
{
  "id": "merge",
  "type": "join",
  "config": { "waitFor": ["fetchInventory", "fetchPricing"], "mode": "all" },
  "next": ["build-response"]
}
```

**输出** `JoinNodeOutput`：`{ results: { [nodeId]: 该节点的 output }, missing: string[] }`，可通过 `${merge.output.results.fetchInventory}` 引用某个分支的输出（注意 `results` 是以节点 ID 为 key 的对象 —— 表达式引擎**不支持** `[...]` 下标访问，只支持点号访问合法标识符，所以 `waitFor` 里的节点 ID 要避免连字符等非标识符字符，见下方表达式语法说明）。

---

## 15. transform

按表达式重塑/合并前序节点的输出，生成新的输出对象。`config` 类型为 `TransformNodeConfig`：

```typescript
export interface TransformNodeConfig {
  output: Record<string, string>; // 字段名 -> 表达式
}
```

**与字符串插值的区别**：`http`/`sql`/`template` 等字段里的 `${...}` 是**字符串插值**（结果会被转成字符串拼进模板）；`transform.config.output` 的每个字段值是**直接交给表达式引擎求值**，结果保留原始类型（数字、布尔、数组、对象都不会被字符串化）。字面量字符串需要在表达式内自己加引号，否则会被当成非法表达式：

```json
{ "output": { "label": "'order total'" } }
```

```json
{
  "id": "reshape-order",
  "type": "transform",
  "config": {
    "output": {
      "total": "${priceNode.output.price * priceNode.output.qty}",
      "currency": "${priceNode.output.currency}",
      "isHighValue": "${priceNode.output.price * priceNode.output.qty > 1000}"
    }
  },
  "next": ["send-confirmation"]
}
```

输出：`config.output` 求值后的对象本身（无额外包装），可通过 `${reshape-order.output.total}` 引用。

**典型用途**：workflow 全部是纯 JSON 定义（无 `action` 闭包）时，用 `transform` 做数据整形/字段映射，替代原本只能靠 `action` 函数才能做的重塑逻辑 —— 保持工作流可序列化，支持本地文件存储重启恢复（见项目 README 关于 action 节点闭包不可序列化的说明）。

---

## 表达式语法速查

节点配置中的字符串字段（`url`、`condition`、`query`、`template` 等）支持 `${...}` 表达式插值，
实现见 [`ExpressionEvaluator.ts`](../src/engine/ExpressionEvaluator.ts)。

**引用前序节点输出**：

```
${nodeId.output.fieldName}
${node1.output.price * 0.8}
```

**引用工作流上下文/启动输入**：

```
${context.userId}
```

**比较与逻辑运算**：`==`、`!=`、`>`、`<`、`>=`、`<=`、`&&`、`||`、`!`

**内置函数（20+，均可在表达式内直接调用）**：

| 分类   | 函数                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 数学   | `abs, ceil, floor, round(x, decimals?), min, max, sqrt, pow`                                |
| 字符串 | `length, substring, toLowerCase, toUpperCase, trim, concat, includes, startsWith, endsWith` |
| 集合   | `map, filter, reduce, find, some, every, flat, flatMap, join`                               |
| 日期   | `now, addDays, addHours, format, parse`                                                     |

自定义函数可通过 `registerFunction(name, fn)`（见 [`functions/customFunctions.ts`](../src/engine/functions/customFunctions.ts)）注册后在表达式中使用。

---

## 常见错误

| 错误写法                                                            | 问题                                                                                                          | 正确写法                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `wait` 节点把超时写进 `config.timeout`                              | `wait` 用**顶层** `timeout` 字段，`config` 不生效                                                             | `{ "type": "wait", "timeout": 5000 }`                             |
| `event` 节点把事件名写进 `config.event`                             | `event` 用**顶层** `onEvent` 字段                                                                             | `{ "type": "event", "onEvent": "order.paid" }`                    |
| `subworkflow` 节点塞了 `config: { subworkflowId: ... }`             | `subworkflow` 相关字段都是**顶层字段**，不在 `config` 里                                                      | `{ "type": "subworkflow", "subworkflowId": "..." }`               |
| SQL 节点直接拼接用户输入到 `query`                                  | SQL 注入风险                                                                                                  | 使用 `parameters` 做参数化查询                                    |
| `condition`/`router` 表达式没有返回 boolean                         | 分支不会按预期跳转                                                                                            | 确保 `condition` 表达式结果是布尔值                               |
| 手动设置节点的 `output` 字段                                        | 会被引擎执行结果覆盖，无意义                                                                                  | 不要在定义中写 `output`，只在下游用 `${nodeId.output.x}` 读取     |
| `transform.config.output` 里写纯文本 `"order total"`                | 不是合法表达式语法（两个裸标识符），节点执行失败                                                              | 字符串字面量要加引号：`"'order total'"`                           |
| `join.config.waitFor` 里的节点不在同一次 `next` 扇出中              | 该分支可能尚未执行，`mode: "all"` 下 `join` 会失败                                                            | 确保 `waitFor` 列出的节点都来自同一个上游节点的 `next` 数组       |
| 节点 ID 含连字符（如 `fetch-inventory`）后在表达式里引用            | 表达式标识符只支持 `[a-zA-Z0-9_.]`，且**不支持** `[...]` 下标访问，连字符会被解析成减法导致语法错误或错误结果 | 节点 ID 避免使用连字符，用驼峰或下划线命名（如 `fetchInventory`） |
| `wait` 节点同时设了 `timeout` 和 `config.durationMs`/`config.until` | 不会报错，但 `config` 会静默覆盖 `timeout`                                                                    | 只设置其中一种写法，避免歧义                                      |
| `http.retryPolicy` 只写了 `maxRetries` 缺 `backoff`                 | `backoff` 是必填子字段                                                                                        | `{ "maxRetries": 3, "backoff": "exponential" }`                   |
