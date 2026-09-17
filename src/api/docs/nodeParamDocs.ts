/**
 * 节点参数的说明文案表 + 示例。
 *
 * 类型 / 必填 / 枚举值这些**结构信息**一律从 WorkflowSchema 的 Zod 定义
 * 自动推导（见 params.ts），这里只补 schema 无法携带的**语义**：每个字段
 * 是干什么的、和别的字段什么关系、有什么坑。这样 schema 改了文档结构自动
 * 跟上，不会漂移；漂移只可能发生在"新增字段还没写说明"，而那种情况页面上
 * 会显示"暂无说明"，肉眼可见。
 *
 * 文案来源：docs/NODE_REFERENCE.md。
 */

import type { DescriptionMap } from "./params";

/** 所有节点共享的顶层字段（TaskNode 本身，不是 config）。 */
export const COMMON_FIELD_DESCRIPTIONS: DescriptionMap = {
  id: "节点唯一标识，在同一个 WorkflowDefinition.nodes 内不可重复。",
  type: "节点类型，决定该节点如何执行以及 config 的形状。",
  next: "成功后要执行的下一批节点 ID。传多个 ID 时这些节点并行执行。",
  failureNext: "失败后要执行的节点 ID，用于自定义错误处理分支。",
  timeout:
    "节点超时（毫秒）。wait 节点用它作为等待时长的旧写法，优先级低于 config.durationMs 与 config.until。",
  maxRetries: "最大重试次数，默认 2。",
  retryPolicy: "增强重试策略，形状见 src/model/RetryPolicy.ts。",
  heartbeat: "长时运行 action 节点的心跳配置。",
  "heartbeat.interval": "心跳上报间隔（毫秒）。",
  "heartbeat.timeout": "多久收不到心跳判定任务失联（毫秒）。",
  conditionalNext:
    "条件分支列表，在节点自身逻辑之外按表达式选择后继节点，按顺序匹配第一个命中的。",
  "conditionalNext.condition": "该分支的布尔表达式。",
  "conditionalNext.target": "表达式为真时跳转的节点 ID。",
  defaultNext: "conditionalNext 全部未命中时的兜底节点 ID。",
  taskQueue:
    "仅对 action / rollback 生效：把任务路由到命名队列。队列没有 worker 时回退为本地直接执行。",
  onEvent: "要等待的事件名。event 节点必须提供，否则不会进入等待。",
  rollbackTo: "回滚目标节点 ID，从该节点开始沿补偿链回滚。",
  subworkflowId: "要启动的子工作流 ID，subworkflow 节点必填。",
  subworkflowInput: "传给子工作流的输入映射，值可使用表达式。",
  waitForCompletion:
    "true 时同步等待子工作流结束并取回结果；false 时启动后立即继续，只返回启动信息。",
  inputSchema: "节点输入校验用的 JSON Schema 子集。",
  outputSchema: "节点输出校验用的 JSON Schema 子集。",
  config: "节点特定配置，形状由 type 决定。",
  output:
    "节点执行输出，由引擎在执行后写入，供后续节点用 ${nodeId.output.xxx} 引用。定义工作流时不要手写该字段。",
};

