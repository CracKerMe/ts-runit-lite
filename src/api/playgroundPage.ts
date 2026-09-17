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
              normalized: "trim(record.name)",
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
  {
    id: "playground-cart-checkout",
    label: "购物车结算：聚合函数",
    desc: "用 map / reduce / filter 在单个 transform 节点内算出小计、折扣与应付金额",
    definition: {
      id: "playground-cart-checkout",
      name: "购物车结算示例",
      version: "1.0.0",
      startNode: "sumCart",
      nodes: {
        sumCart: {
          id: "sumCart",
          type: "transform",
          config: {
            output: {
              itemCount: "length(context.items)",
              subtotal:
                "round(reduce(map(context.items, i => i.price * i.qty), (a, b) => a + b, 0), 2)",
              discountedItems: "length(filter(context.items, i => i.onSale))",
            },
          },
          next: ["applyThreshold"],
        },
        applyThreshold: {
          id: "applyThreshold",
          type: "condition",
          config: {
            // condition 节点的上下文里，节点名直接映射到 output 本身（无 .output 层）
            condition: "sumCart.subtotal >= context.freeShippingAt",
            trueBranch: "freeShipping",
            falseBranch: "paidShipping",
          },
        },
        freeShipping: {
          id: "freeShipping",
          type: "transform",
          config: {
            output: {
              shippingFee: "0",
              payable: "sumCart.output.subtotal",
              note: "'已满足包邮门槛'",
            },
          },
        },
        paidShipping: {
          id: "paidShipping",
          type: "transform",
          config: {
            output: {
              shippingFee: "12",
              payable: "round(sumCart.output.subtotal + 12, 2)",
              note: "'未满包邮门槛，加收运费'",
            },
          },
        },
      },
    },
    input: {
      freeShippingAt: 99,
      items: [
        { price: 39.9, qty: 2, onSale: true },
        { price: 18.5, qty: 1, onSale: false },
      ],
    },
  },
  {
    id: "playground-ticket-triage",
    label: "工单分级派单",
    desc: "router 按优先级与渠道分派工单，transform 计算 SLA 应答时限",
    definition: {
      id: "playground-ticket-triage",
      name: "工单分级派单示例",
      version: "1.0.0",
      startNode: "triage",
      nodes: {
        triage: {
          id: "triage",
          type: "router",
          config: {
            routes: [
              {
                condition:
                  "context.severity == 'p1' || context.affectedUsers > 500",
                target: "page-oncall",
                priority: 1,
              },
              {
                condition: "context.severity == 'p2'",
                target: "engineer-queue",
                priority: 2,
              },
            ],
            defaultTarget: "support-queue",
          },
        },
        "page-oncall": {
          id: "page-oncall",
          type: "transform",
          config: {
            output: {
              assignee: "'oncall-sre'",
              slaMinutes: "15",
              channel: "'phone'",
            },
          },
        },
        "engineer-queue": {
          id: "engineer-queue",
          type: "transform",
          config: {
            output: {
              assignee: "'platform-team'",
              slaMinutes: "120",
              channel: "'slack'",
            },
          },
        },
        "support-queue": {
          id: "support-queue",
          type: "transform",
          config: {
            output: {
              assignee: "'support-l1'",
              slaMinutes: "480",
              channel: "'email'",
            },
          },
        },
      },
    },
    input: { severity: "p2", affectedUsers: 24, source: "web" },
  },
  {
    id: "playground-etl-enrich",
    label: "ETL：清洗 + 汇总",
    desc: "loop 逐行规范化脏数据，再用聚合函数统计有效行与总额",
    definition: {
      id: "playground-etl-enrich",
      name: "ETL 清洗与汇总示例",
      version: "1.0.0",
      startNode: "clean-rows",
      nodes: {
        "clean-rows": {
          id: "clean-rows",
          type: "loop",
          config: {
            collection: "context.rows",
            itemVariable: "row",
            indexVariable: "rowIndex",
            body: "clean-row",
          },
          next: ["aggregate"],
        },
        "clean-row": {
          id: "clean-row",
          type: "transform",
          config: {
            output: {
              sku: "toUpperCase(trim(row.sku))",
              amount: "round(row.amount, 2)",
              valid: "row.amount > 0",
              position: "rowIndex",
            },
          },
        },
        aggregate: {
          id: "aggregate",
          type: "transform",
          config: {
            output: {
              total:
                "round(reduce(map(filter(context.rows, r => r.amount > 0), r => r.amount), (a, b) => a + b, 0), 2)",
              validRows: "length(filter(context.rows, r => r.amount > 0))",
              droppedRows: "length(filter(context.rows, r => r.amount <= 0))",
              maxAmount:
                "round(reduce(map(context.rows, r => r.amount), (a, b) => max(a, b), 0), 2)",
            },
          },
        },
      },
    },
    input: {
      rows: [
        { sku: " a-100 ", amount: 42.556 },
        { sku: " b-200 ", amount: 0 },
        { sku: " c-300 ", amount: 17.4 },
      ],
    },
  },
  {
    id: "playground-retry-fallback",
    label: "容缺汇聚（join any）",
    desc: "join 的 any 模式：只要至少一条分支产出结果就放行，缺失的分支记入 missing",
    definition: {
      id: "playground-retry-fallback",
      name: "容缺汇聚示例",
      version: "1.0.0",
      startNode: "fan-out",
      nodes: {
        "fan-out": {
          id: "fan-out",
          type: "transform",
          config: { output: { dispatchedAt: "now()" } },
          next: ["primary-path", "backup-path"],
        },
        "primary-path": {
          id: "primary-path",
          type: "wait",
          config: { durationMs: 250, durable: false },
          next: ["first-done"],
        },
        "backup-path": {
          id: "backup-path",
          type: "wait",
          config: { durationMs: 50, durable: false },
          next: ["first-done"],
        },
        "first-done": {
          id: "first-done",
          type: "join",
          config: { waitFor: ["primary-path", "backup-path"], mode: "any" },
          next: ["summarize"],
        },
        summarize: {
          id: "summarize",
          type: "transform",
          config: {
            output: {
              strategy: "'tolerate-missing-branch'",
              note: "'any 模式允许部分分支缺失；all 模式下缺失会直接报错'",
            },
          },
        },
      },
    },
    input: { requestId: "req-8821" },
  },
  {
    id: "playground-scoring-tiers",
    label: "信用评分分层",
    desc: "condition 嵌套分流出三档信用等级，并给出对应授信额度",
    definition: {
      id: "playground-scoring-tiers",
      name: "信用评分分层示例",
      version: "1.0.0",
      startNode: "score",
      nodes: {
        score: {
          id: "score",
          type: "transform",
          config: {
            output: {
              value:
                "round(context.payHistory * 0.6 + context.utilization * 0.4, 1)",
            },
          },
          next: ["is-prime"],
        },
        "is-prime": {
          id: "is-prime",
          type: "condition",
          config: {
            // condition 节点的上下文里，节点名直接映射到 output 本身（无 .output 层）
            condition: "score.value >= 80",
            trueBranch: "tier-prime",
            falseBranch: "is-standard",
          },
        },
        "is-standard": {
          id: "is-standard",
          type: "condition",
          config: {
            condition: "score.value >= 60",
            trueBranch: "tier-standard",
            falseBranch: "tier-subprime",
          },
        },
        "tier-prime": {
          id: "tier-prime",
          type: "transform",
          config: {
            output: { tier: "'prime'", creditLimit: "50000", apr: "0.06" },
          },
        },
        "tier-standard": {
          id: "tier-standard",
          type: "transform",
          config: {
            output: { tier: "'standard'", creditLimit: "15000", apr: "0.12" },
          },
        },
        "tier-subprime": {
          id: "tier-subprime",
          type: "transform",
          config: {
            output: { tier: "'subprime'", creditLimit: "2000", apr: "0.22" },
          },
        },
      },
    },
    input: { payHistory: 88, utilization: 71 },
  },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function generatePlaygroundHtml(port: number): string {
  const demoCards = DEMO_WORKFLOWS.map(
    (d, i) =>
      `<button type="button" class="demo-card" data-demo-id="${escapeHtml(d.id)}" role="option" aria-selected="${i === 0 ? "true" : "false"}">
        <span class="demo-card-index">${String(i + 1).padStart(2, "0")}</span>
        <span class="demo-card-label">${escapeHtml(d.label)}</span>
        <span class="demo-card-desc">${escapeHtml(d.desc)}</span>
      </button>`,
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

  /* 顶栏与 /docs/concepts 的 .topbar 共用同一套版式与尺寸。 */
  .topbar {
    position: sticky; top: 0; z-index: 30;
    display: flex; align-items: center; gap: 16px;
    padding: 0 24px; height: 56px;
    background: var(--header-bg);
    backdrop-filter: saturate(180%) blur(12px);
    -webkit-backdrop-filter: saturate(180%) blur(12px);
    border-bottom: 1px solid var(--border-subtle);
  }
  a { color: inherit; text-decoration: none; }
  .brand { font-size: 14px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.2px; white-space: nowrap; flex-shrink: 0; }
  .topbar-links { display: flex; gap: 4px; margin-left: 8px; overflow-x: auto; scrollbar-width: none; }
  .topbar-links::-webkit-scrollbar { display: none; }
  .topbar-links a {
    white-space: nowrap; flex-shrink: 0;
    font-size: 13px; font-weight: 500; color: var(--text-muted);
    text-decoration: none;
    padding: 5px 10px; border-radius: 6px; transition: 0.12s;
  }
  .topbar-links a:hover { background: var(--overlay-2); color: var(--text-primary); }
  .topbar-links a.active { color: var(--text-primary); background: var(--overlay-2); }
  .topbar-spacer { flex: 1; }
  @media (max-width: 900px) {
    /* 与文档站一致：窄屏优先保证导航可用，品牌名让位给入口链接。 */
    .topbar { padding: 0 12px; gap: 8px; }
    .brand { display: none; }
  }

  main { max-width: 1560px; margin: 0 auto; padding: 0 32px 72px; position: relative; }

  /* ── 页面 Hero：与首页 header 的 overline + 大标题语言保持一致 ── */
  .page-hero {
    position: relative;
    margin: 0 -32px 20px;
    padding: 26px 32px 6px;
    overflow: hidden;
  }
  .page-hero::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
      radial-gradient(640px 280px at 12% -20%, var(--glow), transparent 65%),
      radial-gradient(480px 220px at 92% -10%, var(--wf-glow), transparent 60%);
    pointer-events: none;
  }
  /* 标题与说明并排，回收单列 hero 占掉的一整屏高度。 */
  .page-hero-inner {
    position: relative;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;
  }
  .page-hero-text { min-width: 0; max-width: 720px; }
  .page-eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px 5px 10px;
    border-radius: 9999px;
    background: var(--overlay-1);
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    font-size: 11.5px;
    font-weight: 510;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  .page-eyebrow::before {
    content: "";
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--green);
    box-shadow: 0 0 8px var(--green-glow);
  }
  .page-hero h1 {
    margin: 0 0 8px;
    font-size: 30px;
    font-weight: 560;
    line-height: 1.1;
    letter-spacing: -0.8px;
    color: var(--text-primary);
  }
  .page-hero .hint { max-width: 640px; font-size: 13.5px; line-height: 1.6; }

  /* ── 示例选择：横向卡片条 ─────────────────────── */
  .demo-strip-wrap {
    position: relative;
    margin-bottom: 18px;
    border: 1px solid var(--border-standard);
    border-radius: 14px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-line) 0 0 0 1px;
    overflow: hidden;
  }
  .demo-strip-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px 0;
  }
  .demo-strip-head b {
    font-size: 12px;
    font-weight: 510;
    letter-spacing: 0.02em;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .demo-strip-head span {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-subtle);
  }
  /* 12 个示例做成横向滑轨：一眼只占两行高度，而不是铺满整屏的网格。 */
  .demo-strip {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 216px;
    grid-template-rows: auto;
    gap: 8px;
    padding: 10px 16px 14px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: thin;
    scrollbar-color: var(--border-hover) transparent;
  }
  .demo-strip::-webkit-scrollbar { height: 8px; }
  .demo-strip::-webkit-scrollbar-track { background: transparent; }
  .demo-strip::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: 999px;
    border: 2px solid transparent;
    background-clip: content-box;
  }
  .demo-strip:hover::-webkit-scrollbar-thumb { background: var(--border-hover); background-clip: content-box; }
  /* 右缘渐隐，提示还有更多示例可以滑动。 */
  .demo-strip-wrap::after {
    content: "";
    position: absolute;
    right: 0; bottom: 0;
    width: 44px; height: calc(100% - 34px);
    pointer-events: none;
    background: linear-gradient(to right, transparent, var(--bg-panel));
  }
  button.demo-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: 100%;
    scroll-snap-align: start;
    text-align: left;
    padding: 10px 13px 11px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    cursor: pointer;
    font-family: inherit;
    color: var(--text-secondary);
    box-shadow: none;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  }
  button.demo-card:hover:not(:disabled) {
    background: var(--overlay-2);
    border-color: var(--border-hover);
    box-shadow: none;
  }
  button.demo-card[aria-selected="true"] {
    background: var(--chip-bg);
    border-color: var(--chip-border);
    box-shadow: 0 0 0 1px var(--chip-border), inset 0 1px 0 rgba(255,255,255,0.04);
  }
  .demo-card-index {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 510;
    letter-spacing: 0.04em;
    color: var(--text-subtle);
  }
  .demo-card[aria-selected="true"] .demo-card-index { color: var(--chip-text); }
  .demo-card-label {
    font-size: 13px;
    font-weight: 560;
    letter-spacing: -0.1px;
    color: var(--text-primary);
    line-height: 1.35;
  }
  .demo-card-desc {
    font-size: 11.5px;
    line-height: 1.45;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  @media (max-width: 720px) {
    .demo-strip { grid-auto-columns: 78%; padding-left: 12px; padding-right: 12px; }
    .demo-strip-wrap::after { display: none; }
  }

  /* 工作台：编辑器 / 结果 / Flow 三块同屏，避免整页拉成 2000px+ 的长卷。
     minmax(0,·) 必不可少：默认 min-width:auto 会让 <pre> 的长内容把列撑破，
     进而让整页出现横向滚动条。 */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr);
    grid-template-areas: "editor result" "flow flow";
    gap: 18px;
    align-items: start;
  }
  .panel-editor { grid-area: editor; }
  .panel-result { grid-area: result; }
  .flow-panel { grid-area: flow; }

  /* 1280px 起 Flow 升到第三列，三块并排，首屏即可看全。
     这一档每栏仅 ~380px，编辑器要放 JSON、Flow 只放示意图，
     所以按 编辑 > 结果 > Flow 的顺序递减分配宽度。 */
  @media (min-width: 1280px) {
    .layout {
      grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr) minmax(0, 0.82fr);
      grid-template-areas: "editor result flow";
      gap: 14px;
    }
  }
  /* 更宽的屏幕收回常规间距并让三栏趋于均分。 */
  @media (min-width: 1500px) {
    .layout {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.92fr);
      gap: 18px;
    }
  }
  @media (max-width: 1040px) {
    .layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-areas: "editor" "result" "flow";
    }
  }

  /* 1280–1500px：三栏并排但每栏只有 ~370px，收窄页面外边距与面板内边距，
     把省下的横向空间还给 JSON 编辑器。 */
  @media (min-width: 1280px) and (max-width: 1499px) {
    main { padding-left: 20px; padding-right: 20px; }
    .page-hero { margin-left: -20px; margin-right: -20px; padding-left: 20px; padding-right: 20px; }
    .layout > .panel { padding: 18px 16px 18px; }
    .layout > .panel > h2,
    .layout > .panel > .result-header {
      top: -18px;
      margin-top: -18px;
      padding-top: 18px;
    }
    /* 这一档表头 30% 会把「实例 ID」挤成两行，改为上下堆叠更好读。 */
    .panel-result table tr { display: grid; gap: 2px; padding: 7px 0; border-bottom: 1px solid var(--border-subtle); }
    .panel-result table th, .panel-result table td { width: auto; padding: 0; border-bottom: none; }
  }

  /* 三块各自滚动，页面本身保持在一屏左右。 */
  /* 注意断点必须与三栏并排的 1280px 对齐：sticky 只在三块同处一行时成立。
     若从 1041px 就开始 sticky，1041–1279px 这一档 Flow 实际在第二行，
     会粘在视口上盖住上方的「编辑并运行」。 */
  @media (min-width: 1280px) {
    .layout > .panel {
      position: sticky;
      top: 72px;
      max-height: calc(100vh - 92px);
      overflow: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: var(--border-strong) transparent;
    }
    .layout > .panel::-webkit-scrollbar { width: 8px; }
    .layout > .panel::-webkit-scrollbar-track { background: transparent; }
    .layout > .panel::-webkit-scrollbar-thumb {
      background: var(--border-strong);
      border-radius: 999px;
      border: 2px solid transparent;
      background-clip: content-box;
    }
    .layout > .panel:hover::-webkit-scrollbar-thumb { background: var(--border-hover); background-clip: content-box; }
    /* 面板标题在各自滚动区内吸顶，长 JSON 滚动时仍知道在看哪一块。 */
    .layout > .panel > h2,
    .layout > .panel > .result-header {
      position: sticky;
      top: -20px;
      z-index: 2;
      margin-top: -20px;
      padding-top: 20px;
      background: var(--bg-panel);
    }
  }

  .panel {
    min-width: 0;
    background: var(--bg-panel);
    border: 1px solid var(--border-standard);
    box-shadow: var(--shadow-line) 0 0 0 1px, 0 1px 2px rgba(0,0,0,0.03);
    border-radius: 16px;
    padding: 20px 22px 22px;
    transition: border-color 0.2s;
  }
  .panel h2 {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 15px;
    font-weight: 590;
    letter-spacing: -0.15px;
    color: var(--text-primary);
  }
  .step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
    color: var(--chip-text);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 590;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }

  textarea, input, .btn-row button {
    width: 100%;
    background: var(--overlay-1);
    border: 1px solid var(--border-standard);
    color: var(--text-secondary);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 13px;
    letter-spacing: -0.02px;
    font-family: inherit;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  textarea:hover { border-color: var(--border-hover); }
  textarea:focus, input:focus {
    outline: none;
    border-color: var(--brand);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
  textarea {
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.6;
    resize: vertical;
    background: var(--bg-panel);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);
  }
  #def-editor { min-height: 220px; }
  #input-editor { min-height: 72px; }

  label { display: block; font-size: 12px; font-weight: 510; letter-spacing: -0.02px; color: var(--text-muted); margin: 14px 0 7px; }
  .desc { font-size: 12.5px; letter-spacing: -0.11px; color: var(--text-muted); margin: -4px 0 0; line-height: 1.55; }
  .btn-row { display: flex; gap: 10px; margin-top: 18px; }
  .btn-row button { flex: 1; min-width: 0; }

  button {
    cursor: pointer;
    padding: 11px 18px;
    background: var(--brand);
    border: 1px solid var(--brand);
    color: #fff;
    font-size: 13.5px;
    font-weight: 510;
    letter-spacing: -0.13px;
    border-radius: 9px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 0 var(--accent-glow);
    transition: background 0.15s, border-color 0.15s, box-shadow 0.2s, transform 0.15s;
  }
  button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    box-shadow: 0 2px 12px -2px var(--accent-glow);
  }
  button:active:not(:disabled) { transform: translateY(1px); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary {
    background: var(--overlay-1);
    border-color: var(--border-strong);
    color: var(--btn-text);
    box-shadow: none;
  }
  button.secondary:hover:not(:disabled) { background: var(--overlay-2); border-color: var(--border-hover); box-shadow: none; }

  .status-line {
    margin-top: 14px;
    font-size: 12.5px;
    letter-spacing: -0.11px;
    padding: 10px 13px;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
    min-height: 18px;
    word-break: break-all;
    transition: color 0.2s, border-color 0.2s;
  }
  .status-line.ok { color: var(--green); border-color: var(--green-border); background: var(--green-bg); }
  .status-line.err { color: var(--red); border-color: var(--red-border); background: var(--red-bg); }

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
  .badge-completed, .badge-success { background: var(--green-bg); color: var(--green-text); border-color: var(--green-border); }
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
  th { color: var(--text-muted); font-weight: 510; font-size: 12px; width: 30%; white-space: nowrap; }
  td { color: var(--text-secondary); word-break: break-all; }
  @media (max-width: 560px) {
    /* 窄屏下 30% 的表头列会把「实例 ID」挤成竖排，改为上下堆叠。 */
    table tr { display: grid; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--border-subtle); }
    table th, table td { width: auto; padding: 0; border-bottom: none; }
  }
  tbody tr:hover { background: var(--overlay-1); }

  code { background: var(--overlay-3); padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); color: var(--code-text); font-size: 12px; }
  .hint { font-size: 15px; letter-spacing: -0.15px; line-height: 1.65; color: var(--text-muted); margin: 0; }
  .hint code { background: var(--overlay-3); }
  .empty {
    color: var(--text-subtle);
    font-size: 13px;
    padding: 52px 24px;
    text-align: center;
    border: 1px dashed var(--border-standard);
    border-radius: 12px;
    background: var(--overlay-1);
  }
  .empty p { margin: 12px 0 0; max-width: 320px; margin-left: auto; margin-right: auto; }
  .empty-icon-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
  }
  .empty-icon { width: 24px; height: 24px; color: var(--chip-text); }

  /* ── 节点进度条 ──────────────────────────────── */
  .meter { margin: 2px 0 18px; }
  .meter-head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 7px; font-size: 12px; font-weight: 510; color: var(--text-muted);
  }
  .meter-count { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-subtle); }
  .meter-track {
    height: 5px; border-radius: 999px; overflow: hidden;
    background: var(--overlay-3);
  }
  .meter-fill {
    height: 100%; width: 0%; border-radius: 999px;
    background: var(--brand);
    transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s;
  }
  .meter-fill.done { background: var(--green); }
  .meter-fill.err { background: var(--red); }

  /* ── 节点执行时间线 ──────────────────────────── */
  .timeline { list-style: none; margin: 0; padding: 0 0 0 20px; position: relative; }
  .timeline::before {
    content: ""; position: absolute; left: 4px; top: 6px; bottom: 6px;
    width: 1px; background: var(--border-standard);
  }
  .tl-item { position: relative; padding: 0 0 14px; }
  .tl-item:last-child { padding-bottom: 0; }
  .tl-item::before {
    content: ""; position: absolute; left: -20px; top: 5px;
    width: 9px; height: 9px; border-radius: 50%;
    background: var(--bg); border: 2px solid var(--text-subtle);
  }
  .tl-item.ok::before { border-color: var(--green); background: var(--green); }
  .tl-item.err::before { border-color: var(--red); background: var(--red); }
  .tl-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .tl-node {
    font-family: var(--font-mono); font-size: 12.5px; font-weight: 510;
    color: var(--text-primary); word-break: break-all;
  }
  .tl-dur {
    margin-left: auto; flex: none;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-subtle);
  }
  .tl-out {
    margin: 6px 0 0; padding: 8px 10px;
    background: var(--bg-panel); border: 1px solid var(--border-subtle);
    border-radius: 7px;
    font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5;
    color: var(--text-secondary);
    overflow-x: auto; white-space: pre-wrap; word-break: break-word;
  }
  .tl-empty { color: var(--text-subtle); font-size: 12.5px; padding: 8px 0; }

  /* ── 可折叠的原始 JSON ───────────────────────── */
  .raw-box { margin-top: 14px; }
  .raw-box > summary {
    display: flex; align-items: center; gap: 7px;
    cursor: pointer; list-style: none;
    font-size: 12px; font-weight: 510; color: var(--text-muted);
    padding: 6px 0;
  }
  .raw-box > summary::-webkit-details-marker { display: none; }
  .raw-box > summary:hover { color: var(--text-primary); }
  .raw-box .chev {
    width: 0; height: 0; flex: none;
    border-left: 4px solid currentColor;
    border-top: 3.5px solid transparent; border-bottom: 3.5px solid transparent;
    transition: transform 0.15s;
  }
  .raw-box[open] > summary .chev { transform: rotate(90deg); }
  .raw-box pre { margin-top: 6px; }

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
    max-height: 132px;
    font-size: 11px;
    line-height: 1.55;
  }
  .mini-copy {
    /* 通用 button 规则带 width:100%，这里必须显式收回，否则会把标题挤成竖排 */
    width: auto;
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

  /* ── 节点 Flow 示意图 ────────────────────────── */
  .flow-legend { display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); }
  .flow-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .flow-legend .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .flow-legend .dot-done { background: var(--wf-green-stroke); box-shadow: 0 0 0 3px var(--wf-green-fill); }
  .flow-legend .dot-idle { background: var(--text-subtle); }
  .flow-wrap {
    position: relative;
    margin-top: 16px;
    border: 1px solid var(--border-subtle);
    border-radius: 14px;
    background:
      radial-gradient(60% 100% at 10% 0%, var(--wf-glow), transparent 70%),
      var(--bg-panel);
    box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);
    overflow: auto;
    min-height: 140px;
    padding: 4px;
  }
  /* 小图不应被拉满整块面板：按 intrinsic 尺寸封顶并居中，超宽时才横向滚动。 */
  .flow-wrap svg { display: block; margin: 0 auto; max-width: 100%; height: auto; }
  .flow-empty { padding: 48px 16px; text-align: center; color: var(--text-subtle); font-size: 13px; }
  .flow-node-box {
    fill: var(--wf-fill-idle);
    stroke: var(--wf-edge);
    stroke-width: 1;
    transition: fill 0.2s, stroke 0.2s;
  }
  .flow-node.is-start .flow-node-box { stroke: var(--wf-node-stroke); stroke-width: 1.4; }
  .flow-node.is-done .flow-node-box { fill: var(--wf-green-fill); stroke: var(--wf-green-stroke); }
  .flow-node.is-current .flow-node-box {
    fill: var(--wf-node-fill);
    stroke: var(--wf-node-stroke);
    filter: drop-shadow(0 0 6px var(--wf-node-glow));
  }
  .flow-node.is-error .flow-node-box { fill: var(--red-bg); stroke: var(--red); }
  .flow-node-id {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 590;
    fill: var(--text-primary);
  }
  .flow-node-type {
    font-family: var(--font-mono);
    font-size: 9.5px;
    fill: var(--text-subtle);
    letter-spacing: 0.02em;
  }
  .flow-node.is-done .flow-node-type { fill: var(--green-text); }
  .flow-edge-line { fill: none; stroke: var(--wf-edge); stroke-width: 1.4; }
  .flow-edge-line.is-active { stroke: var(--flow-line); stroke-width: 1.8; }
  .flow-edge-label {
    font-family: var(--font-mono);
    font-size: 9.5px;
    fill: var(--text-subtle);
  }
  .flow-edge-label.is-active { fill: var(--tag-active); }

  /* ── 运行历史 ────────────────────────────────── */
  .history {
    margin-top: 18px;
    padding: 18px 22px 20px;
    border: 1px solid var(--border-standard);
    border-radius: 16px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-line) 0 0 0 1px;
  }
  .history h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 590;
    letter-spacing: -0.15px;
    color: var(--text-primary);
  }
  .history h2::before {
    content: "4";
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
    color: var(--chip-text);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 590;
  }
  .history .history-sub { margin: 0 0 14px; font-size: 12.5px; color: var(--text-muted); padding-left: 36px; }
  .history-list { max-height: 240px; overflow-y: auto; }
  .history-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
  .history-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 11px 14px;
    background: var(--bg-panel);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
  }
  .history-item:hover { background: var(--overlay-2); border-color: var(--hairline); transform: translateY(-1px); }
  .history-item .h-badge { flex: none; }
  .history-item .h-name {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
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
  .history-empty {
    color: var(--text-subtle);
    font-size: 13px;
    padding: 28px 16px;
    text-align: center;
    border: 1px dashed var(--border-standard);
    border-radius: 10px;
    background: var(--overlay-1);
  }

  /* ── 主题切换（位于顶栏内）────────────────────── */
  button.theme-toggle {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border-standard);
    border-radius: 7px;
    color: var(--text-muted);
    cursor: pointer;
    font-family: inherit;
    transition: 0.12s;
  }
  button.theme-toggle:hover { background: var(--overlay-2); color: var(--text-primary); }
  .theme-toggle svg { width: 15px; height: 15px; display: block; }
  :root[data-theme="dark"] .theme-toggle .i-moon { display: none; }
  :root[data-theme="light"] .theme-toggle .i-sun { display: none; }
