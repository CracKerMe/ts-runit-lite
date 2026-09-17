/** 节点类型的统一文档目录：首页卡片与概念文档均从此处生成。 */
export interface NodeDocInfo {
  type: string;
  label: string;
  shortDescription: string;
  intro: string;
  fields: string;
  useCase: string;
  output: string;
  notes: string;
  example: string;
  commonParams: string;
  requiredParams: string;
  optionalParams: string;
}

const node = (
  type: string,
  label: string,
  shortDescription: string,
  intro: string,
  fields: string,
  useCase: string,
  output: string,
  notes: string,
  example: string,
): NodeDocInfo => ({
  type,
  label,
  shortDescription,
  intro,
  fields,
  useCase,
  output,
  notes,
  example,
  commonParams:
    "id：节点唯一标识；type：节点类型；next：成功后的下一个节点；retry：失败重试策略。",
  requiredParams: "无固定必填字段",
  optionalParams: "无固定选填字段",
});

export const NODE_DOCS: NodeDocInfo[] = [
  node(
    "action",
    "动作 Action",
    "执行自定义函数逻辑",
    "执行注册的自定义函数。",
    "函数注册名；无固定声明式 config。",
    "校验、领域规则、内部服务调用。",
    "函数返回值写入 output。",
    "保持幂等，副作用配合重试/补偿。",
    '{ type: "action", function: "validateOrder" }',
  ),
  node(
    "wait",
    "等待 Wait",
    "延时或等待指定时长",
    "按时长、截止时间或信号暂停流程。",
    "durationMs、until；兼容 timeout。",
    "延时、定时、等待外部回执。",
    "唤醒后沿 next 继续。",
    "等待状态会持久化。",
    '{ type: "wait", config: { durationMs: 5000 } }',
  ),
  node(
    "event",
    "事件 Event",
    "等待外部事件触发后继续",
    "等待指定名称的外部事件。",
    "onEvent、事件 payload。",
    "支付回调、Webhook、异步完成事件。",
    "输出事件 payload。",
    "事件名建议带业务命名空间。",
    '{ type: "event", config: { onEvent: "order.paid" } }',
  ),
  node(
    "rollback",
    "回滚 Rollback",
    "执行补偿/回滚逻辑",
    "执行前序节点的补偿逻辑。",
    "rollbackTo。",
    "库存、支付、资源预留补偿。",
    "产生补偿结果并沿回滚链继续。",
    "不是数据库事务回滚，补偿需可重试。",
    '{ type: "rollback", rollbackTo: "reserve-stock" }',
  ),
  node(
    "subworkflow",
    "子工作流 Subworkflow",
    "调用另一个工作流定义",
    "启动另一个已注册工作流。",
    "subworkflowId、waitForCompletion。",
    "复用审批、履约等复杂流程。",
    "同步返回子流程结果，异步返回启动信息。",
    "先注册子工作流并约定输入输出契约。",
    '{ type: "subworkflow", config: { subworkflowId: "payment-flow", waitForCompletion: true } }',
  ),
  node(
    "http",
    "HTTP 请求 HTTP",
    "发起 HTTP 请求",
    "调用外部 HTTP endpoint。",
    "method、url、headers、query、body。",
    "第三方 API、微服务、Webhook。",
    "状态码、响应头与响应体。",
    "配置超时、重试和幂等键；慢请求可用 worker。",
    '{ type: "http", config: { method: "GET", url: "https://api.example.com/resource" } }',
  ),
  node(
    "sql",
    "SQL 查询 SQL",
    "执行 SQL 查询/语句",
    "在配置连接上执行 SQL。",
    "connection、query、params。",
    "读写业务数据、审计记录。",
    "查询行或执行元数据。",
    "使用绑定参数，谨慎处理长事务和大结果集。",
    '{ type: "sql", config: { connection: "default", query: "SELECT * FROM orders" } }',
  ),
  node(
    "queue",
    "队列 Queue",
    "消息队列生产/消费",
    "发布或消费消息。",
    "operation、queue、message。",
    "削峰、解耦、后台任务。",
    "发布确认或消费消息。",
    "它连接消息中间件，不等同于 event 唤醒。",
    '{ type: "queue", config: { operation: "publish", queue: "default", message: { text: "msg" } } }',
  ),
  node(
    "condition",
    "条件 Condition",
    "基于表达式的分支判断",
    "按布尔表达式二路分支。",
    "condition、trueBranch、falseBranch。",
    "资格、风控、状态判断。",
    "分支选择结果与表达式值。",
    "复杂多路判断使用 router。",
    '{ type: "condition", config: { condition: "${context.flag === true}" } }',
  ),
  node(
    "router",
    "路由 Router",
    "多分支路由选择",
    "按顺序匹配多个条件并路由。",
    "routes(condition/target)、defaultTarget。",
    "按类型、地区、等级分流。",
    "命中的 route 与目标。",
    "顺序就是优先级，建议配置兜底。",
    '{ type: "router", config: { routes: [{ condition: "${context.vip}", target: "vip" }] } }',
  ),
  node(
    "loop",
    "循环 Loop",
    "循环执行子节点",
    "遍历 collection 执行 body。",
    "collection、itemVariable、body。",
    "批量处理和逐项调用。",
    "每次迭代结果集合。",
    "控制集合规模与失败策略。",
    '{ type: "loop", config: { collection: "${context.items}", itemVariable: "item", body: "process-item" } }',
  ),
  node(
    "approval",
    "审批 Approval",
    "等待人工审批",
    "等待 approve/reject 信号。",
    "prompt、approvedTarget、rejectedTarget。",
    "费用、发布、合规审批。",
    "决定、审批人和备注。",
    "等待状态持久化，通过 signal 唤醒。",
    '{ type: "approval", config: { prompt: "Approve this request?" } }',
  ),
  node(
    "notification",
    "通知 Notification",
    "发送通知消息",
    "通过渠道发送消息。",
    "channel、target、template。",
    "告警、提醒、状态播报。",
    "发送确认与渠道响应。",
    "按业务重要性决定发送失败是否阻断流程。",
    '{ type: "notification", config: { channel: "slack", target: "#alerts" } }',
  ),
  node(
    "join",
    "汇聚 Join",
    "等待并行分支全部/任一完成",
    "等待并行分支 all 或 any 完成。",
    "waitFor、mode。",
    "并行服务调用、结果聚合。",
    "完成分支及输出集合。",
    "all 为默认模式，共享状态需避免覆盖。",
    '{ type: "join", config: { waitFor: ["branchA", "branchB"], mode: "all" } }',
  ),
  node(
    "transform",
    "转换 Transform",
    "按表达式重塑节点输出数据",
    "用类型化表达式重塑输出。",
    "output：字段到表达式的映射。",
    "字段映射、计算、组装 payload。",
    "新对象，保留数字/数组/对象类型。",
    "表达式会求值而非简单字符串插值。",
    '{ type: "transform", config: { output: { total: "${node1.output.price * node1.output.qty}" } } }',
  ),
];