/** 每种节点 config 内部字段的说明，键为点分路径。 */
export const NODE_CONFIG_DESCRIPTIONS: Record<string, DescriptionMap> = {
  wait: {
    durationMs:
      "相对等待时长（毫秒）。与 until 互斥，优先级低于 until、高于顶层 timeout。",
    until: "绝对到期时间（ISO 8601 字符串）。三个等待写法中优先级最高。",
    durable:
      "是否把绝对到期时刻固化到实例状态，默认 true。开启后进程重启只等剩余时长而非重新计时；在 loop 体内需要每轮完整等待时设为 false。",
    externalTimer: "交由外部调度器唤醒的配置，用于要求秒级准时触发的场景。",
    "externalTimer.enabled": "启用外部定时唤醒，引擎自身不再推进该等待。",
    "externalTimer.eventType": "外部调度器到期后用来唤醒本节点的事件名。",
  },
  http: {
    method: "HTTP 请求方法。",
    url: "请求地址，支持 ${} 表达式插值。",
    headers: "请求头键值对，值支持 ${secret:NAME} 密钥占位符。",
    body: "请求体，任意 JSON 可序列化结构，支持表达式插值。",
    timeout: "单次请求超时（毫秒）。",
    retryPolicy: "该 HTTP 请求专用的重试策略，覆盖节点级 maxRetries。",
    "retryPolicy.maxRetries": "最大重试次数。",
    "retryPolicy.backoff": "退避算法：linear 线性递增，exponential 指数递增。",
    "retryPolicy.initialDelay": "首次重试前的等待（毫秒）。",
    followRedirects: "是否自动跟随 3xx 重定向。",
  },
  sql: {
    connection: "已注册的连接池名称，见 registerSqlPool()。",
    query: "要执行的 SQL 语句。务必用 parameters 绑定变量，不要拼接字符串。",
    parameters: "按位置绑定的查询参数，与 SQL 中的占位符一一对应。",
    timeout: "查询超时（毫秒）。",
    database: "数据库方言，影响占位符风格与结果解析。",
  },
  queue: {
    operation: "publish 发布消息，consume 消费消息。",
    queue: "目标队列名。",
    message: "要发布的消息体，operation 为 publish 时使用。",
    timeout: "消费等待超时（毫秒）。",
  },
  condition: {
    condition: "布尔表达式，求值结果决定走哪个分支。",
    trueBranch: "表达式为真时跳转的节点 ID。",
    falseBranch: "表达式为假时跳转的节点 ID。",
  },
  router: {
    routes: "路由规则列表，按数组顺序依次匹配，第一个命中的生效。",
    "routes.condition": "该条路由的布尔表达式。",
    "routes.target": "命中后跳转的节点 ID。",
    "routes.priority": "显式优先级，未设置时以数组顺序为准。",
    defaultTarget: "所有路由都未命中时的兜底节点 ID。建议总是配置。",
  },
  loop: {
    collection: "要遍历的集合表达式，求值结果须为数组。",
    itemVariable: "当前元素在循环体内的变量名。",
    indexVariable: "当前下标的变量名，未设置则不注入下标。",
    body: "每轮迭代要执行的节点 ID。",
    parallel: "是否并行执行各轮迭代，默认串行。",
    maxConcurrency: "并行模式下的最大并发数，用于给下游限流。",
  },
  approval: {
    eventType: "用于唤醒审批的事件名，缺省时使用引擎约定的默认事件。",
    prompt: "展示给审批人的提示文案。",
    approvedTarget: "审批通过后跳转的节点 ID。",
    rejectedTarget: "审批拒绝后跳转的节点 ID。",
    timeoutMs: "审批超时（毫秒），超时后按引擎默认策略处理。",
    requireInstanceIdMatch:
      "要求审批信号携带的 instanceId 与当前实例一致，防止串审。",
  },
  notification: {
    channel: "通知渠道。内置枚举之外也接受自定义渠道名。",
    target: "接收方标识，含义随渠道而定（频道、邮箱、Webhook URL 等）。",
    template: "消息模板，支持 ${} 表达式插值。",
    subject: "标题，邮件等有标题概念的渠道使用。",
    severity: "严重级别，供下游做分级告警与路由。",
    data: "模板渲染时可引用的附加数据。",
  },
  join: {
    waitFor: "要等待的分支节点 ID 列表，至少一个。",
    mode: "all 等全部分支完成（默认），any 任一分支完成即继续。",
  },
  transform: {
    output:
      "字段名到表达式的映射。表达式会被求值而非字符串插值，数字/数组/对象保持原生类型。",
  },
};

/** 无声明式 config 的节点类型，改用说明段落而不是空参数表。 */
export const NO_CONFIG_NOTES: Record<string, string> = {
  action:
    "action 节点没有声明式 config：它通过顶层 <code>action</code> 字段引用一个已注册的函数，或用 <code>config.action</code> 传函数注册名。函数在运行时携带 JS 闭包，无法用 JSON Schema 表达。",
  event:
    "event 节点没有 config：要等待的事件名写在顶层 <code>onEvent</code> 字段上。未提供 <code>onEvent</code> 时节点不会进入等待。",
  rollback:
    "rollback 节点与 action 同语义，没有声明式 config；通常配合顶层 <code>rollbackTo</code> 指定回滚起点。",
  subworkflow:
    "subworkflow 节点没有 config：用顶层 <code>subworkflowId</code>、<code>subworkflowInput</code>、<code>waitForCompletion</code> 三个字段配置。",
};