</style>
</head>
<body>
<div class="topbar">
  <a class="brand" href="/">ts-workflow-engine-lite</a>
  <div class="topbar-links">
    <a href="/docs/nodes">节点参考</a>
    <a href="/api-docs">REST API</a>
    <a href="/docs/concepts">核心概念</a>
    <a href="/playground" class="active">Playground</a>
  </div>
  <div class="topbar-spacer"></div>
  <button type="button" id="themeToggle" class="theme-toggle" aria-label="切换亮暗主题" title="切换亮暗主题">
    <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
    <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
  </button>
</div>
<main>
  <div class="page-hero">
    <div class="page-hero-inner">
      <div class="page-hero-text">
        <span class="page-eyebrow">本机实时运行 &middot; REST API</span>
        <h1>Playground</h1>
        <p class="hint">
          直接调用本机 REST API（<code>http://localhost:${port}/workflow-api/v1</code>）注册并启动示例工作流，
          实时查看节点输出、表达式求值与条件路由的真实执行结果。
        </p>
      </div>
    </div>
  </div>

  <div class="demo-strip-wrap">
    <div class="demo-strip-head">
      <b>示例工作流</b>
      <span>点击卡片载入定义</span>
    </div>
    <div class="demo-strip" id="demo-strip" role="listbox" aria-label="示例工作流">
