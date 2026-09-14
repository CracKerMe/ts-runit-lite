/**
 * 概念文档页：表达式引擎、节点输出引用、CAS 并发控制、本地持久化的详细说明。
 * 与 welcomePage.ts 中的概览卡片配套，通过锚点跳转。
 */

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

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>核心概念文档 - ts-workflow-engine-lite</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    line-height: 1.65;
  }
  header {
    padding: 32px 24px;
    border-bottom: 1px solid #1e293b;
    background: #111827;
  }
  header h1 { margin: 0 0 4px; font-size: 22px; }
  header a { color: #60a5fa; text-decoration: none; font-size: 13px; }
  .layout { display: flex; max-width: 1100px; margin: 0 auto; }
  nav {
    flex: 0 0 200px;
    padding: 24px 16px;
    position: sticky;
    top: 0;
    align-self: flex-start;
  }
  nav a {
    display: block;
    padding: 6px 10px;
    border-radius: 6px;
    color: #94a3b8;
    text-decoration: none;
    font-size: 13px;
    margin-bottom: 2px;
  }
  nav a:hover { background: #1e293b; color: #e2e8f0; }
  main { flex: 1; padding: 24px 24px 100px; min-width: 0; }
  section { margin-bottom: 48px; scroll-margin-top: 16px; }
  h2 {
    font-size: 20px;
    margin: 0 0 6px;
    color: #f1f5f9;
  }
  h2 .tag {
    font-size: 12px;
    font-weight: 400;
    color: #64748b;
    margin-left: 8px;
  }
  h3 { font-size: 15px; color: #cbd5e1; margin: 24px 0 8px; }
  p { color: #cbd5e1; }
  code {
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    color: #7dd3fc;
  }
  pre {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    font-size: 13px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; margin-top: 8px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1e293b; vertical-align: top; }
  th { color: #94a3b8; font-weight: 600; }
  .callout {
    border-left: 3px solid #2563eb;
    background: #1e293b55;
    padding: 10px 14px;
    border-radius: 0 6px 6px 0;
    font-size: 13.5px;
    color: #cbd5e1;
    margin: 12px 0;
  }
  .back { display: inline-block; margin-top: 8px; }
</style>
</head>
<body>
<header>
  <h1>核心概念文档</h1>
  <a href="/">&larr; 返回首页</a>
</header>
<div class="layout">
  <nav>
    <a href="#node-output">节点输出引用</a>
    <a href="#expressions">表达式引擎</a>
    <a href="#operators">运算符优先级</a>
    <a href="#functions">内置函数</a>
    <a href="#cas">并发控制（CAS）</a>
    <a href="#storage">本地文件持久化</a>
  </nav>
  <main>

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
      <code>resolveNodeOutput</code>，<a href="https://github.com/AppleSunCloud/ts-runit-lite/blob/main/src/engine/ExpressionEvaluator.ts" target="_blank" rel="noopener">ExpressionEvaluator.ts</a>）。
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

  <section id="storage">
    <h2>本地文件持久化</h2>
    <p>非测试环境默认使用 <code>LocalFileStorage</code>，数据目录由 <code>STORAGE_DIR</code> 指定（默认 <code>.ts-runit-data/</code>）。
    每条记录独立保存为 JSON 文件，通过临时文件 + 原子 rename 更新，避免写入过程中数据损坏。</p>
    <p>数据按 <code>instances</code>、<code>workflows</code>、<code>workflow-versions</code>、<code>waiting</code>、<code>metrics</code>、<code>events</code>、<code>heartbeats</code>、<code>dlq</code> 等目录分类；
    启动时无法解析的记录会被隔离到对应分类下的 <code>corrupt/</code> 目录，不阻断其余数据恢复。</p>
    <div class="callout">
      含 JavaScript 函数/闭包的工作流定义无法序列化。启动时应先关闭自动恢复、由应用代码重新注册这些定义，
      再调用 <code>engine.resumeRunningInstancesFromStorage()</code> 恢复未完成实例。
    </div>
  </section>

  </main>
</div>
</body>
</html>`;
}