/** 节点输出形状说明，渲染在"输出"区。 */
export const NODE_OUTPUT_DESCRIPTIONS: Record<string, DescriptionMap> = {
  action: { "": "函数的返回值原样写入 output。" },
  wait: {
    waited: "实际等待的毫秒数。",
    deadline: "到期时间戳（毫秒）。",
  },
  event: { "": "收到的事件 payload 原样写入 output。" },
  http: {
    status: "HTTP 响应状态码。",
    headers: "响应头。",
    body: "响应体，JSON 响应会被解析为对象。",
  },
  sql: {
    rows: "查询返回的行数组。",
    rowCount: "受影响或返回的行数。",
  },
  queue: {
    messageId: "发布确认返回的消息 ID。",
    message: "消费模式下取到的消息。",
  },
  condition: {
    result: "条件表达式的布尔求值结果。",
    branch: "实际选中的分支节点 ID。",
  },
  router: {
    matched: "命中的路由下标，未命中任何路由时为 -1。",
    target: "实际跳转的节点 ID。",
  },
  loop: {
    results: "每轮迭代结果组成的数组。",
    count: "实际迭代次数。",
  },
  approval: {
    decision: "审批结果：approved 或 rejected。",
    approver: "审批人标识。",
    comment: "审批备注。",
  },
  notification: {
    delivered: "是否发送成功。",
    response: "渠道返回的原始响应。",
  },
  join: {
    results:
      "已完成分支的输出，键为分支节点 ID。用 ${joinId.output.results.branchId} 引用；分支 ID 必须是合法标识符（不能含连字符），表达式引擎不支持下标访问。",
    missing:
      "join 执行时尚无输出的 waitFor 节点 ID。mode 为 all 时非空即直接失败，所以只有 any 模式或上游路由跳过分支时才会非空。",
  },
  transform: {
    "": "按 config.output 映射求值后生成的新对象，字段类型保持原生类型。",
  },
};

/** 每个节点的完整定义示例（JSON）与输出示例。 */
export const NODE_EXAMPLES: Record<
  string,
  { definition: string; output: string }
