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
    <a href="#lease">Lease 自动续期</a>
    <a href="#heartbeat">Heartbeat 跟踪</a>
    <a href="#storage">本地文件持久化</a>
    <a href="#secrets">密钥解析</a>
    <a href="#worker-pool">Worker 线程池</a>
    <a href="#task-queue">任务队列路由</a>
    <a href="#archive">终态实例归档</a>
    <a href="#join-transform">join / transform / durable wait</a>
    <a href="#integration">持久化与外部集成增强</a>
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
      <code>resolveNodeOutput</code>，<a href="https://github.com/CracKerMe/ts-workflow-engine-lite/blob/main/src/engine/ExpressionEvaluator.ts" target="_blank" rel="noopener">ExpressionEvaluator.ts</a>）。
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
    <p>字段详情见 <a href="https://github.com/CracKerMe/ts-workflow-engine-lite/blob/main/docs/NODE_REFERENCE.md" target="_blank" rel="noopener">docs/NODE_REFERENCE.md</a> 的
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

  </main>
</div>
</body>
</html>`;
}
