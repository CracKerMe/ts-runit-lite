/**
 * Playground 页面：在浏览器内直接注册并运行示例工作流，实时查看节点执行状态、
 * 输出数据和表达式求值结果。用于直观展示 welcomePage 中列出的节点类型与核心能力。
 */

interface DemoWorkflow {
  id: string;
  label: string;
  desc: string;
  definition: Record<string, unknown>;
  input: Record<string, unknown>;
}

const DEMO_WORKFLOWS: DemoWorkflow[] = [
  {
    id: "playground-condition-transform",
    label: "条件路由 + 表达式转换",
    desc: "condition / transform 节点：按金额分流，并用表达式重塑输出",
    definition: {
      id: "playground-condition-transform",
      name: "条件路由与转换示例",
      version: "1.0.0",
      startNode: "check-amount",
      nodes: {
        "check-amount": {
          id: "check-amount",
          type: "condition",
          config: {
            condition: "context.amount > 1000",
            trueBranch: "premium-quote",
            falseBranch: "standard-quote",
          },
        },
        "premium-quote": {
          id: "premium-quote",
          type: "transform",
          config: {
            output: {
              tier: "'premium'",
              price: "round(context.amount * 0.85, 2)",
              message: "'VIP 折扣已应用'",
            },
          },
          next: [],
        },
        "standard-quote": {
          id: "standard-quote",
          type: "transform",
          config: {
            output: {
              tier: "'standard'",
              price: "round(context.amount * 0.95, 2)",
              message: "'标准折扣已应用'",
            },
          },
          next: [],
        },
      },
    },
    input: { amount: 1500 },
  },
  {
    id: "playground-router",
    label: "多分支路由（router）",
    desc: "router 节点按优先级依次匹配条件，命中后跳转到对应分支",
    definition: {
      id: "playground-router",
      name: "多分支路由示例",
      version: "1.0.0",
      startNode: "route-by-tier",
      nodes: {
        "route-by-tier": {
          id: "route-by-tier",
          type: "router",
          config: {
            routes: [
              {
                condition: "context.tier == 'gold'",
                target: "gold-flow",
                priority: 1,
              },
              {
                condition: "context.tier == 'silver'",
                target: "silver-flow",
                priority: 2,
              },
            ],
            defaultTarget: "standard-flow",
          },
          next: [],
        },
        "gold-flow": {
          id: "gold-flow",
          type: "transform",
          config: { output: { perk: "'专属客服 + 9 折'" } },
        },
        "silver-flow": {
          id: "silver-flow",
          type: "transform",
          config: { output: { perk: "'95 折优惠'" } },
        },
        "standard-flow": {
          id: "standard-flow",
          type: "transform",
          config: { output: { perk: "'标准服务'" } },
        },
      },
    },
    input: { tier: "gold" },
  },
  {
    id: "playground-wait-loop",
    label: "等待 + 循环",
    desc: "wait 节点做短暂延时，loop 节点对数组逐项执行子节点",
    definition: {
      id: "playground-wait-loop",
      name: "等待与循环示例",
      version: "1.0.0",
      startNode: "pause",
      nodes: {
        pause: {
          id: "pause",
          type: "wait",
          config: { durationMs: 200 },
          next: ["process-items"],
        },
        "process-items": {
          id: "process-items",
          type: "loop",
          config: {
            collection: "context.items",
            itemVariable: "item",
            body: "double-item",
          },
          next: [],
        },
        "double-item": {
          id: "double-item",
          type: "transform",
          config: { output: { doubled: "item * 2" } },
        },
      },
    },
    input: { items: [1, 2, 3, 4] },
  },
  {
    id: "playground-order-fulfillment",
    label: "订单履约：校验 + 分级 + 转换",
    desc: "模拟电商订单处理：先校验金额，再按会员等级计算积分与配送策略",
    definition: {
      id: "playground-order-fulfillment",
      name: "订单履约示例",
      version: "1.0.0",
      startNode: "validate-order",
      nodes: {
        "validate-order": {
          id: "validate-order",
          type: "condition",
          config: {
            condition: "context.total > 0 && context.itemsCount > 0",
            trueBranch: "route-member",
            falseBranch: "invalid-order",
          },
        },
        "route-member": {
          id: "route-member",
          type: "router",
          config: {
            routes: [
              {
                condition: "context.memberLevel == 'gold'",
                target: "gold-order",
                priority: 1,
              },
              {
                condition: "context.memberLevel == 'silver'",
                target: "silver-order",
                priority: 2,
              },
            ],
            defaultTarget: "standard-order",
          },
        },
        "gold-order": {
          id: "gold-order",
          type: "transform",
          config: {
            output: {
              shipping: "'免运费'",
              points: "round(context.total * 2, 0)",
              priority: "'high'",
            },
          },
        },
        "silver-order": {
          id: "silver-order",
          type: "transform",
          config: {
            output: {
              shipping: "'满 99 免运费'",
              points: "round(context.total * 1.5, 0)",
              priority: "'normal'",
            },
          },
        },
        "standard-order": {
          id: "standard-order",
          type: "transform",
          config: {
            output: {
              shipping: "'按实际运费'",
              points: "round(context.total, 0)",
              priority: "'normal'",
            },
          },
        },
        "invalid-order": {
          id: "invalid-order",
          type: "transform",
          config: {
            output: { accepted: "false", reason: "'订单缺少商品或金额无效'" },
          },
        },
      },
    },
    input: { total: 268, itemsCount: 3, memberLevel: "gold" },
  },
  {
    id: "playground-fraud-review",
    label: "风控审核：风险分层",
    desc: "根据订单金额、设备风险和历史拒付次数，选择自动放行、人工审核或拦截",
    definition: {
      id: "playground-fraud-review",
      name: "风控审核示例",
      version: "1.0.0",
      startNode: "risk-router",
      nodes: {
        "risk-router": {
          id: "risk-router",
          type: "router",
          config: {
            routes: [
              {
                condition:
                  "context.deviceRisk == 'high' || context.chargebacks >= 2",
                target: "block-payment",
                priority: 1,
              },
              {
                condition:
                  "context.amount >= 1000 || context.deviceRisk == 'medium'",
                target: "manual-review",
                priority: 2,
              },
            ],
            defaultTarget: "auto-approve",
          },
        },
        "block-payment": {
          id: "block-payment",
          type: "transform",
          config: {
            output: {
              decision: "'blocked'",
              score: "100",
              message: "'交易被风控拦截'",
            },
          },
        },
        "manual-review": {
          id: "manual-review",
          type: "transform",
          config: {
            output: {
              decision: "'review'",
              score: "60",
              message: "'需要人工复核'",
            },
          },
        },
        "auto-approve": {
          id: "auto-approve",
          type: "transform",
          config: {
            output: {
              decision: "'approved'",
              score: "10",
              message: "'低风险，自动放行'",
            },
          },
        },
      },
    },
    input: { amount: 680, deviceRisk: "low", chargebacks: 0 },
  },
  {
    id: "playground-parallel-checks",
    label: "并行检查 + 汇聚",
    desc: "从同一入口并行执行库存、地址和优惠券检查，最后用 join 汇总结果",
    definition: {
      id: "playground-parallel-checks",
      name: "并行检查与汇聚示例",
      version: "1.0.0",
      startNode: "start-checks",
      nodes: {
        "start-checks": {
          id: "start-checks",
          type: "transform",
          config: { output: { started: "true" } },
          next: ["check-stock", "check-address", "check-coupon"],
        },
        "check-stock": {
          id: "check-stock",
          type: "transform",
          config: { output: { stock: "context.stock >= context.quantity" } },
          next: ["all-checks"],
        },
        "check-address": {
          id: "check-address",
          type: "transform",
          config: { output: { addressValid: "context.address != ''" } },
          next: ["all-checks"],
        },
        "check-coupon": {
          id: "check-coupon",
          type: "transform",
          config: { output: { couponValid: "context.coupon != ''" } },
          next: ["all-checks"],
        },
        "all-checks": {
          id: "all-checks",
          type: "join",
          config: {
            waitFor: ["check-stock", "check-address", "check-coupon"],
            mode: "all",
          },
          next: ["checkout-result"],
        },
        "checkout-result": {
          id: "checkout-result",
          type: "transform",
          config: {
            output: {
              ready:
                "context.stock >= context.quantity && context.address != '' && context.coupon != ''",
              summary: "'并行检查已完成'",
            },
          },
        },
      },
    },
    input: {
      stock: 8,
      quantity: 2,
      address: "上海市浦东新区",
      coupon: "WELCOME10",
    },
  },
  {
    id: "playground-data-pipeline",
    label: "数据清洗管道",
    desc: "等待上游数据到达后循环处理记录，并统一生成可消费的数据结构",
    definition: {
      id: "playground-data-pipeline",
      name: "数据清洗管道示例",
      version: "1.0.0",
      startNode: "wait-upstream",
      nodes: {
        "wait-upstream": {
          id: "wait-upstream",
          type: "wait",
          config: { durationMs: 100 },
          next: ["normalize-records"],
        },
        "normalize-records": {
          id: "normalize-records",
          type: "loop",
          config: {
            collection: "context.records",
            itemVariable: "record",
            body: "normalize-record",
          },
          next: ["pipeline-summary"],
        },
        "normalize-record": {
          id: "normalize-record",
          type: "transform",
          config: {
            output: {
              normalized: "record.name",
              amount: "round(record.amount, 2)",
            },
          },
        },
        "pipeline-summary": {
          id: "pipeline-summary",
          type: "transform",
          config: {
            output: {
              count: "context.records.length",
              status: "'ready-for-export'",
            },
          },
        },
      },
    },
    input: {
      records: [
        { name: " Alice ", amount: 12.5 },
        { name: " Bob ", amount: 8.1 },
      ],
    },
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generatePlaygroundHtml(port: number): string {
  const demoOptions = DEMO_WORKFLOWS.map(
    (d) =>
      `<option value="${escapeHtml(d.id)}">${escapeHtml(d.label)}</option>`,
  ).join("\n");

  const demoData = JSON.stringify(DEMO_WORKFLOWS);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Playground - ts-workflow-engine-lite</title>
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
    padding: 24px 24px 20px;
    border-bottom: 1px solid #1e293b;
    background: #111827;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  header h1 { margin: 0; font-size: 20px; }
  header .nav a { color: #60a5fa; text-decoration: none; font-size: 13px; margin-left: 16px; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .layout { display: grid; grid-template-columns: 320px 1fr; gap: 20px; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  .panel {
    background: #111827;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 18px;
  }
  .panel h2 { margin: 0 0 12px; font-size: 15px; color: #f1f5f9; }
  select, textarea, button, input {
    width: 100%;
    background: #1e293b;
    border: 1px solid #334155;
    color: #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  select { margin-bottom: 12px; }
  textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px;
    resize: vertical;
  }
  label { display: block; font-size: 12px; color: #94a3b8; margin: 12px 0 6px; }
  .desc { font-size: 12.5px; color: #94a3b8; margin: -4px 0 12px; }
  .btn-row { display: flex; gap: 8px; margin-top: 14px; }
  button {
    cursor: pointer;
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
    font-weight: 600;
    transition: background 0.15s;
  }
  button:hover:not(:disabled) { background: #1d4ed8; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: #1e293b; border-color: #334155; color: #e2e8f0; }
  button.secondary:hover:not(:disabled) { background: #334155; }
  .status-line {
    margin-top: 14px;
    font-size: 12.5px;
    padding: 8px 10px;
    border-radius: 6px;
    background: #1e293b;
    color: #94a3b8;
    min-height: 18px;
    word-break: break-all;
  }
  .status-line.ok { color: #4ade80; }
  .status-line.err { color: #f87171; }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge-completed { background: #16a34a33; color: #4ade80; }
  .badge-running { background: #2563eb33; color: #60a5fa; }
  .badge-failed { background: #dc262633; color: #f87171; }
  .badge-waiting, .badge-paused { background: #ca8a0433; color: #facc15; }
  .badge-default { background: #33415533; color: #94a3b8; }
  pre {
    background: #0b1220;
    border: 1px solid #1e293b;
    border-radius: 8px;
    padding: 14px;
    overflow-x: auto;
    font-size: 12.5px;
    max-height: 420px;
    margin: 0;
  }
  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .result-header h2 { margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1e293b; vertical-align: top; }
  th { color: #94a3b8; font-weight: 600; width: 30%; }
  code { background: #1e293b; padding: 1px 5px; border-radius: 4px; color: #7dd3fc; font-size: 12px; }
  .hint { font-size: 12px; color: #64748b; margin-top: 10px; }
  .empty { color: #64748b; font-size: 13px; padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>Playground</h1>
  <div class="nav">
    <a href="/">首页</a>
    <a href="/docs/concepts">核心概念</a>
    <a href="/api-docs">API 文档</a>
  </div>
</header>
<main>
  <p class="hint" style="margin-top:0">
    直接调用本机运行中的 REST API（<code>http://localhost:${port}/workflow-api/v1</code>）注册并启动示例工作流，
    体现节点输出引用、表达式转换、条件路由、多分支路由等能力的真实执行结果。
  </p>
  <div class="layout">
    <div class="panel">
      <h2>1. 选择示例工作流</h2>
      <select id="demo-select">
${demoOptions}
      </select>
      <p class="desc" id="demo-desc"></p>

      <label for="def-editor">工作流定义 JSON（可编辑）</label>
      <textarea id="def-editor" rows="16"></textarea>

      <label for="input-editor">启动输入（context）</label>
      <textarea id="input-editor" rows="4"></textarea>

      <div class="btn-row">
        <button id="run-btn">注册并运行</button>
        <button id="reset-btn" class="secondary">重置</button>
      </div>
      <div class="status-line" id="status-line">等待运行&hellip;</div>
    </div>

    <div class="panel">
      <div class="result-header">
        <h2>2. 执行结果</h2>
        <span id="status-badge"></span>
      </div>
      <div id="result-empty" class="empty">运行后这里会显示实例状态、节点输出与执行日志</div>
      <div id="result-body" style="display:none">
        <table>
          <tbody>
            <tr><th>实例 ID</th><td id="r-instance-id"></td></tr>
            <tr><th>工作流</th><td id="r-workflow-id"></td></tr>
            <tr><th>当前节点</th><td id="r-current-node"></td></tr>
          </tbody>
        </table>
        <label style="margin-top:16px">节点输出（context）</label>
        <pre id="r-context">-</pre>
        <label>完整实例快照</label>
        <pre id="r-raw">-</pre>
      </div>
    </div>
  </div>
</main>
<script>
(function () {
  var DEMOS = ${demoData};
  var API_BASE = "/workflow-api/v1";

  var select = document.getElementById("demo-select");
  var descEl = document.getElementById("demo-desc");
  var defEditor = document.getElementById("def-editor");
  var inputEditor = document.getElementById("input-editor");
  var runBtn = document.getElementById("run-btn");
  var resetBtn = document.getElementById("reset-btn");
  var statusLine = document.getElementById("status-line");
  var statusBadge = document.getElementById("status-badge");
  var resultEmpty = document.getElementById("result-empty");
  var resultBody = document.getElementById("result-body");

  function findDemo(id) {
    for (var i = 0; i < DEMOS.length; i++) {
      if (DEMOS[i].id === id) return DEMOS[i];
    }
    return DEMOS[0];
  }

  function loadDemo(id) {
    var demo = findDemo(id);
    descEl.textContent = demo.desc;
    defEditor.value = JSON.stringify(demo.definition, null, 2);
    inputEditor.value = JSON.stringify(demo.input, null, 2);
    setStatus("等待运行&hellip;", "");
    resultEmpty.style.display = "block";
    resultBody.style.display = "none";
    statusBadge.innerHTML = "";
  }

  function setStatus(html, cls) {
    statusLine.innerHTML = html;
    statusLine.className = "status-line" + (cls ? " " + cls : "");
  }

  function badgeFor(status) {
    var known = ["completed", "running", "failed", "waiting", "paused"];
    var cls = known.indexOf(status) >= 0 ? "badge-" + status : "badge-default";
    return '<span class="badge ' + cls + '">' + (status || "unknown") + "</span>";
  }

  async function apiFetch(path, options) {
    var requestOptions = options || {};
    var isGet = !requestOptions.method || requestOptions.method === "GET";
    var requestPath = path;
    if (isGet) {
      requestPath += (requestPath.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
      requestOptions = Object.assign({}, requestOptions, { cache: "no-store" });
    }
    var res = await fetch(API_BASE + requestPath, requestOptions);
    var json = null;
    try {
      json = await res.json();
    } catch (e) {
      throw new Error("响应解析失败 (HTTP " + res.status + ")");
    }
    if (!res.ok || json.success === false) {
      throw new Error((json && json.message) || "请求失败 (HTTP " + res.status + ")");
    }
    return json.data;
  }

  function renderInstance(instance) {
    resultEmpty.style.display = "none";
    resultBody.style.display = "block";
    statusBadge.innerHTML = badgeFor(instance.status);
    document.getElementById("r-instance-id").textContent = instance.instanceId || "-";
    document.getElementById("r-workflow-id").textContent = instance.workflowId || "-";
    document.getElementById("r-current-node").textContent = instance.currentNode || "-";
    document.getElementById("r-context").textContent = JSON.stringify(instance.context || {}, null, 2);
    document.getElementById("r-raw").textContent = JSON.stringify(instance, null, 2);
  }

  async function pollInstance(instanceId, attemptsLeft) {
    var instance;
    try {
      instance = await apiFetch("/instances/" + encodeURIComponent(instanceId));
    } catch (err) {
      setStatus("轮询实例状态失败: " + escapeText(err.message), "err");
      return;
    }
    renderInstance(instance);
    var terminal = ["completed", "failed", "cancelled"];
    if (terminal.indexOf(instance.status) >= 0 || attemptsLeft <= 0) {
      setStatus(
        instance.status === "completed"
          ? "执行完成"
          : "执行结束，状态: " + instance.status,
        instance.status === "completed" ? "ok" : instance.status === "failed" ? "err" : "",
      );
      return;
    }
    setStatus("运行中&hellip;（" + instance.status + "）", "");
    setTimeout(function () {
      pollInstance(instanceId, attemptsLeft - 1);
    }, 500);
  }

  function escapeText(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  async function run() {
    var definition, input;
    try {
      definition = JSON.parse(defEditor.value);
    } catch (e) {
      setStatus("工作流定义 JSON 解析失败: " + escapeText(e.message), "err");
      return;
    }
    try {
      input = inputEditor.value.trim() ? JSON.parse(inputEditor.value) : {};
    } catch (e) {
      setStatus("输入 JSON 解析失败: " + escapeText(e.message), "err");
      return;
    }

    // Playground 定义在本地会被持久化。为避免同 ID 的旧示例遮蔽编辑器中
    // 刚修改的内容，每次运行都创建一个独立的临时工作流 ID。
    var runDefinition = Object.assign({}, definition, {
      id: definition.id + "-" + Date.now(),
    });

    runBtn.disabled = true;
    resultEmpty.style.display = "block";
    resultBody.style.display = "none";
    statusBadge.innerHTML = "";

    try {
      setStatus("正在注册工作流&hellip;", "");
      await apiFetch("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: runDefinition.id,
          name: runDefinition.name || runDefinition.id,
          definition: runDefinition,
        }),
      });

      setStatus("正在启动实例&hellip;", "");
      var startResult = await apiFetch(
        "/workflows/" + encodeURIComponent(runDefinition.id) + "/start",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: input }),
        },
      );

      setStatus("实例已启动: " + startResult.instanceId, "ok");
      await pollInstance(startResult.instanceId, 20);
    } catch (err) {
      setStatus("运行失败: " + escapeText(err.message), "err");
    } finally {
      runBtn.disabled = false;
    }
  }

  select.addEventListener("change", function () {
    loadDemo(select.value);
  });
  runBtn.addEventListener("click", run);
  resetBtn.addEventListener("click", function () {
    loadDemo(select.value);
  });

  loadDemo(select.value);
})();
</script>
</body>
</html>`;
}