const REQUIRED_PARAMS: Record<string, string> = {
  action: "注册的函数名/处理器",
  wait: "durationMs、until 至少提供一个",
  event: "onEvent",
  subworkflow: "subworkflowId",
  http: "url、method",
  sql: "connection、query",
  queue: "operation、queue",
  condition: "condition、trueBranch、falseBranch",
  router: "routes",
  loop: "collection、body",
  approval: "prompt、approvedTarget、rejectedTarget",
  notification: "channel、target、template",
  join: "waitFor",
  transform: "output",
};

const OPTIONAL_PARAMS: Record<string, string> = {
  action: "输入参数、超时、重试策略",
  wait: "timeout、等待信号相关配置",
  event: "事件过滤条件、超时配置",
  rollback: "rollbackTo、补偿上下文",
  subworkflow: "waitForCompletion、子流程输入",
  http: "headers、query、body、timeout",
  sql: "params、timeout",
  queue: "message、消费组、超时配置",
  condition: "表达式变量、失败分支策略",
  router: "defaultTarget",
  loop: "itemVariable、并发/失败策略",
  approval: "审批人、超时、备注",
  notification: "headers、重试策略",
  join: "mode",
  transform: "表达式上下文、默认值",
};

for (const item of NODE_DOCS) {
  item.requiredParams = REQUIRED_PARAMS[item.type] ?? item.requiredParams;
  item.optionalParams = OPTIONAL_PARAMS[item.type] ?? item.optionalParams;
}
