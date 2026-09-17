/**
 * 核心概念文档：/docs/concepts 与 /docs/concepts/:topic。
 *
 * 与节点页/端点页共用 renderer.ts 的版式，区别在于这里的内容是散文而非
 * 参数表——通过 ParamSection.body 承载段落、表格与 callout，参数型的
 * `params` 留空。
 *
 * 之所以按主题拆成多页而不是维持原来的单页锚点长滚动：右栏代码面板只有
 * 在「当前页只讲一件事」时才有意义。原页面 16 节里只有 2 节带代码块，
 * 单页会让代码栏大部分时间空着或驴唇不对马嘴。
 */

import {
  renderDocPage,
  type CodeBlockGroup,
  type DocPage,
  type NavGroup,
  type ParamSection,
  type TopbarLink,
} from "./renderer";

const TOPBAR: TopbarLink[] = [
  { href: "/docs/nodes", label: "节点参考" },
  { href: "/api-docs", label: "REST API" },
  { href: "/docs/concepts", label: "核心概念", active: true },
  { href: "/playground", label: "Playground" },
];

const REPO = "https://github.com/CracKerMe/ts-runit-lite/blob/main";

interface ConceptTopic {
  slug: string;
  title: string;
  lede: string;
  /** 侧栏分组标题。 */
  group: string;
  sections: ParamSection[];
  codeGroups?: CodeBlockGroup[];
}

/**
 * 表达式引擎的运算符表。优先级数字越大越先求值，同级从左到右，
 * `**` 是唯一的右结合运算符。
 */
const OPERATORS: { op: string; precedence: number; desc: string }[] = [
  { op: "|", precedence: 0, desc: "管道，左到右将结果传给下一个函数调用" },
  { op: "||", precedence: 1, desc: "逻辑或" },
  { op: "&&", precedence: 2, desc: "逻辑与" },
  { op: "== / != / === / !==", precedence: 3, desc: "相等 / 不等比较" },
  { op: "&lt; / &gt; / &lt;= / &gt;=", precedence: 4, desc: "大小比较" },
  { op: "+ / -", precedence: 5, desc: "加 / 减（+ 也用于字符串拼接）" },
  { op: "* / / / %", precedence: 6, desc: "乘 / 除 / 取余" },
  { op: "**", precedence: 7, desc: "幂运算（右结合）" },
  { op: "! / u-", precedence: 8, desc: "逻辑非 / 取负（一元运算符）" },
];

