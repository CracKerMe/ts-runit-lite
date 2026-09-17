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
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Playground - ts-workflow-engine-lite</title>
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
  body {
    margin: 0;
    font-family: var(--font-sans);
    font-feature-settings: "cv01", "ss03";
    background: var(--bg);
    color: var(--text-secondary);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::selection { background: var(--selection-bg); color: var(--text-primary); }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }

  header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding: 16px 28px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--header-bg);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  header h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 590;
    letter-spacing: -0.24px;
    color: var(--text-primary);
  }
  header .nav a {
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 13px;
    font-weight: 510;
    letter-spacing: -0.13px;
    margin-left: 20px;
    transition: color 0.1s;
  }
  header .nav a:hover { color: var(--text-primary); }
  header .nav { margin-left: auto; }

  main { max-width: 1280px; margin: 0 auto; padding: 36px 28px 88px; }
  .layout { display: grid; grid-template-columns: 380px 1fr; gap: 20px; align-items: start; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

  .panel {
    background: var(--overlay-1);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    border-radius: 14px;
    padding: 28px;
  }
  .panel h2 {
    display: flex;
    align-items: center;
    gap: 11px;
    margin: 0 0 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 16px;
    font-weight: 590;
    letter-spacing: -0.18px;
    color: var(--text-primary);
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
    color: var(--chip-text);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 510;
  }

  select, textarea, button, input {
    width: 100%;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    color: var(--text-secondary);
    border-radius: 6px;
    padding: 8px 11px;
    font-size: 13px;
    letter-spacing: -0.02px;
    font-family: inherit;
    transition: border-color 0.15s, background 0.15s;
  }
  select:hover, textarea:hover { border-color: var(--border-hover); }
  select:focus, textarea:focus, input:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
  select { margin-bottom: 12px; cursor: pointer; }
  select option { background: var(--bg-panel); color: var(--text-secondary); }
  textarea {
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.55;
    resize: vertical;
  }

  label { display: block; font-size: 12px; font-weight: 510; letter-spacing: -0.02px; color: var(--text-muted); margin: 14px 0 6px; }
  .desc { font-size: 12.5px; letter-spacing: -0.11px; color: var(--text-muted); margin: -4px 0 12px; line-height: 1.55; }
  .btn-row { display: flex; gap: 8px; margin-top: 16px; }

  button {
    cursor: pointer;
    padding: 10px 16px;
    background: var(--brand);
    border: 1px solid var(--brand);
    color: #fff;
    font-size: 13px;
    font-weight: 510;
    letter-spacing: -0.13px;
    transition: background 0.15s, border-color 0.15s;
  }
  button:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary {
    background: var(--overlay-1);
    border-color: var(--border-strong);
    color: var(--btn-text);
  }
  button.secondary:hover:not(:disabled) { background: var(--overlay-2); border-color: var(--border-hover); }

  .status-line {
    margin-top: 16px;
    font-size: 12.5px;
    letter-spacing: -0.11px;
    padding: 9px 12px;
    border-radius: 6px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
    min-height: 18px;
    word-break: break-all;
  }
  .status-line.ok { color: var(--green); }
  .status-line.err { color: var(--red); }

  .badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11px;
    font-weight: 510;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    border: 1px solid transparent;
  }
  .badge-completed { background: var(--green-bg); color: var(--green-text); border-color: var(--green-border); }
  .badge-running { background: var(--chip-bg); color: var(--running-text); border-color: var(--chip-border); }
  .badge-failed { background: var(--red-bg); color: var(--red); border-color: var(--red-border); }
  .badge-waiting, .badge-paused { background: var(--amber-bg); color: var(--amber); border-color: var(--amber-border); }
  .badge-default { background: var(--overlay-2); color: var(--text-muted); border-color: var(--border-subtle); }

  pre {
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
    font-size: 12.5px;
    line-height: 1.55;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    max-height: 420px;
    margin: 0;
  }

  .result-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    flex-wrap: wrap;
    gap: 8px;
  }
  .result-header h2 { margin: 0; }

  table { width: 100%; border-collapse: collapse; font-size: 12.5px; letter-spacing: -0.11px; margin-top: 4px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-subtle); vertical-align: top; }
  th { color: var(--text-muted); font-weight: 510; font-size: 12px; width: 30%; }
  td { color: var(--text-secondary); }
  tbody tr:hover { background: var(--overlay-1); }

  code { background: var(--overlay-3); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); color: var(--code-text); font-size: 12px; }
  .hint { font-size: 13.5px; letter-spacing: -0.11px; line-height: 1.6; color: var(--text-muted); margin: 0 0 28px; }
  .hint code { background: var(--overlay-3); }
  .empty { color: var(--text-subtle); font-size: 13px; padding: 48px 0; text-align: center; }

  /* ── JSON 实时校验提示 ────────────────────────── */
  .field-hint {
    min-height: 15px;
    margin: 5px 2px 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    color: var(--text-subtle);
  }
  .field-hint.err { color: var(--red); }
  .field-hint.ok { color: var(--green-text); }

  /* ── curl 预览 ───────────────────────────────── */
  .curl-box { margin-top: 20px; }
  .curl-box .curl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .curl-box .curl-head b {
    font-size: 12px;
    font-weight: 510;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }
  .curl-box pre {
    max-height: 168px;
    font-size: 11px;
    line-height: 1.55;
  }
  .mini-copy {
    flex: none;
    padding: 3px 9px;
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 510;
    color: var(--text-muted);
    background: var(--overlay-2);
    border: 1px solid var(--border-standard);
    border-radius: 5px;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .mini-copy:hover { color: var(--text-primary); border-color: var(--hairline); }
  .mini-copy.copied { color: var(--green-text); border-color: var(--green-border); }

  /* ── 运行历史 ────────────────────────────────── */
  .history { margin-top: 72px; }
  .history h2 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 590;
    letter-spacing: -0.24px;
    color: var(--text-primary);
  }
  .history .history-sub { margin: 0 0 16px; font-size: 13px; color: var(--text-muted); }
  .history-list { display: flex; flex-direction: column; gap: 8px; }
  .history-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    background: var(--overlay-1);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .history-item:hover { background: var(--overlay-2); border-color: var(--hairline); }
  .history-item .h-badge { flex: none; }
  .history-item .h-name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 510;
    letter-spacing: -0.1px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .history-item .h-meta {
    flex: none;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-subtle);
  }
  .history-empty { color: var(--text-subtle); font-size: 13px; padding: 22px 0; text-align: center; }

  /* ── 主题切换（位于顶栏内）────────────────────── */
  button.theme-toggle {
    flex: none;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
  <button type="button" id="themeToggle" class="theme-toggle" aria-label="切换亮暗主题" title="切换亮暗主题">
    <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>
</header>
<main>
  <p class="hint" style="margin-top:0">
    直接调用本机运行中的 REST API（<code>http://localhost:${port}/workflow-api/v1</code>）注册并启动示例工作流，
    体现节点输出引用、表达式转换、条件路由、多分支路由等能力的真实执行结果。
  </p>
  <div class="layout">
    <div class="panel">
      <h2><span class="step">1</span>选择示例工作流</h2>
      <select id="demo-select">
${demoOptions}
      </select>
      <p class="desc" id="demo-desc"></p>

      <label for="def-editor">工作流定义 JSON（可编辑）</label>
      <textarea id="def-editor" rows="16"></textarea>
      <p class="field-hint" id="def-hint"></p>

      <label for="input-editor">启动输入（context）</label>
      <textarea id="input-editor" rows="4"></textarea>
      <p class="field-hint" id="input-hint"></p>

      <div class="btn-row">
        <button id="run-btn">注册并运行</button>
        <button id="reset-btn" class="secondary">重置</button>
      </div>
      <div class="status-line" id="status-line">等待运行&hellip;</div>

      <div class="curl-box">
        <div class="curl-head">
          <b>等价的 cURL 命令</b>
          <button type="button" class="mini-copy" id="curl-copy">复制</button>
        </div>
        <pre id="curl-preview"></pre>
      </div>
    </div>

    <div class="panel">
      <div class="result-header">
        <h2><span class="step">2</span>执行结果</h2>
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

  <div class="history">
    <h2>运行历史</h2>
    <p class="history-sub">保存在本机浏览器（localStorage），点击任一条目可回填对应的定义与输入。</p>
    <div class="history-list" id="history-list"></div>
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

    var runStartedAt = Date.now();
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
      pushHistory({
        status: (statusBadge.textContent || "unknown").trim(),
        ms: Date.now() - runStartedAt,
        workflowId: definition.id,
        instanceId: startResult.instanceId,
        definition: defEditor.value,
        input: inputEditor.value,
      });
    } catch (err) {
      setStatus("运行失败: " + escapeText(err.message), "err");
      pushHistory({
        status: "failed",
        ms: Date.now() - runStartedAt,
        workflowId: (typeof definition !== "undefined" && definition && definition.id) || "-",
        instanceId: "-",
        definition: defEditor.value,
        input: inputEditor.value,
      });
    } finally {
      runBtn.disabled = false;
    }
  }

  /* ── 新模块：JSON 校验 / curl 预览 / 运行历史 ─────────── */
  var defHint = document.getElementById("def-hint");
  var inputHint = document.getElementById("input-hint");
  var curlPreview = document.getElementById("curl-preview");
  var curlCopyBtn = document.getElementById("curl-copy");
  var historyList = document.getElementById("history-list");
  var HISTORY_KEY = "tswe-run-history";
  var HISTORY_MAX = 8;

  function shellSingleQuote(s) {
    var SQ = String.fromCharCode(39);
    var ESC = SQ + String.fromCharCode(92) + SQ + SQ;
    return SQ + String(s).split(SQ).join(ESC) + SQ;
  }

  function validateEditors() {
    var ok1 = true, ok2 = true;
    try { JSON.parse(defEditor.value); } catch (e) { ok1 = false; defHint.textContent = "✗ 定义 JSON: " + e.message; defHint.className = "field-hint err"; }
    if (ok1) { defHint.textContent = "✓ 定义 JSON 合法"; defHint.className = "field-hint ok"; }
    var raw2 = inputEditor.value.trim();
    try { JSON.parse(raw2 || "{}"); } catch (e) { ok2 = false; inputHint.textContent = "✗ 输入 JSON: " + e.message; inputHint.className = "field-hint err"; }
    if (ok2) { inputHint.textContent = "✓ 输入 JSON 合法"; inputHint.className = "field-hint ok"; }
    return ok1 && ok2;
  }

  function updateCurl() {
    var origin = location.origin;
    var def, input;
    try { def = JSON.parse(defEditor.value); } catch (e) {
      curlPreview.textContent = "# 修正定义 JSON 后自动生成 cURL";
      return;
    }
    try { input = JSON.parse(inputEditor.value.trim() || "{}"); } catch (e) {
      curlPreview.textContent = "# 修正输入 JSON 后自动生成 cURL";
      return;
    }
    var NL = String.fromCharCode(10);
    var cont = " " + String.fromCharCode(92) + NL + "  ";
    var DQ = String.fromCharCode(34);
    var api = origin + "/workflow-api/v1";
    var regBody = { id: def.id, name: def.name || def.id, definition: def };
    var startBody = { context: input };
    curlPreview.textContent =
      "# 注册工作流定义" + NL +
      "curl -X POST " + api + "/workflows" + cont +
      "-H " + DQ + "Content-Type: application/json" + DQ + cont +
      "-d " + shellSingleQuote(JSON.stringify(regBody)) + NL + NL +
      "# 启动实例" + NL +
      "curl -X POST " + api + "/workflows/" + encodeURIComponent(String(def.id)) + "/start" + cont +
      "-H " + DQ + "Content-Type: application/json" + DQ + cont +
      "-d " + shellSingleQuote(JSON.stringify(startBody)) + NL;
  }

  function readHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (e) { return []; }
  }

  function pushHistory(entry) {
    try {
      var list = readHistory();
      entry.at = Date.now();
      if ((entry.definition || "").length > 40000) entry.definition = entry.definition.slice(0, 40000);
      list.unshift(entry);
      list = list.slice(0, HISTORY_MAX);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) { /* 存储不可用时静默跳过 */ }
    renderHistory();
  }

  function renderHistory() {
    var list = readHistory();
    if (!historyList) return;
    if (!list.length) {
      historyList.innerHTML = '<div class="history-empty">暂无运行记录，点击「注册并运行」开始第一次执行。</div>';
      return;
    }
    historyList.innerHTML = "";
    list.forEach(function (h) {
      var item = document.createElement("div");
      item.className = "history-item";
      var d = new Date(h.at);
      var hh = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + ":" + ("0" + d.getSeconds()).slice(-2);
      item.innerHTML =
        '<span class="h-badge">' + badgeFor(h.status) + '</span>' +
        '<span class="h-name">' + escapeText(String(h.workflowId || "-")) + '</span>' +
        '<span class="h-meta">' + hh + " &middot; " + (h.ms != null ? h.ms + "ms" : "-") + '</span>';
      item.addEventListener("click", function () {
        if (typeof h.definition === "string") defEditor.value = h.definition;
        if (typeof h.input === "string") inputEditor.value = h.input;
        validateEditors();
        updateCurl();
        setStatus("已回填历史记录: " + escapeText(String(h.workflowId || "-")), "");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      historyList.appendChild(item);
    });
  }

  /* 拦截 loadDemo：示例切换后同步校验与 curl 预览 */
  var _origLoadDemo = loadDemo;
  loadDemo = function (id) {
    _origLoadDemo(id);
    validateEditors();
    updateCurl();
  };

  var curlTimer = null;
  function onEditorInput() {
    validateEditors();
    if (curlTimer) clearTimeout(curlTimer);
    curlTimer = setTimeout(updateCurl, 160);
  }
  defEditor.addEventListener("input", onEditorInput);
  inputEditor.addEventListener("input", onEditorInput);

  if (curlCopyBtn) {
    curlCopyBtn.addEventListener("click", function () {
      var text = curlPreview.textContent || "";
      function done() {
        curlCopyBtn.classList.add("copied");
        curlCopyBtn.textContent = "已复制 ✓";
        setTimeout(function () { curlCopyBtn.classList.remove("copied"); curlCopyBtn.textContent = "复制"; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {});
      }
    });
  }

  renderHistory();

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
<script>
(function(){var b=document.getElementById("themeToggle");if(!b)return;b.addEventListener("click",function(){var d=document.documentElement,t=d.getAttribute("data-theme")==="light"?"dark":"light";d.setAttribute("data-theme",t);try{localStorage.setItem("tswe-theme",t)}catch(e){}})})();
</script>
</body>
</html>`;
}
