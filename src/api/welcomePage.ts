/**
 * 首页使用说明：介绍核心节点类型、常用 API 端点和快速上手示例。
 */

interface NodeTypeInfo {
  type: string;
  label: string;
  desc: string;
}

const NODE_TYPES: NodeTypeInfo[] = [
  { type: "action", label: "动作", desc: "执行自定义函数逻辑" },
  { type: "wait", label: "等待", desc: "延时或等待指定时长" },
  { type: "event", label: "事件", desc: "等待外部事件触发后继续" },
  { type: "rollback", label: "回滚", desc: "执行补偿/回滚逻辑" },
  { type: "subworkflow", label: "子工作流", desc: "调用另一个工作流定义" },
  { type: "http", label: "HTTP", desc: "发起 HTTP 请求" },
  { type: "sql", label: "SQL", desc: "执行 SQL 查询/语句" },
  { type: "queue", label: "队列", desc: "消息队列生产/消费" },
  { type: "condition", label: "条件", desc: "基于表达式的分支判断" },
  { type: "router", label: "路由", desc: "多分支路由选择" },
  { type: "loop", label: "循环", desc: "循环执行子节点" },
  { type: "approval", label: "审批", desc: "等待人工审批" },
  { type: "notification", label: "通知", desc: "发送通知消息" },
  { type: "join", label: "汇聚", desc: "等待多个并行分支全部/任一完成" },
  { type: "transform", label: "转换", desc: "按表达式重塑节点输出数据" },
];

interface EndpointInfo {
  method: string;
  path: string;
  desc: string;
}