const FN_GROUPS: { category: string; items: string }[] = [
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
  { category: "日期（内置）", items: "now, parse, format, addDays, addHours" },
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

function operatorTable(): string {
  const rows = OPERATORS.map(
    (o) =>
      `<tr><td><code>${o.op}</code></td><td>${o.precedence}</td><td>${o.desc}</td></tr>`,
  ).join("");
  return `<table><thead><tr><th>运算符</th><th>优先级</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function functionTable(): string {
  const rows = FN_GROUPS.map(
    (g) => `<tr><td>${g.category}</td><td><code>${g.items}</code></td></tr>`,
  ).join("");
  return `<table><thead><tr><th>分类</th><th>函数</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * 主题定义。分组顺序即侧栏顺序，也决定上一页/下一页。
 *
 * 文案沿用原 docsPage.ts 的内容，未做实质改写——这次是版式迁移，
 * 不是内容重写，避免在搬运过程中悄悄改变技术表述。
 */
const TOPICS: ConceptTopic[] = [
  {
    slug: "node-output",
    title: "节点输出引用",
    lede: "后续节点如何引用前面已执行节点的输出结果。",
    group: "表达式与数据",
    sections: [
      {
        id: "syntax",
        title: "引用语法",
        params: [],
        body: `<p>后续节点可以通过 <code>\${nodeId.output}</code> 或 <code>\${nodeId.output.path.to.value}</code> 引用前面已执行节点的输出结果，用于配置字段（如 <code>condition</code>、HTTP body、通知内容等）。</p>
<p>普通上下文变量（工作流启动时传入的 <code>input</code>）同样用 <code>\${variable}</code> 或 <code>\${context.path}</code> 语法引用，与节点输出引用可以混用在同一个字符串模板中。</p>
<div class="callout">
  <p>引用不存在的节点或字段时<strong>不会抛出异常</strong>，而是解析为 <code>undefined</code> 并记录一条 warn 日志（详见 <code>resolveNodeOutput</code>，<a href="${REPO}/src/engine/ExpressionEvaluator.ts" target="_blank" rel="noopener">ExpressionEvaluator.ts</a>）。调试时可查看该节点日志确认输出结构是否符合预期。</p>
</div>`,
      },
    ],
    codeGroups: [
      {
        title: "引用示例",
        badge: "JSON",
        samples: [
          {
            label: "config",
            language: "json",
            code: `{
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
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "expressions",
    title: "表达式引擎",
    lede: "由内置 Shunting-Yard 解析器求值，支持运算符、函数调用与箭头函数。",
    group: "表达式与数据",
    sections: [
      {
        id: "overview",
        title: "概述",
        params: [],
        body: `<p>表达式字符串（如 <code>condition</code> 节点的 <code>condition</code> 字段）由内置的 Shunting-Yard 解析器求值，支持数学 / 比较 / 逻辑运算符、函数调用、数组/对象访问，以及箭头函数（用于 <code>map</code>/<code>filter</code> 等高阶函数）。</p>`,
      },
      {
        id: "operators",
        title: "运算符优先级",
        params: [],
        body: `<p>数字越大优先级越高，同级按结合方向从左到右（<code>**</code> 例外，右结合）求值：</p>${operatorTable()}`,
      },
      {
        id: "functions",
        title: "内置函数",
        subtitle: "20+",
        params: [],
        body: `${functionTable()}
<div class="callout">
  <p>完整函数目录（含参数签名与中文说明）可通过接口实时获取：<code>GET /workflow-api/v1/functions</code>。也可以通过 <code>POST /workflow-api/v1/functions</code> 注册自定义函数，实现见 <code>src/engine/functions/customFunctions.ts</code>。</p>
</div>`,
      },
    ],
    codeGroups: [
      {
        title: "表达式示例",
        badge: "expr",
        samples: [
          {
            label: "示例",
            language: "javascript",
            code: `\${amount > 1000 && status == "approved"}
\${max(a, b) * 1.1}
\${round(price * (1 - discount), 2)}
\${items.filter(x => x.qty > 0).length}
\${user.roles.includes("admin")}`,
          },
        ],
      },
    ],
  },
  {
    slug: "fanout-join",
    title: "并行扇出与结果汇聚",
    lede: "next 扇出并行分支、join 汇聚、transform 整形——三者如何组合成一条纯 JSON 的数据流水线。",
    group: "表达式与数据",
    sections: [
      {
        id: "pattern",
        title: "组合模式",
        params: [],
        body: `<p>这三个节点单独看都不复杂，放在一起才构成引擎里最常用的一条流水线：<strong>扇出取数 → 汇聚 → 整形</strong>。各自的字段参考见 <a href="/docs/nodes/join">join</a> 与 <a href="/docs/nodes/transform">transform</a>，这一页讲的是它们怎么配合。</p>
<table>
  <thead><tr><th>阶段</th><th>由谁完成</th><th>做什么</th></tr></thead>
  <tbody>
    <tr><td>扇出</td><td>上游节点的 <code>next: [a, b]</code></td><td>同一批并行执行多个分支，<strong>不需要专门的「并行节点」</strong>。</td></tr>
    <tr><td>汇聚</td><td><code>join</code></td><td>收集各分支输出到 <code>results</code>，按 <code>mode</code> 决定缺分支时是失败还是放行。</td></tr>
    <tr><td>整形</td><td><code>transform</code></td><td>把 <code>results</code> 里的嵌套结构压平成下游要的形状，保留原生类型。</td></tr>
  </tbody>
</table>
<p>为什么需要 <code>transform</code> 这一步：<code>join</code> 的输出是 <code>{ results: { 分支ID: 输出 }, missing: [] }</code>，嵌套两层且带分支 ID。直接把它丢给下游的 HTTP body 或通知模板会很难写，<code>transform</code> 负责把它拍平成业务语义的字段。</p>`,
      },
      {
        id: "how-join-works",
        title: "join 为什么不需要锁",
        params: [],
        body: `<p>引擎<strong>按批次</strong>执行同一次 <code>next</code> 扇出中的所有节点，整批完成后才推进到下一批。所以只要 <code>waitFor</code> 里的分支都来自同一次扇出，<code>join</code> 执行时它们必然已经全部结束。</p>
<p><code>join</code> 做的事情只是从 <code>instance.state.nodes</code> 读取这些分支的已有输出并校验 —— <strong>不涉及跨进程锁，也没有额外的 CAS 或并发控制</strong>。这也是为什么它在单进程模型下代价极低。</p>
<div class="callout">
  <p>反过来说：如果 <code>waitFor</code> 里列的节点<strong>不在同一次扇出中</strong>（比如来自更晚的批次），<code>join</code> 执行时它们还没有输出，会被算进 <code>missing</code>。<code>mode: "all"</code> 下这会让节点直接失败。</p>
</div>`,
      },
      {
        id: "mode",
        title: "mode 的选择",
        params: [],
        body: `<table>
  <thead><tr><th>mode</th><th>行为</th><th>适用场景</th></tr></thead>
  <tbody>
    <tr><td><code>all</code>（默认）</td><td>任一分支缺输出即<strong>抛错失败</strong>，可配合 <code>failureNext</code> / <code>retryPolicy</code> 兜底。</td><td>下游必须拿到全部数据才能继续，例如合并库存与价格后才能报价。</td></tr>
    <tr><td><code>any</code></td><td>至少一个分支有输出就成功，未完成的分支留在 <code>missing</code> 里。</td><td>多个冗余数据源取其一，或「能拿到多少算多少」的聚合。</td></tr>
  </tbody>
</table>
<p>用 <code>any</code> 时下游一定要检查 <code>missing</code>，否则会把缺失字段当成正常值用下去。</p>`,
      },
      {
        id: "pitfalls",
        title: "两个容易踩的坑",
        params: [],
        body: `<h3>1. 分支节点 ID 不能含连字符</h3>
<p><code>join</code> 的 <code>results</code> 是以节点 ID 为键的对象，引用时写 <code>\${merge.output.results.fetchPricing}</code>。但表达式引擎<strong>只支持点号访问合法标识符，不支持 <code>[...]</code> 下标访问</strong> —— 所以 <code>fetch-pricing</code> 这种带连字符的 ID 在表达式里取不出来（会被解析成减法）。</p>
<p>凡是要被 <code>join</code> 汇聚、并在下游引用的分支，节点 ID 一律用 <code>camelCase</code>。</p>
<h3>2. transform 里的字面量字符串要自己加引号</h3>
<p><code>transform.config.output</code> 的每个值都是<strong>直接交给表达式引擎求值</strong>，不是字符串插值。所以写 <code>"label": "order total"</code> 会被当成非法表达式，必须写成：</p>
<pre><code>{ "output": { "label": "'order total'" } }</code></pre>
<div class="callout">
  <p>这正是 <code>transform</code> 与 <code>http</code> / <code>notification</code> 等节点里 <code>\${...}</code> 的区别：后者是字符串插值，结果会被转成字符串拼进模板；<code>transform</code> 求值后<strong>保留原生类型</strong>，数字还是数字，数组还是数组。</p>
</div>`,
      },
      {
        id: "why",
        title: "为什么值得用它替代 action",
        params: [],
        body: `<p>这套组合最实际的价值是：<strong>整条流水线是纯 JSON，没有 JS 闭包</strong>。</p>
<p><code>action</code> 节点携带函数闭包，无法序列化到本地文件存储 —— 用了 <code>action</code> 的工作流在进程重启后必须由应用代码重新注册定义，才能调 <code>resumeRunningInstancesFromStorage()</code> 恢复实例（见 <a href="/docs/concepts/storage">本地文件持久化</a>）。</p>
<p>而扇出 + <code>join</code> + <code>transform</code> 全部是声明式配置，工作流定义可以完整存盘、完整恢复，也可以通过 REST API 动态下发，不需要改代码重新部署。数据整形这类原本只能写在 <code>action</code> 里的逻辑，用 <code>transform</code> 就能覆盖大部分。</p>`,
      },
    ],
    codeGroups: [
      {
        title: "完整示例",
        badge: "JSON",
        samples: [
          {
            label: "工作流",
            language: "json",
            code: `{
  "fanout": {
    "id": "fanout",
    "type": "action",
    "action": "prepareQuery",
    "next": ["fetchInventory", "fetchPricing"]
  },

  "fetchInventory": {
    "id": "fetchInventory",
    "type": "http",
    "config": {
      "method": "GET",
      "url": "https://api.example.com/inventory/\${context.sku}"
    },
    "next": ["merge"]
  },

  "fetchPricing": {
    "id": "fetchPricing",
    "type": "http",
    "config": {
      "method": "GET",
      "url": "https://api.example.com/pricing/\${context.sku}"
    },
    "next": ["merge"]
  },

  "merge": {
    "id": "merge",
    "type": "join",
    "config": {
      "waitFor": ["fetchInventory", "fetchPricing"],
      "mode": "all"
    },
    "next": ["reshape"]
  },

  "reshape": {
    "id": "reshape",
    "type": "transform",
    "config": {
      "output": {
        "sku": "\${context.sku}",
        "inStock": "\${merge.output.results.fetchInventory.body.qty > 0}",
        "qty": "\${merge.output.results.fetchInventory.body.qty}",
        "price": "\${merge.output.results.fetchPricing.body.amount}",
        "currency": "\${merge.output.results.fetchPricing.body.currency}"
      }
    },
    "next": ["respond"]
  }
}`,
          },
          {
            label: "join 输出",
            language: "json",
            code: `{
  "results": {
    "fetchInventory": {
      "status": 200,
      "body": { "qty": 12, "warehouse": "SH-01" }
    },
    "fetchPricing": {
      "status": 200,
      "body": { "amount": 199.99, "currency": "CNY" }
    }
  },
  "missing": []
}`,
          },
          {
            label: "transform 输出",
            language: "json",
            code: `{
  "sku": "SKU-221",
  "inStock": true,
  "qty": 12,
  "price": 199.99,
  "currency": "CNY"
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "concurrency",
    title: "并发控制与 Lease",
    lede: "CAS 版本校验解决 Lost Update，Lease 自动续期防止长任务被误判超时。",
    group: "执行与并发",
    sections: [
      {
        id: "cas",
        title: "并发控制（CAS）",
        params: [],
        body: `<p><code>WorkflowInstance</code> 携带 <code>version</code> 字段。每次更新实例状态时，存储层会比对期望版本号，版本不一致（说明有并发写入）则更新失败并自动重试，从根本上避免 Lost Update 问题。</p>
<p>实现见 <code>src/engine/ConcurrencyControl.ts</code>。</p>`,
      },
      {
        id: "lease",
        title: "Lease 自动续期",
        params: [],
        body: `<p>防止长运行任务因超时被误判为失败而重复执行。任务开始时获取一个带过期时间的 Lease，<code>LeaseStore.startAutoRenewal()</code> 在后台周期性续期，任务结束或进程退出时释放。</p>
<div class="callout">
  <p>单进程内存实现，<strong>不提供跨进程协调</strong>；实现见 <code>src/utils/LeaseStore.ts</code>。</p>
</div>`,
      },
      {
        id: "heartbeat",
        title: "Heartbeat 跟踪",
        params: [],
        body: `<p>长时间运行的 <code>action</code> 节点可通过 <code>heartbeat</code> 配置定期上报进度。<code>HeartbeatTracker</code> 通过 <code>StorageProvider</code> 保存和恢复 Heartbeat 状态：使用默认 <code>LocalFileStorage</code> 时可跨进程重启恢复，使用 <code>MemoryStorage</code> 时仅在当前进程生命周期内保留。</p>
<p>实现见 <code>src/engine/HeartbeatTracker.ts</code>。</p>`,
      },
    ],
  },
  {
    slug: "worker-pool",
    title: "Worker 线程池与任务队列",
    lede: "http 节点卸载到 worker 线程，action / rollback 可路由到命名队列。",
    group: "执行与并发",
    sections: [
      {
        id: "worker-pool",
        title: "Worker 线程池与 Sticky 亲和性",
        params: [],
        body: `<p><code>WORKER_POOL_ENABLED=true</code> 时，<code>http</code> 节点卸载到 worker 线程执行。每个 worker 有稳定 <code>workerId</code>；同一实例的后续任务优先路由回已绑定的 worker（<code>WORKER_STICKY_ENABLED</code>）。</p>
<p>绑定的 worker 忙碌时会回退到任意空闲 worker —— <strong>亲和性只做优化，不会阻塞任务</strong>。worker 退出或池关闭时释放绑定，避免实例被绑死在已终止的线程上。</p>
<p>实现见 <code>src/engine/worker/WorkerPool.ts</code> 与 <code>src/engine/StickyExecutionPolicy.ts</code>。</p>`,
      },
      {
        id: "task-queue",
        title: "任务队列路由（TaskQueueManager）",
        params: [],
        body: `<p><code>action</code> / <code>rollback</code> 节点可通过 <code>taskQueue: "queue-name"</code> 路由到命名队列。队列 worker 通过 <code>taskQueueManager.registerWorker()</code> 注册，受 <code>maxConcurrent</code> 限流；队列无 worker 时回退为本地直接执行，节点不会被卡住。</p>
<div class="callout">
  <p>与 <code>queue</code> <strong>节点类型</strong>不同：后者对接外部消息中间件，这里是进程内的工作分发。实现见 <code>src/engine/TaskQueueManager.ts</code>。</p>
</div>`,
      },
    ],
  },
  {
    slug: "storage",
    title: "本地文件持久化",
    lede: "原子 rename 写入、损坏记录隔离、跨重启恢复与 fsync 取舍。",
    group: "持久化",
    sections: [
      {
        id: "layout",
        title: "存储布局",
        params: [],
        body: `<p>非测试环境默认使用 <code>LocalFileStorage</code>，数据目录由 <code>STORAGE_DIR</code> 指定（默认 <code>.ts-workflow-engine-data/</code>）。每条记录独立保存为 JSON 文件，通过临时文件 + 原子 rename 更新，避免写入过程中数据损坏。</p>
<p>数据按 <code>instances</code>、<code>workflows</code>、<code>workflow-versions</code>、<code>waiting</code>、<code>metrics</code>、<code>events</code>、<code>heartbeats</code>、<code>dlq</code> 等目录分类；启动时无法解析的记录会被隔离到对应分类下的 <code>corrupt/</code> 目录，不阻断其余数据恢复。</p>
<div class="callout">
  <p>含 JavaScript 函数/闭包的工作流定义<strong>无法序列化</strong>。启动时应先关闭自动恢复、由应用代码重新注册这些定义，再调用 <code>engine.resumeRunningInstancesFromStorage()</code> 恢复未完成实例。</p>
  <p>本地文件存储不提供跨进程锁，同一个 <code>STORAGE_DIR</code> 只能由一个引擎进程使用。</p>
</div>`,
      },
      {
        id: "fsync",
        title: "fsync 取舍",
        params: [],
        body: `<p><code>FSYNC_ON_WRITE=true</code> 时，<code>LocalFileStorage</code> 写入会 fsync 临时文件和所在目录，换取主机级崩溃/断电下的持久性（代价是写入延迟明显增加）；默认 <code>false</code>，仅保证原子 rename 后文件本身完整。</p>
<p>fsync <strong>按集合生效</strong>：<code>instances</code>、<code>events</code>、<code>waiting</code>、<code>workflows*</code>、<code>dlq</code>、<code>webhooks*</code> 等系统记录与审计历史会 fsync；<code>metrics</code> 与 <code>heartbeats</code> <strong>不会</strong> —— 它们是纯派生的可观测性数据，却占了每节点 3 次写入中的 2 次，fsync 它们会让每个节点执行都为没人需要的持久性买单。</p>
<p>代价是主机级崩溃可能丢失最近的 metrics 与 heartbeat，实例状态与事件历史不受影响。需要时可通过 <code>LocalFileStorageOptions.fsyncCollections</code> 显式覆盖。</p>`,
      },
      {
        id: "archive",
        title: "终态实例归档",
        params: [],
        body: `<p>归档默认关闭，通过 <code>ARCHIVE_ENABLED=true</code> 启用。终态实例写入 <code>archive/YYYY-MM-DD/&lt;instanceId&gt;.json</code> 后，才从热存储移除。<code>ARCHIVE_RETENTION_DAYS</code> 控制日期分区保留时间，<code>ARCHIVE_CLEANUP_INTERVAL_MS</code> 控制清理周期。</p>
<div class="callout">
  <p>归档文件是冷数据，<strong>不会自动参与实例查询或启动恢复</strong>。</p>
</div>`,
      },
      {
        id: "storage-middleware",
        title: "存储中间件",
        params: [],
        body: `<p><code>withStorageMetrics(storage, onTiming)</code> 与 <code>withStorageCache(storage, options)</code> 可包装任意 <code>StorageProvider</code> 实现，均从包根与 <code>src/storage/index.ts</code> 导出。两者都基于 <code>Proxy</code> 透明转发所有方法（包括未来新增到接口的方法），不需要为 40+ 方法的接口手写委托。</p>
<pre><code>import { withStorageCache, withStorageMetrics } from "ts-workflow-engine-lite";

let storage = await createStorage();
storage = withStorageMetrics(storage, (method, durationMs) =&gt; {
  metrics.record(\`storage.\${method}\`, durationMs);
});
storage = withStorageCache(storage, { ttlMs: 5000 });</code></pre>
<div class="callout">
  <p><code>withStorageCache</code> 默认只对 <code>loadInstance</code>/<code>loadWorkflow</code> 做单进程读缓存 —— 多个进程共享同一存储后端时不安全，因为它没有跨进程失效信号。</p>
</div>
<p>实现见 <code>src/storage/middleware.ts</code>。</p>`,
      },
    ],
    codeGroups: [
      {
        title: "环境变量",
        badge: "env",
        samples: [
          {
            label: ".env",
            language: "bash",
            code: `STORAGE_TYPE=file
STORAGE_DIR=/var/lib/ts-workflow-engine-lite

# 主机级崩溃防护（写入变慢，约 1500 → 87 ops/s）
FSYNC_ON_WRITE=false

# 启动恢复并发度，实例数上万时可调大
STORAGE_RESTORE_CONCURRENCY=16

# 终态实例归档
ARCHIVE_ENABLED=false
ARCHIVE_RETENTION_DAYS=30`,
          },
        ],
      },
    ],
  },
  {
    slug: "secrets",
    title: "密钥解析",
    lede: "节点配置中用 ${secret:NAME} 占位，执行前由 SecretManager 解析。",
    group: "持久化",
    sections: [
      {
        id: "secrets",
        title: "密钥解析（SecretManager）",
        params: [],
        body: `<p>节点配置中可写 <code>\${secret:NAME}</code>，在 <code>http</code> / <code>sql</code> / <code>queue</code> 节点执行前解析（含嵌套字段）。由 <code>SECRET_PROVIDER</code> 选择后端，默认 <code>env</code>（从环境变量读取）。</p>
<div class="callout">
  <p><code>vault</code> / <code>aws-secrets-manager</code> <strong>尚未实现</strong>，配置后在启动时抛 <code>UnsupportedSecretProviderError</code>，不会静默回退。</p>
  <p>未找到的密钥<strong>保留原样</strong>并记录 warn 日志，不会替换成 <code>undefined</code>。</p>
</div>
<p>实现见 <code>src/utils/SecretManager.ts</code> 与 <code>src/utils/secrets.ts</code>。</p>`,
      },
    ],
    codeGroups: [
      {
        title: "用法",
        badge: "JSON",
        samples: [
          {
            label: "节点配置",
            language: "json",
            code: `{
  "type": "http",
  "config": {
    "method": "GET",
    "url": "https://api.example.com/data",
    "headers": {
      "Authorization": "Bearer \${secret:API_TOKEN}"
    }
  }
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "instance-control",
    title: "实例控制 API",
    lede: "运行中的实例不是只能等它跑完：retry / skip / compensate / signal。",
    group: "运维与集成",
    sections: [
      {
        id: "operations",
        title: "干预操作",
        params: [],
        body: `<p>运行中的实例不是只能等它跑完 —— 针对失败与卡住两种场景，引擎提供了一组干预端点：</p>
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
  <p>示例见 <code>examples/instance-control-api.ts</code>，覆盖 retry / skip / compensate 与节点状态查询的完整调用链。</p>
</div>`,
      },
    ],
    codeGroups: [
      {
        title: "调用示例",
        badge: "bash",
        samples: [
          {
            label: "cURL",
            language: "bash",
            code: `# 唤醒等待中的节点
curl --request POST \\
  --url 'http://localhost:3345/workflow-api/v1/instances/<id>/signal' \\
  --header 'Content-Type: application/json' \\
  --data '{ "name": "approve", "payload": { "by": "u_1" } }'

# 暂停 / 恢复 / 取消
curl -X POST '.../instances/<id>/pause'
curl -X POST '.../instances/<id>/resume'
curl -X POST '.../instances/<id>/cancel'`,
          },
        ],
      },
    ],
  },
  {
    slug: "errors",
    title: "错误处理与死信队列",
    lede: "具名错误类支持 instanceof 判断，超过重试策略的节点进入 DLQ。",
    group: "运维与集成",
    sections: [
      {
        id: "named-errors",
        title: "具名错误类",
        params: [],
        body: `<p>高频失败模式用具名错误类导出，<code>instanceof</code> 精确捕获而非匹配错误消息字符串：</p>
<table>
  <thead><tr><th>错误类</th><th>触发场景</th></tr></thead>
  <tbody>
    <tr><td><code>WorkflowNotFoundError</code></td><td>启动未注册的工作流。</td></tr>
    <tr><td><code>InstanceNotFoundError</code></td><td>查询/信号不存在的实例，常见于拼写错误、已归档或来自不同 <code>STORAGE_DIR</code> 的实例。</td></tr>
    <tr><td><code>ConcurrencyConflictError</code></td><td>CAS 版本冲突。</td></tr>
    <tr><td><code>LockAcquisitionError</code></td><td>锁获取失败。</td></tr>
  </tbody>
</table>`,
      },
      {
        id: "dlq",
        title: "死信队列",
        params: [],
        body: `<p>节点抛出异常后按重试策略自动重试（<code>instance.retries</code> 记录次数）；超过策略仍失败的节点最终进入死信队列，通过 <code>GET /workflow-api/v1/dlq</code> 查询，不会无限循环占用调度资源，便于事后排查与人工补偿。</p>
<div class="callout">
  <p>示例见 <code>examples/error-handling.ts</code> 与 <code>examples/graceful-degradation.ts</code>。</p>
</div>`,
      },
    ],
    codeGroups: [
      {
        title: "捕获示例",
        badge: "TS",
        samples: [
          {
            label: "TypeScript",
            language: "typescript",
            code: `import {
  InstanceNotFoundError,
  ConcurrencyConflictError,
} from "ts-workflow-engine-lite";

try {
  await engine.sendSignal(instanceId, "approve", payload);
} catch (error) {
  if (error instanceof InstanceNotFoundError) {
    // 实例不存在：拼写错误、已归档，或来自别的 STORAGE_DIR
    return reply.status(404).send({ message: error.message });
  }
  if (error instanceof ConcurrencyConflictError) {
    // CAS 冲突：重新读取后重试
    return retry();
  }
  throw error;
}`,
          },
        ],
      },
    ],
  },
  {
    slug: "webhooks",
    title: "通知与 Webhook",
    lede: "notification 节点向外推送，WebhookManager 广播系统生命周期事件。",
    group: "运维与集成",
    sections: [
      {
        id: "channels",
        title: "通知渠道",
        params: [],
        body: `<p><code>notification</code> 节点通过通知渠道向外部推送消息：内置 <code>WebhookChannel</code>（通用 HTTP Webhook）与 <code>SlackChannel</code>（Slack Incoming Webhook，需配置 webhook URL），可在工作流任意位置插入通知动作。</p>`,
      },
      {
        id: "webhook-manager",
        title: "WebhookManager",
        params: [],
        body: `<p>引擎侧的 WebhookManager 会在系统生命周期事件发生时触发已注册的 Webhook 接收器；Webhook 注册与投递记录均<strong>持久化到存储</strong>（重启后自动恢复），Console WebSocket 同时向控制台实时广播同一份事件流，方便在 Playground / 自建控制台中观察执行动态。</p>
<p>事件也可由外部主动驱动：<code>GET /workflow-api/v1/events</code> 支持查询与触发事件，配合 <code>event</code> 节点实现外部系统与工作流的双向集成。</p>`,
      },
    ],
  },
  {
    slug: "embedding",
    title: "嵌入宿主应用",
    lede: "把工作流 API 挂载为普通 express.Router，无需独立进程。",
    group: "运维与集成",
    sections: [
      {
        id: "router",
        title: "createWorkflowRouter",
        params: [],
        body: `<p><code>createWorkflowRouter()</code> / <code>createWorkflowRouterBundle()</code> 允许宿主 Express 应用将工作流 API 挂载为普通 <code>express.Router</code>，无需通过 <code>startApiServer()</code> 独立运行；<code>server.ts</code> 内部也复用同一套路由装配逻辑。</p>
<p><code>HttpNodeConfig</code> / <code>SqlNodeConfig</code> / <code>QueueNodeConfig</code> 等类型与 SQL/Queue 连接池注册函数已从包根重导出，外部消费方无需深入 <code>dist/src/engine/executors/*</code>。</p>
<div class="callout">
  <p>示例见 <code>examples/embedded-express-app.ts</code> 与 <code>examples/error-handling.ts</code>。</p>
</div>`,
      },
    ],
    codeGroups: [
      {
        title: "挂载示例",
        badge: "TS",
        samples: [
          {
            label: "TypeScript",
            language: "typescript",
            code: `import express from "express";
import { bootstrap, createWorkflowRouter } from "ts-workflow-engine-lite";

const ctx = await bootstrap({ skipGracefulShutdown: true });
const app = express();

// 挂到宿主应用自己的路径下
app.use("/internal/workflows", createWorkflowRouter(ctx));

app.listen(8080);`,
          },
        ],
      },
    ],
  },
];

/** 侧栏分组顺序。 */
const GROUP_ORDER = ["表达式与数据", "执行与并发", "持久化", "运维与集成"];

function navGroups(activeSlug?: string): NavGroup[] {
  return [
    {
      title: "总览",
      items: [
        {
          href: "/docs/concepts",
          label: "全部概念",
          active: activeSlug === undefined,
        },
      ],
    },
    ...GROUP_ORDER.map((group) => ({
      title: group,
      items: TOPICS.filter((t) => t.group === group).map((t) => ({
        href: `/docs/concepts/${t.slug}`,
        label: t.title,
        active: t.slug === activeSlug,
      })),
    })),
  ];
}

function pagerFor(slug: string): Pick<DocPage, "prev" | "next"> {
  // 按侧栏顺序（分组顺序内的主题顺序）而不是 TOPICS 的声明顺序翻页
  const ordered = GROUP_ORDER.flatMap((g) =>
    TOPICS.filter((t) => t.group === g),
  );
  const i = ordered.findIndex((t) => t.slug === slug);
  const prev = i > 0 ? ordered[i - 1] : undefined;
  const next = i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : undefined;

  return {
    prev: prev
      ? { href: `/docs/concepts/${prev.slug}`, label: prev.title }
      : { href: "/docs/concepts", label: "全部概念" },
    next: next
      ? { href: `/docs/concepts/${next.slug}`, label: next.title }
      : undefined,
  };
}

/** 单个概念主题页。slug 不存在时返回 null，由路由转 404。 */
export function generateConceptDocHtml(slug: string): string | null {
  const topic = TOPICS.find((t) => t.slug === slug);
  if (!topic) return null;

  const page: DocPage = {
    eyebrow: topic.group,
    title: topic.title,
    lede: topic.lede,
    sections: topic.sections,
    codeGroups: topic.codeGroups ?? [],
    nav: navGroups(slug),
    ...pagerFor(slug),
  };

  return renderDocPage(page, TOPBAR);
}

/**
 * 总览页上的旧锚点重定向脚本。映射表在构建时内联进页面，
 * 运行时只做一次 hash 查表 + location.replace（不留历史记录）。
 */
const LEGACY_REDIRECT_SCRIPT = `
(function(){
  var hash = location.hash.slice(1);
  if (!hash) return;
  var MAP = __LEGACY_MAP__;
  // #node-http 这类锚点指向已迁走的节点章节
  if (hash.indexOf("node-") === 0 && !MAP[hash]) {
    location.replace("/docs/nodes/" + encodeURIComponent(hash.slice(5)));
    return;
  }
  if (MAP[hash]) location.replace(MAP[hash]);
})();
`;

/** 概念总览页。 */
export function generateConceptIndexHtml(): string {
  const sections: ParamSection[] = GROUP_ORDER.map((group) => ({
    title: group,
    subtitle: `${TOPICS.filter((t) => t.group === group).length} 篇`,
    params: TOPICS.filter((t) => t.group === group).map((t) => ({
      name: t.title,
      type: t.slug,
      required: false,
      description: t.lede,
    })),
  }));

  const ordered = GROUP_ORDER.flatMap((g) =>
    TOPICS.filter((t) => t.group === g),
  );

  const page: DocPage = {
    eyebrow: "参考",
    title: "核心概念",
    lede: "引擎的执行模型、并发语义、持久化行为与集成方式。节点字段参考见「节点参考」，端点参数见「REST API」。",
    // 锚点不会发到服务端，旧链接的重定向只能在浏览器里做
    inlineScript: LEGACY_REDIRECT_SCRIPT.replace(
      "__LEGACY_MAP__",
      JSON.stringify(LEGACY_ANCHOR_REDIRECTS),
    ),
    sections,
    codeGroups: [
      {
        title: "相关页面",
        badge: "链接",
        samples: [
          {
            label: "导航",
            language: "bash",
            code: `# 15 种节点类型的完整字段参考
/docs/nodes

# 50 个 REST 端点的参数与响应
/api-docs

# 机器可读的 OpenAPI 规范
/api-docs/openapi.json

# 在线试跑工作流
/playground`,
          },
        ],
      },
    ],
    nav: navGroups(undefined),
    next: ordered[0]
      ? { href: `/docs/concepts/${ordered[0].slug}`, label: ordered[0].title }
      : undefined,
  };

  return renderDocPage(page, TOPBAR);
}

/**
 * 旧的单页锚点 → 新主题页的映射。
 *
 * 原 /docs/concepts#expressions 这类链接散落在 README、首页卡片和外部
 * 引用里，直接失效会留下一堆死链。锚点不会发送到服务端，所以重定向只能
 * 在浏览器里做：概念总览页加载时读 location.hash 并 replace 跳转。
 *
 * `#node-<type>` 这类锚点指向的是已经迁走的节点章节，统一转到
 * /docs/nodes/<type>。
 */
export const LEGACY_ANCHOR_REDIRECTS: Record<string, string> = {
  "node-output": "/docs/concepts/node-output",
  expressions: "/docs/concepts/expressions",
  operators: "/docs/concepts/expressions#operators",
  functions: "/docs/concepts/expressions#functions",
  cas: "/docs/concepts/concurrency#cas",
  lease: "/docs/concepts/concurrency#lease",
  heartbeat: "/docs/concepts/concurrency#heartbeat",
  storage: "/docs/concepts/storage",
  secrets: "/docs/concepts/secrets",
  "worker-pool": "/docs/concepts/worker-pool#worker-pool",
  "task-queue": "/docs/concepts/worker-pool#task-queue",
  archive: "/docs/concepts/storage#archive",
  integration: "/docs/concepts/embedding",
  "join-transform": "/docs/concepts/fanout-join",
  "instance-control": "/docs/concepts/instance-control",
  errors: "/docs/concepts/errors",
  webhooks: "/docs/concepts/webhooks",
};