> = {
  action: {
    definition: `{
  "id": "validate-order",
  "type": "action",
  "action": "validateOrder",
  "maxRetries": 3,
  "next": ["charge"]
}`,
    output: `{
  "valid": true,
  "orderId": "ord_8412",
  "amount": 199.99
}`,
  },
  wait: {
    definition: `{
  "id": "autoConfirmReceipt",
  "type": "wait",
  "config": {
    "durationMs": 604800000,
    "durable": true
  },
  "next": ["confirmReceipt"]
}`,
    output: `{
  "waited": 604800000,
  "deadline": 1760438400000
}`,
  },
  event: {
    definition: `{
  "id": "await-payment",
  "type": "event",
  "onEvent": "order.paid",
  "timeout": 1800000,
  "next": ["ship"]
}`,
    output: `{
  "orderId": "ord_8412",
  "paidAt": "2026-09-17T08:21:04Z",
  "channel": "alipay"
}`,
  },
  rollback: {
    definition: `{
  "id": "release-stock",
  "type": "rollback",
  "rollbackTo": "reserve-stock",
  "action": "releaseStock"
}`,
    output: `{
  "released": true,
  "sku": "SKU-221",
  "qty": 2
}`,
  },
  subworkflow: {
    definition: `{
  "id": "run-payment",
  "type": "subworkflow",
  "subworkflowId": "payment-flow",
  "subworkflowInput": {
    "orderId": "\${validate-order.output.orderId}"
  },
  "waitForCompletion": true,
  "next": ["ship"]
}`,
    output: `{
  "instanceId": "inst_7f2a",
  "status": "completed",
  "output": { "transactionId": "tx_5591" }
}`,
  },
  http: {
    definition: `{
  "id": "fetch-user",
  "type": "http",
  "config": {
    "method": "GET",
    "url": "https://api.example.com/users/\${context.userId}",
    "headers": {
      "Authorization": "Bearer \${secret:API_TOKEN}"
    },
    "timeout": 5000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoff": "exponential",
      "initialDelay": 200
    }
  },
  "next": ["score"]
}`,
    output: `{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { "id": "u_1", "name": "Ada", "tier": "gold" }
}`,
  },
  sql: {
    definition: `{
  "id": "load-orders",
  "type": "sql",
  "config": {
    "connection": "default",
    "query": "SELECT id, amount FROM orders WHERE user_id = $1",
    "parameters": ["\${context.userId}"],
    "database": "postgres",
    "timeout": 3000
  },
  "next": ["aggregate"]
}`,
    output: `{
  "rows": [
    { "id": "ord_8412", "amount": 199.99 },
    { "id": "ord_8419", "amount": 42.50 }
  ],
  "rowCount": 2
}`,
  },
  queue: {
    definition: `{
  "id": "emit-receipt",
  "type": "queue",
  "config": {
    "operation": "publish",
    "queue": "receipts",
    "message": {
      "orderId": "\${validate-order.output.orderId}"
    }
  },
  "next": ["done"]
}`,
    output: `{
  "messageId": "msg_0c41",
  "queue": "receipts"
}`,
  },
  condition: {
    definition: `{
  "id": "check-amount",
  "type": "condition",
  "config": {
    "condition": "\${validate-order.output.amount > 1000}",
    "trueBranch": "premium-process",
    "falseBranch": "normal-process"
  }
}`,
    output: `{
  "result": false,
  "branch": "normal-process"
}`,
  },
  router: {
    definition: `{
  "id": "route-by-tier",
  "type": "router",
  "config": {
    "routes": [
      { "condition": "\${context.tier == 'gold'}", "target": "vip-lane" },
      { "condition": "\${context.amount > 500}", "target": "review-lane" }
    ],
    "defaultTarget": "standard-lane"
  }
}`,
    output: `{
  "matched": 0,
  "target": "vip-lane"
}`,
  },
  loop: {
    definition: `{
  "id": "process-items",
  "type": "loop",
  "config": {
    "collection": "\${load-orders.output.rows}",
    "itemVariable": "order",
    "indexVariable": "i",
    "body": "handle-order",
    "parallel": true,
    "maxConcurrency": 4
  },
  "next": ["summarize"]
}`,
    output: `{
  "results": [{ "ok": true }, { "ok": true }],
  "count": 2
}`,
  },
  approval: {
    definition: `{
  "id": "manager-approval",
  "type": "approval",
  "config": {
    "prompt": "请审批这笔超额支出",
    "approvedTarget": "disburse",
    "rejectedTarget": "notify-rejection",
    "timeoutMs": 86400000,
    "requireInstanceIdMatch": true
  }
}`,
    output: `{
  "decision": "approved",
  "approver": "u_manager_3",
  "comment": "预算内，同意"
}`,
  },
  notification: {
    definition: `{
  "id": "alert-ops",
  "type": "notification",
  "config": {
    "channel": "slack",
    "target": "#alerts",
    "template": "订单 \${context.orderId} 处理失败",
    "severity": "critical"
  },
  "next": ["done"]
}`,
    output: `{
  "delivered": true,
  "response": { "ts": "1726560064.000100" }
}`,
  },
  join: {
    definition: `{
  "id": "wait-both",
  "type": "join",
  "config": {
    "waitFor": ["fetchProfile", "fetchCredit"],
    "mode": "all"
  },
  "next": ["decide"]
}`,
    output: `{
  "results": {
    "fetchProfile": { "name": "Ada" },
    "fetchCredit": { "score": 780 }
  },
  "missing": []
}`,
  },
  transform: {
    definition: `{
  "id": "build-payload",
  "type": "transform",
  "config": {
    "output": {
      "total": "\${load-orders.output.rows | sum}",
      "userName": "\${fetch-user.output.body.name}",
      "isVip": "\${fetch-user.output.body.tier == 'gold'}"
    }
  },
  "next": ["emit"]
}`,
    output: `{
  "total": 242.49,
  "userName": "Ada",
  "isVip": true
}`,
  },
};

/** 侧栏分组，按职责而不是按字母序排列。 */
export const NODE_NAV_GROUPS: { title: string; types: string[] }[] = [
  { title: "基础执行", types: ["action", "wait", "event", "rollback"] },
  { title: "外部集成", types: ["http", "sql", "queue", "notification"] },
  { title: "流程控制", types: ["condition", "router", "loop", "join"] },
  { title: "编排与数据", types: ["subworkflow", "approval", "transform"] },
];