const ENDPOINTS: EndpointInfo[] = [
  { method: "GET", path: "/workflow-api/v1/health", desc: "健康检查" },
  {
    method: "GET",
    path: "/workflow-api/v1/workflows",
    desc: "查询工作流定义列表",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/workflows",
    desc: "注册新的工作流定义",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/instances",
    desc: "启动一个工作流实例",
  },
  {
    method: "GET",
    path: "/workflow-api/v1/instances/:id",
    desc: "查询实例状态",
  },
  {
    method: "POST",
    path: "/workflow-api/v1/instances/:id/signal",
    desc: "向运行中实例发送 Signal",
  },
  { method: "GET", path: "/workflow-api/v1/events", desc: "触发/查询事件" },
  { method: "GET", path: "/workflow-api/v1/templates", desc: "查询节点模板" },
  {
    method: "GET",
    path: "/workflow-api/v1/analytics",
    desc: "查询运行分析指标",
  },
  { method: "GET", path: "/workflow-api/v1/dlq", desc: "查询死信队列" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generateWelcomeHtml(port: number): string {
  const nodeRows = NODE_TYPES.map(
    (n) =>
      `<tr><td><code>${escapeHtml(n.type)}</code></td><td>${escapeHtml(n.label)}</td><td>${escapeHtml(n.desc)}</td></tr>`,
  ).join("\n");

  const endpointRows = ENDPOINTS.map(
    (e) =>
      `<tr><td><span class="method method-${e.method.toLowerCase()}">${e.method}</span></td><td><code>${escapeHtml(e.path)}</code></td><td>${escapeHtml(e.desc)}</td></tr>`,
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ts-workflow-engine-lite 使用说明</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    background: #0f172a;
    color: #e2e8f0;
    line-height: 1.6;
  }
  header {
    padding: 48px 24px 32px;
    text-align: center;
    background: linear-gradient(135deg, #1e293b, #0f172a);
    border-bottom: 1px solid #1e293b;
  }
  header h1 { margin: 0 0 8px; font-size: 28px; }
  header p { margin: 0; color: #94a3b8; }
  .badge {
    display: inline-block;
    margin-top: 12px;
    padding: 4px 12px;
    border-radius: 999px;
    background: #16a34a22;
    color: #4ade80;
    font-size: 13px;
    border: 1px solid #16a34a55;
  }
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 24px 80px;
  }
  section { margin-bottom: 40px; }
  h2 {
    font-size: 18px;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #1e293b;
    color: #f1f5f9;
  }
  .links { display: flex; flex-wrap: wrap; gap: 12px; }
  .links a {
    display: inline-block;
    padding: 10px 18px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    color: #e2e8f0;
    text-decoration: none;
    font-size: 14px;
  }
  .links a:hover { background: #334155; }
  .links a.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
  .links a.primary:hover { background: #1d4ed8; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e293b; }
  th { color: #94a3b8; font-weight: 600; }
  code {
    background: #1e293b;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    color: #7dd3fc;
  }
  .method {
    display: inline-block;
    min-width: 48px;
    text-align: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
  }
  .method-get { background: #16a34a33; color: #4ade80; }
  .method-post { background: #2563eb33; color: #60a5fa; }
  pre {
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    font-size: 13px;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  .card {
    display: block;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    padding: 16px;
    text-decoration: none;
    transition: border-color 0.15s, background 0.15s;
  }
  .card:hover { background: #253449; border-color: #475569; }
  .card h3 { margin: 0 0 8px; font-size: 14px; color: #f1f5f9; }
  .card p { margin: 0; font-size: 13px; color: #94a3b8; }
  footer { text-align: center; padding: 24px; color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>ts-workflow-engine-lite</h1>
  <p>轻量级 TypeScript 工作流引擎 &middot; 单进程部署 &middot; 本地文件持久化</p>
  <span class="badge">API 服务运行中 · 端口 ${port}</span>
</header>
<main>
  <section>
    <h2>快速链接</h2>
    <div class="links">
      <a class="primary" href="/playground">Playground · 在线运行示例</a>
      <a href="/api-docs">Swagger API 文档</a>
      <a href="/docs/concepts">核心概念文档</a>
      <a href="/api-docs/openapi.json">OpenAPI JSON</a>
      <a href="/workflow-api/v1/health">健康检查</a>
      <a href="https://github.com/AppleSunCloud/ts-runit-lite" target="_blank" rel="noopener">GitHub 仓库</a>
    </div>
  </section>

  <section>
    <h2>快速上手</h2>
    <pre><code># 查询工作流列表
curl http://localhost:${port}/workflow-api/v1/workflows

# 启动一个工作流实例
curl -X POST http://localhost:${port}/workflow-api/v1/instances \\
  -H "Content-Type: application/json" \\
  -d '{"workflowId": "your-workflow-id", "input": {}}'
</code></pre>
  </section>

  <section>
    <h2>常用 API 端点</h2>
    <table>
      <thead><tr><th>方法</th><th>路径</th><th>说明</th></tr></thead>
      <tbody>
${endpointRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>支持的节点类型（15 种）</h2>
    <table>
      <thead><tr><th>type</th><th>名称</th><th>说明</th></tr></thead>
      <tbody>
${nodeRows}
      </tbody>
    </table>
  </section>

  <section>
    <h2>核心概念 <a href="/docs/concepts" style="font-size:13px;font-weight:400;color:#60a5fa;text-decoration:none;">查看完整文档 &rarr;</a></h2>
    <div class="grid">
      <a class="card" href="/docs/concepts#node-output">
        <h3>节点输出引用</h3>
        <p>使用 <code>\${nodeId.output.path}</code> 引用前置节点的输出，支持表达式计算，如 <code>\${node1.output.price * 0.8}</code>。</p>
      </a>
      <a class="card" href="/docs/concepts#expressions">
        <h3>表达式引擎</h3>
        <p>支持数学/比较/逻辑运算与 20+ 内置函数，如 <code>\${max(a, b)}</code>、<code>\${round(price * 1.1, 2)}</code>。含运算符优先级与函数目录。</p>
      </a>
      <a class="card" href="/docs/concepts#cas">
        <h3>并发控制（CAS）</h3>
        <p>实例携带 version 字段，更新时检测版本冲突并自动重试，避免 Lost Update。</p>
      </a>
      <a class="card" href="/docs/concepts#storage">
        <h3>本地文件持久化</h3>
        <p>默认使用 LocalFileStorage，数据保存在 <code>.ts-runit-data/</code>，支持重启恢复，可选 <code>FSYNC_ON_WRITE</code> 换取更强的持久性。</p>
      </a>
      <a class="card" href="/docs/concepts#join-transform">
        <h3>join / transform 节点</h3>
        <p>join 等待多个并行分支完成（all/any），transform 用类型化表达式重塑节点输出，保留原生数据类型。</p>
      </a>
      <a class="card" href="/docs/concepts#worker-pool">
        <h3>Worker 线程池</h3>
        <p>HTTP 节点可卸载到 worker 线程执行，支持按实例粘性路由回已绑定的 worker。</p>
      </a>
      <a class="card" href="/docs/concepts#integration">
        <h3>外部集成增强</h3>
        <p><code>createWorkflowRouter()</code> 挂载到宿主 Express 应用，具名错误类支持 <code>instanceof</code> 判断。</p>
      </a>
    </div>
  </section>
</main>
<footer>ts-workflow-engine-lite v2.2.0</footer>
</body>
</html>`;
}