${demoCards}
    </div>
  </div>

  <div class="layout">
    <div class="panel panel-editor">
      <h2><span class="step">1</span>编辑并运行</h2>
      <p class="desc" id="demo-desc"></p>

      <label for="def-editor">工作流定义 JSON（可编辑）</label>
      <textarea id="def-editor" rows="16" spellcheck="false"></textarea>
      <p class="field-hint" id="def-hint"></p>

      <label for="input-editor">启动输入（context）</label>
      <textarea id="input-editor" rows="4" spellcheck="false"></textarea>
      <p class="field-hint" id="input-hint"></p>

      <div class="btn-row">
        <button id="run-btn" type="button">注册并运行</button>
        <button id="reset-btn" class="secondary" type="button">重置</button>
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

    <div class="panel panel-result">
      <div class="result-header">
        <h2><span class="step">2</span>执行结果</h2>
        <span id="status-badge"></span>
      </div>
      <div id="result-empty" class="empty">
        <span class="empty-icon-wrap">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h4l2 5 3-10 2 5h3"/></svg>
        </span>
        <p>运行后这里会显示实例状态、节点输出与执行日志</p>
      </div>
      <div id="result-body" style="display:none">
        <div class="meter" id="r-meter">
          <div class="meter-head">
            <span id="r-progress-label">节点进度</span>
            <span id="r-progress-count" class="meter-count"></span>
          </div>
          <div class="meter-track"><div class="meter-fill" id="r-progress-fill"></div></div>
        </div>

        <table>
          <tbody>
            <tr><th>实例 ID</th><td id="r-instance-id"></td></tr>
            <tr><th>工作流</th><td id="r-workflow-id"></td></tr>
            <tr><th>当前节点</th><td id="r-current-node"></td></tr>
          </tbody>
        </table>

        <label style="margin-top:16px">节点执行时间线</label>
        <ol class="timeline" id="r-timeline"></ol>

        <details class="raw-box">
          <summary><span class="chev" aria-hidden="true"></span>节点输出（context）</summary>
          <pre id="r-context">-</pre>
        </details>
        <details class="raw-box">
          <summary><span class="chev" aria-hidden="true"></span>完整实例快照</summary>
          <pre id="r-raw">-</pre>
        </details>
      </div>
    </div>

    <div class="panel flow-panel">
      <div class="result-header">
        <h2><span class="step">3</span>节点 Flow 示意图</h2>
        <span class="flow-legend">
          <span class="flow-legend-item"><i class="dot dot-done"></i>已执行</span>
          <span class="flow-legend-item"><i class="dot dot-idle"></i>未执行</span>
        </span>
      </div>
      <p class="desc" style="margin-top:-2px">根据「工作流定义 JSON」自动解析节点与流转关系；运行后已执行的节点与实际走过的分支会高亮。</p>
      <div class="flow-wrap" id="flow-wrap">
        <div class="flow-empty" id="flow-empty">定义 JSON 不合法或没有可解析的节点</div>
        <svg id="flow-svg" xmlns="http://www.w3.org/2000/svg" style="display:none"></svg>
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

  var demoStrip = document.getElementById("demo-strip");
  var currentDemoId = DEMOS[0] && DEMOS[0].id;
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

  function syncDemoCards(id) {
    if (!demoStrip) return;
    var cards = demoStrip.querySelectorAll(".demo-card");
    for (var i = 0; i < cards.length; i++) {
      var selected = cards[i].getAttribute("data-demo-id") === id;
      cards[i].setAttribute("aria-selected", selected ? "true" : "false");
    }
  }

  function loadDemo(id) {
    var demo = findDemo(id);
    currentDemoId = demo.id;
    syncDemoCards(demo.id);
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
    // success 是节点级（history）状态，completed 是实例级；两者共用绿色样式。
    var known = ["completed", "success", "running", "failed", "waiting", "paused"];
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

  /** 把 instance.history 渲染成节点执行时间线（比一坨原始 JSON 更可读）。 */
  function renderTimeline(instance) {
    var list = document.getElementById("r-timeline");
    var history = instance.history || [];
    if (!history.length) {
      list.innerHTML = '<li class="tl-empty">尚无节点执行记录</li>';
      return;
    }
    var html = "";
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var ok = h.status === "success";
      var cls = ok ? "ok" : h.status === "failed" || h.status === "error" ? "err" : "";
      var dur = typeof h.duration === "number" ? h.duration + "ms" : "";
      var payload = h.data !== undefined ? h.data : h.error;
      var body = "";
      if (payload !== undefined && payload !== null) {
        var text = typeof payload === "string" ? payload : JSON.stringify(payload);
        body = '<div class="tl-out">' + escapeText(text) + "</div>";
      }
      html +=
        '<li class="tl-item ' + cls + '">' +
        '<div class="tl-head">' +
        '<span class="tl-node">' + escapeText(String(h.nodeId || "-")) + "</span>" +
        badgeFor(h.status) +
        (dur ? '<span class="tl-dur">' + dur + "</span>" : "") +
        "</div>" + body +
        "</li>";
    }
    list.innerHTML = html;
  }

  /** 节点进度条：优先用服务端返回的 completedNodes/totalNodes。 */
  /**
   * 渲染进度条。
   *
   * 注意：instance.totalNodes 是定义里的节点总数，而条件/路由类工作流天然
   * 只会走中其中一条分支——未走到的分支节点永远不会完成。若直接用
   * completedNodes/totalNodes 作分母，一次成功的分支工作流会永远停在
   * 50%~75%，看起来像"没跑完"。因此终态实例按状态显示 100%，
   * 仅在运行中才用节点数估算进度。
   */
  function renderProgress(instance) {
    var fill = document.getElementById("r-progress-fill");
    var count = document.getElementById("r-progress-count");
    var total = instance.totalNodes || 0;
    var done = instance.completedNodes || 0;
    var terminal = ["completed", "failed", "cancelled", "terminated"];
    var isTerminal = terminal.indexOf(instance.status) >= 0;
    var pct;
    if (isTerminal) {
      pct = 100;
    } else {
      pct = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
    }
    fill.style.width = pct + "%";
    fill.className = "meter-fill" +
      (instance.status === "failed" ? " err" : instance.status === "completed" ? " done" : "");
    if (isTerminal) {
      // 分支工作流里 done < total 属正常现象，标注"已执行"而非"x/total"
      count.textContent = done > 0 ? "已执行 " + done + " 个节点 · 100%" : "100%";
    } else {
      count.textContent = total > 0 ? done + " / " + total + " 节点 · " + pct + "%" : pct + "%";
    }
  }

  function renderInstance(instance) {
    resultEmpty.style.display = "none";
    resultBody.style.display = "block";
    statusBadge.innerHTML = badgeFor(instance.status);
    document.getElementById("r-instance-id").textContent = instance.instanceId || "-";
    document.getElementById("r-workflow-id").textContent = instance.workflowId || "-";
    var current = instance.currentNode ||
      (instance.currentNodes && instance.currentNodes.length ? instance.currentNodes.join(", ") : "");
    document.getElementById("r-current-node").textContent = current || "-";
    renderProgress(instance);
    renderTimeline(instance);
    document.getElementById("r-context").textContent = JSON.stringify(instance.context || {}, null, 2);
    document.getElementById("r-raw").textContent = JSON.stringify(instance, null, 2);
    lastInstanceForFlow = instance;
    try {
      renderFlow(JSON.parse(defEditor.value), instance);
    } catch (e) { /* 编辑器内容此刻非法就跳过，保留上一次的 flow 图 */ }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /**
   * 轮询实例直至终态，返回最终 status。
   * 注意必须是可 await 的循环：早期版本用 setTimeout 递归且不 await，
   * 调用方会在首轮轮询后立即继续，把 running 写进运行历史。
   */
  async function pollInstance(instanceId, attemptsLeft) {
    var terminal = ["completed", "failed", "cancelled", "terminated"];
    for (var i = attemptsLeft; i >= 0; i--) {
      var instance;
      try {
        instance = await apiFetch("/instances/" + encodeURIComponent(instanceId));
      } catch (err) {
        setStatus("轮询实例状态失败: " + escapeText(err.message), "err");
        return "unknown";
      }
      renderInstance(instance);
      if (terminal.indexOf(instance.status) >= 0 || i === 0) {
        setStatus(
          instance.status === "completed"
            ? "执行完成"
            : "执行结束，状态: " + instance.status,
          instance.status === "completed" ? "ok" : instance.status === "failed" ? "err" : "",
        );
        return instance.status;
      }
      setStatus("运行中&hellip;（" + instance.status + "）", "");
      await delay(500);
    }
    return "unknown";
  }

  function escapeText(s) {
    var div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  /* ── 节点 Flow 示意图 ─────────────────────────
   * 从「工作流定义 JSON」推导节点与流转边（next / conditionalNext /
   * defaultNext / condition 节点 trueBranch|falseBranch / router 节点
   * routes|defaultTarget / join 节点 waitFor 的反向边），做简单的按层
   * 广度优先布局后画成 SVG。运行结束后用 instance.history 高亮已执行
   * 的节点和实际走过的边，不依赖任何额外的可视化库。
   */
  var flowWrap = document.getElementById("flow-wrap");
  var flowEmpty = document.getElementById("flow-empty");
  var flowSvg = document.getElementById("flow-svg");
  var SVGNS = "http://www.w3.org/2000/svg";

  /** 解析 nodes/startNode，得到 { nodes: [{id,type}], edges: [{from,to,label}] }。 */
  function parseFlowGraph(definition) {
    if (!definition || typeof definition !== "object" || !definition.nodes || typeof definition.nodes !== "object") {
      return null;
    }
    var nodeIds = Object.keys(definition.nodes);
    if (!nodeIds.length) return null;

    var nodes = nodeIds.map(function (id) {
      var n = definition.nodes[id] || {};
      return { id: id, type: n.type || "?" };
    });
    var nodeIdSet = {};
    nodeIds.forEach(function (id) { nodeIdSet[id] = true; });

    var edges = [];
    function addEdge(from, to, label) {
      if (!to || !nodeIdSet[to]) return;
      edges.push({ from: from, to: to, label: label || "" });
    }

    nodeIds.forEach(function (id) {
      var n = definition.nodes[id] || {};
      var cfg = n.config || {};

      if (Array.isArray(n.next)) {
        n.next.forEach(function (t) { addEdge(id, t, ""); });
      }
      if (Array.isArray(n.conditionalNext)) {
        n.conditionalNext.forEach(function (c) {
          addEdge(id, c && c.target, "cond");
        });
      }
      if (n.defaultNext) addEdge(id, n.defaultNext, "default");
      if (Array.isArray(n.failureNext)) {
        n.failureNext.forEach(function (t) { addEdge(id, t, "on fail"); });
      }

      // condition 节点：config.trueBranch / config.falseBranch
      if (cfg.trueBranch) addEdge(id, cfg.trueBranch, "true");
      if (cfg.falseBranch) addEdge(id, cfg.falseBranch, "false");

      // router 节点：config.routes[].target / config.defaultTarget
      if (Array.isArray(cfg.routes)) {
        cfg.routes.forEach(function (r, i) {
          addEdge(id, r && r.target, "route " + (i + 1));
        });
      }
      if (cfg.defaultTarget) addEdge(id, cfg.defaultTarget, "default");

      // loop 节点常见字段：config.body / config.next
      if (cfg.body) addEdge(id, cfg.body, "loop body");

      // join 节点：反向画出被等待的分支 -> join 本身
      if (n.type === "join" && Array.isArray(cfg.waitFor)) {
        cfg.waitFor.forEach(function (src) { addEdge(src, id, "join"); });
      }

      // subworkflow 节点：rollbackTo 也算一种流转
      if (n.rollbackTo) addEdge(id, n.rollbackTo, "rollback");
    });

    return { nodes: nodes, edges: edges, startNode: definition.startNode };
  }

  /** 按 BFS 层数做一个简单的分层布局：{ layerOf, layers: [[id,...]] }。 */
  function layoutLayers(graph) {
    var adj = {};
    graph.nodes.forEach(function (n) { adj[n.id] = []; });
    graph.edges.forEach(function (e) {
      if (adj[e.from]) adj[e.from].push(e.to);
    });

    var layerOf = {};
    var queue = [];
    var start = graph.startNode && adj.hasOwnProperty(graph.startNode) ? graph.startNode : graph.nodes[0].id;
    layerOf[start] = 0;
    queue.push(start);
    while (queue.length) {
      var cur = queue.shift();
      var curLayer = layerOf[cur];
      (adj[cur] || []).forEach(function (next) {
        var candidate = curLayer + 1;
        if (!(next in layerOf) || candidate < layerOf[next]) {
          layerOf[next] = candidate;
          queue.push(next);
        }
      });
    }
    // 未被起点可达的节点（孤立/反向引用）统一放到末尾一层
    var maxLayer = 0;
    Object.keys(layerOf).forEach(function (id) { if (layerOf[id] > maxLayer) maxLayer = layerOf[id]; });
    graph.nodes.forEach(function (n) {
      if (!(n.id in layerOf)) layerOf[n.id] = maxLayer + 1;
    });

    var layers = [];
    graph.nodes.forEach(function (n) {
      var l = layerOf[n.id];
      if (!layers[l]) layers[l] = [];
      layers[l].push(n.id);
    });
    for (var i = 0; i < layers.length; i++) {
      if (!layers[i]) layers[i] = [];
    }
    return { layerOf: layerOf, layers: layers };
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /**
   * 渲染 flow 图。
   * @param definition 工作流定义（已 JSON.parse）
   * @param instance 可选，最近一次执行的实例（用于高亮已执行节点/边）
   */
  function renderFlow(definition, instance) {
    var graph = parseFlowGraph(definition);
    if (!graph) {
      flowEmpty.style.display = "block";
      flowEmpty.textContent = "定义 JSON 不合法或没有可解析的节点";
      flowSvg.style.display = "none";
      return;
    }

    var executedNodes = {};
    var executedEdges = {};
    var currentNode = null;
    if (instance) {
      var history = instance.history || [];
      history.forEach(function (h) {
        if (h && h.nodeId) {
          executedNodes[h.nodeId] = executedNodes[h.nodeId] || (h.status === "success" ? "ok" : "err");
          if (h.status === "success") executedNodes[h.nodeId] = "ok";
        }
      });
      // 一条定义中的边只要两端都执行过就视为"走过"：history 是按完成顺序排列的
      // 单一序列，fan-out/fan-in（如 join 的多条入边）会打乱相邻顺序，用相邻
      // 节点对推导会漏标；两端都执行过对分支/条件节点已经足够准确，因为未被
      // 选中的分支节点根本不会出现在 history 里。
      graph.edges.forEach(function (e) {
        if (executedNodes[e.from] && executedNodes[e.to]) {
          executedEdges[e.from + ">" + e.to] = true;
        }
      });
      currentNode = instance.currentNode ||
        (instance.currentNodes && instance.currentNodes.length ? instance.currentNodes[0] : null);
    }

    var layout = layoutLayers(graph);
    var layers = layout.layers;

    var NODE_W = 132, NODE_H = 46;
    var COL_GAP = 76, ROW_GAP = 22;
    var PAD = 24;
    var maxRows = Math.max.apply(null, layers.map(function (l) { return l.length; }).concat([1]));
    var width = PAD * 2 + layers.length * NODE_W + Math.max(0, layers.length - 1) * COL_GAP;
    var height = PAD * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP;

    var pos = {};
    layers.forEach(function (layerNodeIds, col) {
      var colHeight = layerNodeIds.length * NODE_H + Math.max(0, layerNodeIds.length - 1) * ROW_GAP;
      var offsetY = PAD + (height - PAD * 2 - colHeight) / 2;
      layerNodeIds.forEach(function (id, row) {
        pos[id] = {
          x: PAD + col * (NODE_W + COL_GAP),
          y: offsetY + row * (NODE_H + ROW_GAP),
        };
      });
    });

    flowSvg.setAttribute("viewBox", "0 0 " + width + " " + height);
    flowSvg.setAttribute("width", width);
    flowSvg.setAttribute("height", height);
    flowSvg.innerHTML = "";

    var defs = svgEl("defs", {});
    var marker = svgEl("marker", {
      id: "flow-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5",
      markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
    });
    var arrowPath = svgEl("path", { d: "M0 0L10 5L0 10z" });
    arrowPath.setAttribute("fill", "var(--wf-edge)");
    marker.appendChild(arrowPath);
    var markerActive = svgEl("marker", {
      id: "flow-arrow-active", viewBox: "0 0 10 10", refX: "9", refY: "5",
      markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse",
    });
    var arrowPathActive = svgEl("path", { d: "M0 0L10 5L0 10z" });
    arrowPathActive.setAttribute("fill", "var(--flow-line)");
    markerActive.appendChild(arrowPathActive);
    defs.appendChild(marker);
    defs.appendChild(markerActive);
    flowSvg.appendChild(defs);

    var edgeLayer = svgEl("g", {});
    var nodeLayer = svgEl("g", {});

    graph.edges.forEach(function (e) {
      var from = pos[e.from], to = pos[e.to];
      if (!from || !to) return;
      var x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
      var x2 = to.x, y2 = to.y + NODE_H / 2;
      var mx = (x1 + x2) / 2;
      var isActive = !!executedEdges[e.from + ">" + e.to];
      var path = svgEl("path", {
        d: "M" + x1 + " " + y1 + " C " + mx + " " + y1 + ", " + mx + " " + y2 + ", " + x2 + " " + y2,
        class: "flow-edge-line" + (isActive ? " is-active" : ""),
        "marker-end": "url(#" + (isActive ? "flow-arrow-active" : "flow-arrow") + ")",
      });
      edgeLayer.appendChild(path);
      if (e.label) {
        var label = svgEl("text", {
          x: mx, y: (y1 + y2) / 2 - 5,
          class: "flow-edge-label" + (isActive ? " is-active" : ""),
          "text-anchor": "middle",
        });
        label.textContent = e.label;
        edgeLayer.appendChild(label);
      }
    });

    graph.nodes.forEach(function (n) {
      var p = pos[n.id];
      if (!p) return;
      var state = executedNodes[n.id];
      var classes = "flow-node" +
        (n.id === graph.startNode ? " is-start" : "") +
        (state === "ok" ? " is-done" : "") +
        (state === "err" ? " is-error" : "") +
        (n.id === currentNode && instance && instance.status === "running" ? " is-current" : "");
      var g = svgEl("g", { class: classes, transform: "translate(" + p.x + "," + p.y + ")" });
      var rect = svgEl("rect", {
        class: "flow-node-box", width: NODE_W, height: NODE_H, rx: 9, ry: 9,
      });
      var idText = svgEl("text", { class: "flow-node-id", x: 11, y: 19 });
      idText.textContent = n.id.length > 16 ? n.id.slice(0, 15) + "…" : n.id;
      var typeText = svgEl("text", { class: "flow-node-type", x: 11, y: 34 });
      typeText.textContent = n.type + (n.id === graph.startNode ? "  · start" : "");
      g.appendChild(rect);
      g.appendChild(idText);
      g.appendChild(typeText);
      var titleEl = svgEl("title", {});
      titleEl.textContent = n.id + " (" + n.type + ")" + (state === "ok" ? " ✓ 已执行" : state === "err" ? " ✗ 失败" : "");
      g.appendChild(titleEl);
      nodeLayer.appendChild(g);
    });

    flowSvg.appendChild(edgeLayer);
    flowSvg.appendChild(nodeLayer);

    flowEmpty.style.display = "none";
    flowSvg.style.display = "block";
  }

  var lastInstanceForFlow = null;

  /** 供编辑器输入 / 切换示例时调用：仅按当前定义重绘（无高亮）。 */
  function updateFlowFromEditor() {
    var definition;
    try {
      definition = JSON.parse(defEditor.value);
    } catch (e) {
      flowEmpty.style.display = "block";
      flowEmpty.textContent = "工作流定义 JSON 解析失败，无法绘制 Flow 图";
      flowSvg.style.display = "none";
      return;
    }
    // 只要 workflowId 没变就沿用上一次的执行高亮，编辑后立刻失焦（换了结构，旧高亮可能对不上）
    renderFlow(definition, lastInstanceForFlow && lastInstanceForFlow.workflowId === definition.id ? lastInstanceForFlow : null);
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
      var finalStatus = await pollInstance(startResult.instanceId, 20);
      pushHistory({
        status: finalStatus,
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
    lastInstanceForFlow = null;
    updateFlowFromEditor();
  };

  var curlTimer = null;
  var flowTimer = null;
  function onEditorInput() {
    validateEditors();
    if (curlTimer) clearTimeout(curlTimer);
    curlTimer = setTimeout(updateCurl, 160);
    if (flowTimer) clearTimeout(flowTimer);
    flowTimer = setTimeout(updateFlowFromEditor, 220);
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

  if (demoStrip) {
    demoStrip.addEventListener("click", function (e) {
      var card = e.target && e.target.closest ? e.target.closest(".demo-card") : null;
      if (!card) return;
      var id = card.getAttribute("data-demo-id");
      if (id) loadDemo(id);
    });
  }
  runBtn.addEventListener("click", run);
  resetBtn.addEventListener("click", function () {
    loadDemo(currentDemoId);
  });

  loadDemo(currentDemoId);
})();
</script>
<script>
(function(){var b=document.getElementById("themeToggle");if(!b)return;b.addEventListener("click",function(){var d=document.documentElement,t=d.getAttribute("data-theme")==="light"?"dark":"light";d.setAttribute("data-theme",t);try{localStorage.setItem("tswe-theme",t)}catch(e){}})})();
</script>
</body>
</html>`;
}
