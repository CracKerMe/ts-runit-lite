/**
 * 概念文档页：表达式引擎、节点输出引用、CAS 并发控制、本地持久化的详细说明。
 * 与 welcomePage.ts 中的概览卡片配套，通过锚点跳转。
 */

import { NODE_DOCS as SHARED_NODE_DOCS } from "./nodeDocs";

interface OperatorInfo {
  op: string;
  precedence: number;
  desc: string;
}

const OPERATORS: OperatorInfo[] = [
  { op: "|", precedence: 0, desc: "管道，左到右将结果传给下一个函数调用" },
  { op: "||", precedence: 1, desc: "逻辑或" },
  { op: "&&", precedence: 2, desc: "逻辑与" },
  { op: "== / != / === / !==", precedence: 3, desc: "相等 / 不等比较" },
  { op: "< / > / <= / >=", precedence: 4, desc: "大小比较" },
  { op: "+ / -", precedence: 5, desc: "加 / 减（+ 也用于字符串拼接）" },
  { op: "* / / / %", precedence: 6, desc: "乘 / 除 / 取余" },
  { op: "**", precedence: 7, desc: "幂运算（右结合）" },
  { op: "! / u-", precedence: 8, desc: "逻辑非 / 取负（一元运算符）" },
];

interface FnGroup {
  category: string;
  items: string;
}

interface NodeDocInfo {
  type: string;
  label: string;
  intro: string;
  fields: string;
  useCase: string;
  output: string;
  notes: string;
  example: string;
}

const LEGACY_NODE_DOCS: NodeDocInfo[] = [
  [
    "action",
    "动作 Action",
    "执行注册的自定义函数。",
    "函数注册名；无固定声明式 config。",
    "校验、领域规则、内部服务调用。",
    "函数返回值写入 output。",
    "保持幂等，副作用配合重试/补偿。",
    '{ type: "action", function: "validateOrder" }',
  ],
  [
    "wait",
    "等待 Wait",
    "按时长、截止时间或信号暂停流程。",
    "durationMs、until；兼容 timeout。",
    "延时、定时、等待外部回执。",
    "唤醒后沿 next 继续。",
    "等待状态会持久化。",
    '{ type: "wait", config: { durationMs: 5000 } }',
  ],
  [
    "event",
    "事件 Event",
    "等待指定名称的外部事件。",
    "onEvent、事件 payload。",
    "支付回调、Webhook、异步完成事件。",
    "输出事件 payload。",
    "事件名建议带业务命名空间。",
    '{ type: "event", config: { onEvent: "order.paid" } }',
  ],
  [
    "rollback",
    "回滚 Rollback",
    "执行前序节点的补偿逻辑。",
    "rollbackTo。",
    "库存、支付、资源预留补偿。",
    "产生补偿结果并沿回滚链继续。",
    "不是数据库事务回滚，补偿需可重试。",
    '{ type: "rollback", rollbackTo: "reserve-stock" }',
  ],
  [
    "subworkflow",
    "子工作流 Subworkflow",
    "启动另一个已注册工作流。",
    "subworkflowId、waitForCompletion。",
    "复用审批、履约等复杂流程。",
    "同步返回子流程结果，异步返回启动信息。",
    "先注册子工作流并约定输入输出契约。",
    '{ type: "subworkflow", config: { subworkflowId: "payment-flow", waitForCompletion: true } }',
  ],
  [
    "http",
    "HTTP 请求 HTTP",
    "调用外部 HTTP endpoint。",
    "method、url、headers、query、body。",
    "第三方 API、微服务、Webhook。",
    "状态码、响应头与响应体。",
    "配置超时、重试和幂等键；慢请求可用 worker。",
    '{ type: "http", config: { method: "GET", url: "https://api.example.com/resource" } }',
  ],
  [
    "sql",
    "SQL 查询 SQL",
    "在配置连接上执行 SQL。",
    "connection、query、params。",
    "读写业务数据、审计记录。",
    "查询行或执行元数据。",
    "使用绑定参数，谨慎处理长事务和大结果集。",
    '{ type: "sql", config: { connection: "default", query: "SELECT * FROM orders" } }',
  ],
  [
    "queue",
    "队列 Queue",
    "发布或消费消息。",
    "operation、queue、message。",
    "削峰、解耦、后台任务。",
    "发布确认或消费消息。",
    "它连接消息中间件，不等同于 event 唤醒。",
    '{ type: "queue", config: { operation: "publish", queue: "default", message: { text: "msg" } } }',
  ],
  [
    "condition",
    "条件 Condition",
    "按布尔表达式二路分支。",
    "condition、trueBranch、falseBranch。",
    "资格、风控、状态判断。",
    "分支选择结果与表达式值。",
    "复杂多路判断使用 router。",
    '{ type: "condition", config: { condition: "${context.flag === true}" } }',
  ],
  [
    "router",
    "路由 Router",
    "按顺序匹配多个条件并路由。",
    "routes(condition/target)、defaultTarget。",
    "按类型、地区、等级分流。",
    "命中的 route 与目标。",
    "顺序就是优先级，建议配置兜底。",
    '{ type: "router", config: { routes: [{ condition: "${context.vip}", target: "vip" }] } }',
  ],
  [
    "loop",
    "循环 Loop",
    "遍历 collection 执行 body。",
    "collection、itemVariable、body。",
    "批量处理和逐项调用。",
    "每次迭代结果集合。",
    "控制集合规模与失败策略。",
    '{ type: "loop", config: { collection: "${context.items}", itemVariable: "item", body: "process-item" } }',
  ],
  [
    "approval",
    "审批 Approval",
    "等待 approve/reject 信号。",
    "prompt、approvedTarget、rejectedTarget。",
    "费用、发布、合规审批。",
    "决定、审批人和备注。",
    "等待状态持久化，通过 signal 唤醒。",
    '{ type: "approval", config: { prompt: "Approve this request?" } }',
  ],
  [
    "notification",
    "通知 Notification",
    "通过渠道发送消息。",
    "channel、target、template。",
    "告警、提醒、状态播报。",
    "发送确认与渠道响应。",
    "按业务重要性决定发送失败是否阻断流程。",
    '{ type: "notification", config: { channel: "slack", target: "#alerts" } }',
  ],
  [
    "join",
    "汇聚 Join",
    "等待并行分支 all 或 any 完成。",
    "waitFor、mode。",
    "并行服务调用、结果聚合。",
    "完成分支及输出集合。",
    "all 为默认模式，共享状态需避免覆盖。",
    '{ type: "join", config: { waitFor: ["branchA", "branchB"], mode: "all" } }',
  ],
  [
    "transform",
    "转换 Transform",
    "用类型化表达式重塑输出。",
    "output：字段到表达式的映射。",
    "字段映射、计算、组装 payload。",
    "新对象，保留数字/数组/对象类型。",
    "表达式会求值而非简单字符串插值。",
    '{ type: "transform", config: { output: { total: "${node1.output.price * node1.output.qty}" } } }',
  ],
].map(([type, label, intro, fields, useCase, output, notes, example]) => ({
  type,
  label,
  intro,
  fields,
  useCase,
  output,
  notes,
  example,
}));

const NODE_DOCS = SHARED_NODE_DOCS;
void LEGACY_NODE_DOCS;

const FN_GROUPS: FnGroup[] = [
  { category: "数学", items: "abs, ceil, floor, round, min, max, sqrt, pow" },
  {
    category: "字符串（内置）",
    items:
      "length, substring, toLowerCase, toUpperCase, trim, concat, includes, startsWith, endsWith",
  },
  {
    category: "字符串（函数库）",
    items:
      "uuid, base64Encode, base64Decode, sha256, md5, slugify, truncate, padStart, padEnd, replaceAll, split",
  },
  {
    category: "日期（内置）",
    items: "now, parse, format, addDays, addHours",
  },
  {
    category: "日期（函数库）",
    items:
      "formatDate, dateDiff, addMinutes, startOfDay, endOfDay, isBefore, isAfter",
  },
  {
    category: "数组（内置）",
    items: "join, map, filter, reduce, find, some, every, flat, flatMap",
  },
  {
    category: "集合（函数库）",
    items:
      "flatten, unique, chunk, groupBy, sortBy, pick, omit, first, last, size, sum, avg, keys, values",
  },
  {
    category: "类型转换",
    items:
      "toNumber, toString, toBoolean, toJson, fromJson, typeOf, isEmpty, defaultTo",
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generateConceptsDocHtml(port: number): string {
  const opRows = OPERATORS.map(
    (o) =>
      `<tr><td><code>${escapeHtml(o.op)}</code></td><td>${o.precedence}</td><td>${escapeHtml(o.desc)}</td></tr>`,
  ).join("\n");

  const fnRows = FN_GROUPS.map(
    (g) =>
      `<tr><td>${escapeHtml(g.category)}</td><td><code>${escapeHtml(g.items)}</code></td></tr>`,
  ).join("\n");

  const nodeNav = NODE_DOCS.map(
    (n) => `<a href="#node-${n.type}">${escapeHtml(n.label)}</a>`,
  ).join("\n    ");
  const nodeSections = NODE_DOCS.map(
    (n) => `<section id="node-${n.type}" class="node-doc">
    <h2>${escapeHtml(n.label)}</h2>
    <p>${escapeHtml(n.intro)}</p>
    <table><tbody>
      <tr><th>适用场景</th><td>${escapeHtml(n.useCase)}</td></tr>
      <tr><th>通用参数</th><td><code>${escapeHtml(n.commonParams)}</code></td></tr>
      <tr><th>必填参数</th><td><code>${escapeHtml(n.requiredParams)}</code></td></tr>
      <tr><th>选填参数</th><td><code>${escapeHtml(n.optionalParams)}</code></td></tr>
      <tr><th>配置字段速览</th><td><code>${escapeHtml(n.fields)}</code></td></tr>
      <tr><th>输出与行为</th><td>${escapeHtml(n.output)}</td></tr>
      <tr><th>使用建议</th><td>${escapeHtml(n.notes)}</td></tr>
    </tbody></table>
    <pre><code>${escapeHtml(n.example)}</code></pre>
  </section>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>核心概念文档 - ts-workflow-engine-lite</title>
<script>
(function(){var t;try{t=localStorage.getItem("tswe-theme")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" />
<style>
  :root {
    color-scheme: dark;
    --bg: #08090a;
    --bg-panel: #0f1011;
    --bg-surface: #191a1b;
    --text-primary: #f7f8f8;
    --text-secondary: #d0d6e0;
    --text-muted: #8a8f98;
    --text-subtle: #62666d;
    --brand: #5e6ad2;
    --accent: #7170ff;
    --accent-hover: #828fff;
    --border-subtle: rgba(255,255,255,0.05);
    --border-standard: rgba(255,255,255,0.08);
    --border-strong: #23252a;
    --border-hover: #34343a;
    --hairline: #34343a;
    --overlay-1: rgba(255,255,255,0.02);
    --overlay-2: rgba(255,255,255,0.05);
    --overlay-3: rgba(255,255,255,0.06);
    --overlay-4: rgba(255,255,255,0.03);
    --grid-line: rgba(255,255,255,0.035);
    --glow: rgba(94,106,210,0.26);
    --wf-glow: rgba(94,106,210,0.07);
    --wf-edge: rgba(255,255,255,0.10);
    --wf-fill-idle: rgba(255,255,255,0.03);
    --wf-node-fill: rgba(94,106,210,0.16);
    --wf-node-stroke: #7170ff;
    --wf-node-glow: rgba(113,112,255,0.4);
    --wf-green-fill: rgba(16,185,129,0.12);
    --wf-green-stroke: #10b981;
    --wf-green-glow: rgba(16,185,129,0.35);
    --flow-line: rgba(113,112,255,0.55);
    --flow-dash: rgba(113,112,255,0.8);
    --flow-soft: rgba(113,112,255,0.4);
    --tag-active: #a5aaff;
    --code-text: #c3c8d4;
    --btn-text: #e2e4e7;
    --selection-bg: rgba(94,106,210,0.45);
    --shadow-line: rgba(0,0,0,0.2);
    --terminal-shadow: rgba(0,0,0,0.5);
    --header-bg: rgba(15,16,17,0.82);
    --focus-ring: rgba(94,106,210,0.22);
    --chip-bg: rgba(94,106,210,0.14);
    --chip-border: rgba(94,106,210,0.28);
    --chip-text: #a5aaff;
    --brand-chip-bg: rgba(94,106,210,0.12);
    --callout-bg: rgba(94,106,210,0.08);
    --accent-glow: rgba(113,112,255,0.7);
    --green: #10b981;
    --green-text: #34d399;
    --green-bg: rgba(16,185,129,0.1);
    --green-border: rgba(16,185,129,0.2);
    --green-glow: rgba(16,185,129,0.9);
    --red: #eb5757;
    --red-bg: rgba(235,87,87,0.1);
    --red-border: rgba(235,87,87,0.22);
    --amber: #fc7840;
    --amber-bg: rgba(252,120,64,0.1);
    --amber-border: rgba(252,120,64,0.22);
    --running-text: #828fff;
    --font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
    --font-mono: "Berkeley Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #ffffff;
    --bg-panel: #f7f8fa;
    --bg-surface: #eef0f4;
    --text-primary: #17181c;
    --text-secondary: #3d414a;
    --text-muted: #6b7080;
    --text-subtle: #8a8f98;
    --brand: #5e6ad2;
    --accent: #5e6ad2;
    --accent-hover: #4f58c7;
    --border-subtle: rgba(13,16,26,0.07);
    --border-standard: rgba(13,16,26,0.11);
    --border-strong: #e0e2e8;
    --border-hover: #c9ccd5;
    --hairline: #d6d8df;
    --overlay-1: rgba(13,16,26,0.024);
    --overlay-2: rgba(13,16,26,0.055);
    --overlay-3: rgba(13,16,26,0.055);
    --overlay-4: rgba(13,16,26,0.02);
    --grid-line: rgba(15,18,30,0.05);
    --glow: rgba(94,106,210,0.14);
    --wf-glow: rgba(94,106,210,0.06);
    --wf-edge: rgba(19,22,32,0.14);
    --wf-fill-idle: rgba(13,16,26,0.02);
    --wf-node-fill: rgba(94,106,210,0.10);
    --wf-node-stroke: #5e6ad2;
    --wf-node-glow: rgba(94,106,210,0.32);
    --wf-green-fill: rgba(5,150,105,0.10);
    --wf-green-stroke: #059669;
    --wf-green-glow: rgba(5,150,105,0.3);
    --flow-line: rgba(94,106,210,0.55);
    --flow-dash: rgba(94,106,210,0.75);
    --flow-soft: rgba(94,106,210,0.35);
    --tag-active: #4c55c8;
    --code-text: #44484f;
    --btn-text: #3d4149;
    --selection-bg: rgba(94,106,210,0.22);
    --shadow-line: rgba(19,22,32,0.06);
    --terminal-shadow: rgba(23,25,35,0.16);
    --header-bg: rgba(255,255,255,0.82);
    --focus-ring: rgba(94,106,210,0.18);
    --chip-bg: rgba(94,106,210,0.10);
    --chip-border: rgba(94,106,210,0.30);
    --chip-text: #4c55c8;
    --brand-chip-bg: rgba(94,106,210,0.09);
    --callout-bg: rgba(94,106,210,0.06);
    --accent-glow: rgba(94,106,210,0.45);
    --green: #059669;
    --green-text: #047857;
    --green-bg: rgba(5,150,105,0.09);
    --green-border: rgba(5,150,105,0.25);
    --green-glow: rgba(5,150,105,0.5);
    --red: #d92d20;
    --red-bg: rgba(217,45,32,0.08);
    --red-border: rgba(217,45,32,0.25);
    --amber: #b93815;
    --amber-bg: rgba(185,56,21,0.08);
    --amber-border: rgba(185,56,21,0.25);
    --running-text: #4c55c8;
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: var(--font-sans);
    font-feature-settings: "cv01", "ss03";
    background: var(--bg);
    color: var(--text-secondary);
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::selection { background: var(--selection-bg); color: var(--text-primary); }
  a:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }

  header {
    position: relative;
    padding: 34px 28px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-panel);
  }
  header h1 {
    margin: 0 0 7px;
    font-size: 24px;
    font-weight: 590;
    line-height: 1.25;
    letter-spacing: -0.34px;
    color: var(--text-primary);
  }
  header a { color: var(--accent); text-decoration: none; font-size: 13px; font-weight: 510; letter-spacing: -0.13px; }
  header a:hover { color: var(--accent-hover); }

  .layout { display: flex; max-width: 1200px; margin: 0 auto; }
  nav {
    flex: 0 0 232px;
    padding: 32px 18px;
    position: sticky;
    top: 0;
    align-self: flex-start;
    max-height: 100vh;
    overflow-y: auto;
  }
  nav a {
    display: block;
    padding: 6px 10px;
    border-radius: 6px;
    color: var(--text-muted);
    text-decoration: none;
    font-size: 13px;
    font-weight: 510;
    letter-spacing: -0.13px;
    margin-bottom: 2px;
    transition: background 0.1s, color 0.1s;
  }
  nav a:hover { background: var(--overlay-2); color: var(--text-primary); }

  main { flex: 1; padding: 44px 40px 128px; min-width: 0; }
  section { margin-bottom: 80px; scroll-margin-top: 16px; }
  h2 {
    font-size: 28px;
    font-weight: 510;
    line-height: 1.25;
    letter-spacing: -0.34px;
    margin: 0 0 14px;
    color: var(--text-primary);
  }
  h2 .tag {
    font-size: 13px;
    font-weight: 400;
    letter-spacing: -0.13px;
    color: var(--text-subtle);
    margin-left: 10px;
  }
  h3 {
    font-size: 17px;
    font-weight: 590;
    letter-spacing: -0.2px;
    color: var(--text-primary);
    margin: 36px 0 12px;
  }
  p {
    font-size: 15px;
    letter-spacing: -0.11px;
    color: var(--text-secondary);
    margin: 12px 0;
  }
  p a { color: var(--accent); text-decoration: none; }
  p a:hover { color: var(--accent-hover); text-decoration: underline; text-underline-offset: 3px; }

  code {
    background: var(--overlay-3);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: var(--font-mono);
    font-size: 12.5px;
    color: var(--code-text);
  }
  pre {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    border-radius: 8px;
    padding: 16px 18px;
    overflow-x: auto;
    font-size: 13px;
    line-height: 1.55;
  }
  pre code { background: none; padding: 0; border: none; color: var(--text-secondary); }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; letter-spacing: -0.13px; margin-top: 12px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  th { color: var(--text-muted); font-weight: 510; font-size: 12px; letter-spacing: 0.02em; }
  tbody tr { transition: background 0.1s; }
  tbody tr:hover { background: var(--overlay-1); }

  .callout {
    border-left: 2px solid var(--brand);
    background: var(--callout-bg);
    padding: 12px 16px;
    border-radius: 0 8px 8px 0;
    font-size: 13.5px;
    letter-spacing: -0.11px;
    line-height: 1.6;
    color: var(--text-secondary);
    margin: 16px 0;
  }
  .callout code { background: var(--overlay-3); }
  .back { display: inline-block; margin-top: 8px; }

  /* ── 主题切换（位于顶栏右上）──────────────────── */
  button.theme-toggle {
    position: absolute;
    top: 30px;
    right: 26px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    padding: 0;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    border-radius: 9px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  button.theme-toggle:hover { background: var(--overlay-2); border-color: var(--border-hover); color: var(--text-primary); }
  .theme-toggle svg { width: 17px; height: 17px; display: block; }
  :root[data-theme="dark"] .theme-toggle .i-moon { display: none; }
  :root[data-theme="light"] .theme-toggle .i-sun { display: none; }

  /* ── 侧栏当前章节高亮（scrollspy）─────────────── */
  nav a.active {
    background: var(--callout-bg);
    color: var(--text-primary);
    box-shadow: inset 2px 0 0 var(--brand);
  }

  /* ── 代码块复制按钮 ───────────────────────────── */
  main pre { position: relative; }
  .code-copy {
    position: absolute;
    top: 8px;
    right: 8px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 510;
    color: var(--text-muted);
    background: var(--overlay-2);
    border: 1px solid var(--border-standard);
    border-radius: 5px;
    cursor: pointer;
    opacity: 0;
    transition: color 0.15s, border-color 0.15s, opacity 0.15s;
  }
  main pre:hover .code-copy, .code-copy:focus-visible { opacity: 1; }
  .code-copy:hover { color: var(--text-primary); border-color: var(--hairline); }
  .code-copy.copied { color: var(--green-text); border-color: var(--green-border); opacity: 1; }
</style>
</head>
<body>
<header>
  <h1>核心概念文档</h1>
  <a href="/">&larr; 返回首页</a>
  <button type="button" id="themeToggle" class="theme-toggle" aria-label="切换亮暗主题" title="切换亮暗主题">
    <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>
</header>
<div class="layout">
  <nav>
    <a href="#node-reference">节点类型参考</a>
    ${nodeNav}
    <a href="#node-output">节点输出引用</a>
    <a href="#expressions">表达式引擎</a>
    <a href="#operators">运算符优先级</a>
    <a href="#functions">内置函数</a>
    <a href="#cas">并发控制（CAS）</a>
    <a href="#lease">Lease 自动续期</a>
    <a href="#heartbeat">Heartbeat 跟踪</a>
    <a href="#storage">本地文件持久化</a>
    <a href="#secrets">密钥解析</a>
    <a href="#worker-pool">Worker 线程池</a>
    <a href="#task-queue">任务队列路由</a>
    <a href="#archive">终态实例归档</a>
    <a href="#join-transform">join / transform / durable wait</a>
    <a href="#integration">持久化与外部集成增强</a>
    <a href="#instance-control">实例控制 API</a>
    <a href="#errors">错误处理与死信队列</a>
    <a href="#webhooks">通知与 Webhook</a>
  </nav>
  <main>

  <section id="node-reference">
    <h2>节点类型参考</h2>
    <p>每个节点都从用途、字段、输出行为、适用场景和示例五个维度说明。首页节点卡片可直接跳转到对应章节。</p>
  </section>
  ${nodeSections}

  <section id="node-output">
    <h2>节点输出引用</h2>
    <p>后续节点可以通过 <code>\${nodeId.output}</code> 或 <code>\${nodeId.output.path.to.value}</code> 引用前面已执行节点的输出结果，用于配置字段（如 <code>condition</code>、HTTP body、通知内容等）。</p>
    <pre><code>{
  "type": "action",
  "config": {
    // 直接引用整个输出对象
    "input": "\${validate-order.output}",

    // 引用输出对象的某个字段
    "amount": "\${validate-order.output.amount}",

    // 在表达式中参与运算
    "discountedPrice": "\${node1.output.price * 0.8}",

    // 结合比较运算做条件路由
    "isPremium": "\${check-amount.output.total > 1000}"
  }
}</code></pre>
    <div class="callout">
      引用不存在的节点或字段时不会抛出异常，而是解析为 <code>undefined</code> 并记录一条 warn 日志（详见
      <code>resolveNodeOutput</code>，<a href="https://github.com/CracKerMe/ts-runit-lite/blob/main/src/engine/ExpressionEvaluator.ts" target="_blank" rel="noopener">ExpressionEvaluator.ts</a>）。
      调试时可查看该节点日志确认输出结构是否符合预期。
    </div>
    <p>普通上下文变量（工作流启动时传入的 <code>input</code>）同样用 <code>\${variable}</code> 或 <code>\${context.path}</code> 语法引用，与节点输出引用可以混用在同一个字符串模板中。</p>
  </section>

  <section id="expressions">
    <h2>表达式引擎</h2>
    <p>表达式字符串（如 <code>condition</code> 节点的 <code>condition</code> 字段）由内置的 Shunting-Yard 解析器求值，支持数学 / 比较 / 逻辑运算符、函数调用、数组/对象访问，以及箭头函数（用于 <code>map</code>/<code>filter</code> 等高阶函数）。</p>
    <pre><code>\${amount > 1000 && status == "approved"}
\${max(a, b) * 1.1}
\${round(price * (1 - discount), 2)}
\${items.filter(x => x.qty > 0).length}
\${user.roles.includes("admin")}</code></pre>
    <h3 id="operators">运算符优先级</h3>
    <p>数字越大优先级越高，同级按结合方向从左到右（<code>**</code> 例外，右结合）求值：</p>
    <table>
      <thead><tr><th>运算符</th><th>优先级</th><th>说明</th></tr></thead>
      <tbody>
${opRows}
      </tbody>
    </table>

    <h3 id="functions">内置函数</h3>
    <p>共 20+ 内置函数，按类别列出：</p>
    <table>
      <thead><tr><th>分类</th><th>函数</th></tr></thead>
      <tbody>
${fnRows}
      </tbody>
    </table>
    <div class="callout">
      完整函数目录（含参数签名与中文说明）可通过接口实时获取：
      <code>GET http://localhost:${port}/workflow-api/v1/functions</code>。
      也可以通过 <code>POST /workflow-api/v1/functions</code> 注册自定义函数，实现见
      <code>src/engine/functions/customFunctions.ts</code>。
    </div>
  </section>

  <section id="cas">
    <h2>并发控制（CAS）</h2>
    <p><code>WorkflowInstance</code> 携带 <code>version</code> 字段。每次更新实例状态时，存储层会比对期望版本号，
    版本不一致（说明有并发写入）则更新失败并自动重试，从根本上避免 Lost Update 问题。</p>
    <p>实现见 <code>src/engine/ConcurrencyControl.ts</code>。</p>
  </section>

  <section id="lease">
    <h2>Lease 自动续期</h2>
    <p>防止长运行任务因超时被误判为失败而重复执行。任务开始时获取一个带过期时间的 Lease，
    <code>LeaseStore.startAutoRenewal()</code> 在后台周期性续期，任务结束或进程退出时释放。</p>
    <p>单进程内存实现，不提供跨进程协调；实现见 <code>src/utils/LeaseStore.ts</code>。</p>
  </section>

  <section id="heartbeat">
    <h2>Heartbeat 跟踪</h2>
    <p>长时间运行的 <code>action</code> 节点可通过 <code>heartbeat</code> 配置定期上报进度。
    <code>HeartbeatManager</code> 通过 <code>StorageProvider</code> 保存和恢复 Heartbeat 状态：
    使用默认 <code>LocalFileStorage</code> 时可跨进程重启恢复，使用 <code>MemoryStorage</code> 时仅在当前进程生命周期内保留。</p>
    <p>实现见 <code>src/engine/HeartbeatManager.ts</code>。</p>
  </section>

  <section id="storage">
    <h2>本地文件持久化</h2>
    <p>非测试环境默认使用 <code>LocalFileStorage</code>，数据目录由 <code>STORAGE_DIR</code> 指定（默认 <code>.ts-workflow-engine-data/</code>）。
    每条记录独立保存为 JSON 文件，通过临时文件 + 原子 rename 更新，避免写入过程中数据损坏。</p>
    <p>数据按 <code>instances</code>、<code>workflows</code>、<code>workflow-versions</code>、<code>waiting</code>、<code>metrics</code>、<code>events</code>、<code>heartbeats</code>、<code>dlq</code> 等目录分类；
    启动时无法解析的记录会被隔离到对应分类下的 <code>corrupt/</code> 目录，不阻断其余数据恢复。</p>
    <div class="callout">
      含 JavaScript 函数/闭包的工作流定义无法序列化。启动时应先关闭自动恢复、由应用代码重新注册这些定义，
      再调用 <code>engine.resumeRunningInstancesFromStorage()</code> 恢复未完成实例。
    </div>
    <p>本地文件存储不提供跨进程锁，同一个 <code>STORAGE_DIR</code> 只能由一个引擎进程使用。</p>
  </section>

  <section id="secrets">
    <h2>密钥解析（SecretManager）</h2>
    <p>节点配置中可写 <code>\${secret:NAME}</code>，在 <code>http</code> / <code>sql</code> / <code>queue</code> 节点执行前解析（含嵌套字段）。
    由 <code>SECRET_PROVIDER</code> 选择后端，默认 <code>env</code>（从环境变量读取）。</p>
    <div class="callout">
      <code>vault</code> / <code>aws-secrets-manager</code> 尚未实现，配置后在启动时抛 <code>UnsupportedSecretProviderError</code>，不会静默回退。
      未找到的密钥保留原样并记录 warn 日志，不会替换成 <code>undefined</code>。
    </div>
    <p>实现见 <code>src/utils/SecretManager.ts</code> 与 <code>src/utils/secrets.ts</code>。</p>
  </section>

  <section id="worker-pool">
    <h2>Worker 线程池与 Sticky 亲和性</h2>
    <p><code>WORKER_POOL_ENABLED=true</code> 时，<code>http</code> 节点卸载到 worker 线程执行。
    每个 worker 有稳定 <code>workerId</code>；同一实例的后续任务优先路由回已绑定的 worker（<code>WORKER_STICKY_ENABLED</code>），
    绑定的 worker 忙碌时会回退到任意空闲 worker —— 亲和性只做优化，不会阻塞任务。worker 退出或池关闭时释放绑定，
    避免实例被绑死在已终止的线程上。</p>
    <p>实现见 <code>src/engine/worker/WorkerPool.ts</code> 与 <code>src/engine/StickyExecutionManager.ts</code>。</p>
  </section>

  <section id="task-queue">
    <h2>任务队列路由（TaskQueueManager）</h2>
    <p><code>action</code> / <code>rollback</code> 节点可通过 <code>taskQueue: "queue-name"</code> 路由到命名队列。
    队列 worker 通过 <code>taskQueueManager.registerWorker()</code> 注册，受 <code>maxConcurrent</code> 限流；
    队列无 worker 时回退为本地直接执行，节点不会被卡住。</p>
    <p>与 <code>queue</code> 节点类型不同：后者对接外部消息中间件，这里是进程内的工作分发。实现见 <code>src/engine/TaskQueueManager.ts</code>。</p>
  </section>

  <section id="archive">
    <h2>终态实例归档</h2>
    <p>归档默认关闭，通过 <code>ARCHIVE_ENABLED=true</code> 启用。终态实例写入 <code>archive/YYYY-MM-DD/&lt;instanceId&gt;.json</code>
    后，才从热存储移除。<code>ARCHIVE_RETENTION_DAYS</code> 控制日期分区保留时间，<code>ARCHIVE_CLEANUP_INTERVAL_MS</code> 控制清理周期。</p>
    <div class="callout">归档文件是冷数据，不会自动参与实例查询或启动恢复。</div>
  </section>

  <section id="join-transform">
    <h2>join / transform 节点与 durable wait</h2>
    <p><code>join</code>：等待 <code>config.waitFor</code> 列出的分支节点完成，<code>mode: "all" | "any"</code>；
    依赖引擎批量 fan-out 执行，单进程场景下无需额外 CAS/加锁。</p>
    <p><code>transform</code>：通过类型化表达式求值重塑节点输出（而非字符串插值），数字/数组/对象保持原生类型，不强制转成字符串。</p>
    <p><code>wait</code> 节点新增 <code>config.durationMs</code> / <code>config.until</code>（绝对截止时间）作为相对时长/绝对时间的显式写法，
    优先级高于旧的顶层 <code>timeout</code> 字段。</p>
    <p>字段详情见 <a href="https://github.com/CracKerMe/ts-runit-lite/blob/main/docs/NODE_REFERENCE.md" target="_blank" rel="noopener">docs/NODE_REFERENCE.md</a> 的
    <code>join</code>/<code>transform</code>/<code>wait</code> 章节。</p>
  </section>

  <section id="integration">
    <h2>持久化与外部集成增强</h2>
    <p><code>FSYNC_ON_WRITE=true</code> 时，<code>LocalFileStorage</code> 写入会 fsync 临时文件和所在目录，
    换取主机级崩溃/断电下的持久性（代价是写入延迟明显增加）；默认 <code>false</code>，仅保证原子 rename 后文件本身完整。</p>
    <p>fsync 按集合生效：<code>instances</code>、<code>events</code>、<code>waiting</code>、<code>workflows*</code>、
    <code>dlq</code>、<code>webhooks*</code> 等系统记录与审计历史会 fsync；<code>metrics</code> 与 <code>heartbeats</code>
    <strong>不会</strong>——它们是纯派生的可观测性数据，却占了每节点 3 次写入中的 2 次，fsync 它们会让每个节点执行
    都为没人需要的持久性买单。代价是主机级崩溃可能丢失最近的 metrics 与 heartbeat，实例状态与事件历史不受影响。
    需要时可通过 <code>LocalFileStorageOptions.fsyncCollections</code> 显式覆盖。</p>
    <p><code>createWorkflowRouter()</code> / <code>createWorkflowRouterBundle()</code> 允许宿主 Express 应用将工作流 API
    挂载为普通 <code>express.Router</code>，无需通过 <code>startApiServer()</code> 独立运行。</p>
    <p>高频查找/并发错误改用具名错误类导出（<code>WorkflowNotFoundError</code>、<code>InstanceNotFoundError</code>、
    <code>ConcurrencyConflictError</code>、<code>LockAcquisitionError</code>），支持 <code>instanceof</code> 判断而非匹配错误消息字符串。</p>
    <div class="callout">
      示例见 <code>examples/embedded-express-app.ts</code> 与 <code>examples/error-handling.ts</code>。
    </div>
  </section>

  <section id="instance-control">
    <h2>实例控制 API</h2>
    <p>运行中的实例不是只能等它跑完——针对失败与卡住两种场景，引擎提供了一组干预端点：</p>
    <table>
      <thead><tr><th>操作</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><code>retry</code></td><td>重试失败节点。节点内可通过 <code>instance.retries[nodeId]</code> 感知第几次重试，实现「先失败后成功」的补偿语义。</td></tr>
        <tr><td><code>skip</code></td><td>跳过当前失败节点，直接沿 next 继续推进。</td></tr>
        <tr><td><code>compensate</code></td><td>对已执行节点触发补偿逻辑，用于 saga 式回滚。</td></tr>
        <tr><td><code>signal</code></td><td><code>POST /instances/:id/signal</code> 向等待型节点（wait / event / approval）注入信号，唤醒继续执行。</td></tr>
      </tbody>
    </table>
    <div class="callout">
      示例见 <code>examples/instance-control-api.ts</code>，覆盖 retry / skip / compensate 与节点状态查询的完整调用链。
    </div>
  </section>

  <section id="errors">
    <h2>错误处理与死信队列</h2>
    <p>高频失败模式用具名错误类导出，<code>instanceof</code> 精确捕获而非匹配错误消息字符串：
    <code>WorkflowNotFoundError</code>（启动未注册的工作流）、<code>InstanceNotFoundError</code>（查询/信号不存在的实例，常见于拼写错误、已归档或来自不同 <code>STORAGE_DIR</code> 的实例）、
    <code>ConcurrencyConflictError</code>（CAS 版本冲突）与 <code>LockAcquisitionError</code>（锁获取失败）。</p>
    <p>节点抛出异常后按重试策略自动重试（<code>instance.retries</code> 记录次数）；超过策略仍失败的节点最终进入死信队列，
    通过 <code>GET /workflow-api/v1/dlq</code> 查询，不会无限循环占用调度资源，便于事后排查与人工补偿。</p>
    <div class="callout">
      示例见 <code>examples/error-handling.ts</code> 与 <code>examples/graceful-degradation.ts</code>。
    </div>
  </section>

  <section id="webhooks">
    <h2>通知与 Webhook</h2>
    <p><code>notification</code> 节点通过通知渠道向外部推送消息：内置 <code>WebhookChannel</code>（通用 HTTP Webhook）与
    <code>SlackChannel</code>（Slack Incoming Webhook，需配置 webhook URL），可在工作流任意位置插入通知动作。</p>
    <p>引擎侧的 WebhookManager 会在系统生命周期事件发生时触发已注册的 Webhook 接收器；Webhook 注册与投递记录均持久化到存储
    （重启后自动恢复），Console WebSocket 同时向控制台实时广播同一份事件流，方便在 Playground/自建控制台中观察执行动态。</p>
    <p>事件也可由外部主动驱动：<code>GET /workflow-api/v1/events</code> 支持查询与触发事件，配合 <code>event</code> 节点实现外部系统与工作流的双向集成。</p>
  </section>

  </main>
</div>
<script>
(function(){var b=document.getElementById("themeToggle");if(!b)return;b.addEventListener("click",function(){var d=document.documentElement,t=d.getAttribute("data-theme")==="light"?"dark":"light";d.setAttribute("data-theme",t);try{localStorage.setItem("tswe-theme",t)}catch(e){}})})();
</script>
<script>
(function(){
  /* 代码块复制按钮：为每个 main pre 注入 */
  function bindCopy(btn){
    btn.addEventListener("click",function(){
      var pre=btn.closest("pre");
      if(!pre)return;
      var text=pre.textContent||"";
      function done(){
        btn.classList.add("copied");
        var old=btn.textContent;
        btn.textContent="已复制 ✓";
        setTimeout(function(){btn.classList.remove("copied");btn.textContent=old;},1600);
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done,function(){fallback()});
      }else{fallback()}
      function fallback(){
        var ta=document.createElement("textarea");
        ta.value=text;ta.style.position="fixed";ta.style.opacity="0";
        document.body.appendChild(ta);ta.select();
        try{document.execCommand("copy");done()}catch(e){}
        document.body.removeChild(ta);
      }
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("main pre"),function(pre){
    var btn=document.createElement("button");
    btn.type="button";
    btn.className="code-copy";
    btn.textContent="复制";
    btn.setAttribute("aria-label","复制代码");
    pre.appendChild(btn);
    bindCopy(btn);
  });

  /* Scrollspy：侧栏高亮当前章节 */
  var navLinks=Array.prototype.slice.call(document.querySelectorAll("nav a"));
  var idMap={};
  navLinks.forEach(function(a){
    var href=a.getAttribute("href")||"";
    if(href.charAt(0)==="#")idMap[href.slice(1)]=a;
  });
  var sections=Array.prototype.slice.call(document.querySelectorAll("main section[id]"));
  if("IntersectionObserver" in window && sections.length){
    var visible={};
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if(en.isIntersecting)visible[en.target.id]=en.intersectionRatio;
        else delete visible[en.target.id];
      });
      var best=null,bestRatio=0;
      Object.keys(visible).forEach(function(id){
        if(visible[id]>bestRatio){bestRatio=visible[id];best=id;}
      });
      navLinks.forEach(function(a){a.classList.remove("active")});
      if(best&&idMap[best])idMap[best].classList.add("active");
    },{rootMargin:"-64px 0px -55% 0px",threshold:[0,0.25,0.5,1]});
    sections.forEach(function(s){io.observe(s)});
  }
})();
</script>
</body>
</html>`;
}
