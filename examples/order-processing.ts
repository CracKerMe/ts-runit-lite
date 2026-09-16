import { bootstrap, destroyContainer } from "../src/index";
import type { WorkflowDefinition } from "../src/model/Workflow";
import { Logger } from "../src/utils/Logger";

// ── helpers ────────────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStep(
  step: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  Logger.info(
    "example",
    step,
    `\n${"═".repeat(50)}\n  ▶ ${message}\n${"═".repeat(50)}`,
    data,
  );
}

// ── workflow definition ────────────────────────────────────────────────
const orderWorkflow: WorkflowDefinition = {
  id: "order-processing-example",
  name: "订单处理示例流程",
  description: "演示条件分支、多节点流转的完整订单处理流程",
  version: "1.0.0",
  startNode: "validate-order",
  nodes: {
    "validate-order": {
      id: "validate-order",
      type: "action",
      action: async (instance) => {
        logStep("STEP-1", "📋 订单验证中...");
        await delay(800);

        const amount = instance?.context?.orderAmount ?? 150;
        const isValid = amount > 0 && amount < 100000;

        logStep("STEP-1", "✅ 订单验证完成", {
          amount,
          isValid,
          orderId: instance?.context?.orderId ?? "ORD-001",
        });

        return {
          valid: isValid,
          amount,
          orderId: instance?.context?.orderId ?? "ORD-001",
          timestamp: new Date().toISOString(),
        };
      },
      next: ["check-amount"],
    },

    "check-amount": {
      id: "check-amount",
      type: "condition",
      config: {
        condition: "orderAmount > 100",
        trueBranch: "premium-process",
        falseBranch: "standard-process",
      },
      next: ["premium-process", "standard-process"],
    },

    "premium-process": {
      id: "premium-process",
      type: "action",
      action: async (_instance) => {
        logStep("STEP-2A", "🌟 高级订单处理通道", {
          channel: "premium",
          priority: "high",
        });
        await delay(1000);

        logStep("STEP-2A", "✨ 高级通道处理完成", {
          discount: "10%",
          expressShipping: true,
        });

        return {
          channel: "premium",
          discount: 0.1,
          expressShipping: true,
          processedAt: new Date().toISOString(),
        };
      },
      next: ["send-notification"],
    },

    "standard-process": {
      id: "standard-process",
      type: "action",
      action: async (_instance) => {
        logStep("STEP-2B", "📦 标准订单处理通道", {
          channel: "standard",
          priority: "normal",
        });
        await delay(600);

        logStep("STEP-2B", "📦 标准通道处理完成", {
          discount: "0%",
          expressShipping: false,
        });

        return {
          channel: "standard",
          discount: 0,
          expressShipping: false,
          processedAt: new Date().toISOString(),
        };
      },
      next: ["send-notification"],
    },

    "send-notification": {
      id: "send-notification",
      type: "action",
      action: async (instance) => {
        const premiumOutput = instance?.state?.nodes?.["premium-process"]
          ?.output as { channel?: string } | undefined;
        const standardOutput = instance?.state?.nodes?.["standard-process"]
          ?.output as { channel?: string } | undefined;
        const channel =
          premiumOutput?.channel ?? standardOutput?.channel ?? "unknown";

        logStep("STEP-3", "📧 发送订单通知...", {
          channel,
          recipient: instance?.context?.email ?? "user@example.com",
        });
        await delay(500);

        logStep("STEP-3", "✅ 通知发送成功", {
          messageId: `MSG-${Date.now()}`,
        });

        return {
          notified: true,
          channel,
          messageId: `MSG-${Date.now()}`,
          sentAt: new Date().toISOString(),
        };
      },
      next: ["complete-order"],
    },

    "complete-order": {
      id: "complete-order",
      type: "action",
      action: async (instance) => {
        logStep("STEP-4", "🎉 订单处理完成！", {
          orderId: instance?.context?.orderId ?? "ORD-001",
          status: "completed",
        });

        return {
          success: true,
          completedAt: new Date().toISOString(),
          summary: "订单处理流程已顺利完成",
        };
      },
      next: [],
    },
  },
};

// ── test scenarios ─────────────────────────────────────────────────────
const scenarios = {
  smallOrder: {
    name: "小额订单测试",
    description: "订单金额 <= 100，走标准处理通道",
    context: {
      orderId: "ORD-SMALL-001",
      orderAmount: 50,
      email: "small-order@example.com",
      items: ["商品A"],
    },
  },
  largeOrder: {
    name: "大额订单测试",
    description: "订单金额 > 100，走高级处理通道",
    context: {
      orderId: "ORD-LARGE-001",
      orderAmount: 500,
      email: "vip@example.com",
      items: ["商品A", "商品B", "商品C"],
    },
  },
  boundaryOrder: {
    name: "边界值测试",
    description: "订单金额 = 100，测试条件分支边界",
    context: {
      orderId: "ORD-BOUNDARY-001",
      orderAmount: 100,
      email: "boundary@example.com",
      items: ["边界测试商品"],
    },
  },
};

// ── runner ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
  });

  try {
    await engine.register(orderWorkflow);

    const scenario = scenarios.largeOrder;
    Logger.info("example", "scenario", `📋 使用场景: ${scenario.name}`, {
      description: scenario.description,
    });

    const instanceId = await engine.start(orderWorkflow.id, scenario.context);
    Logger.info("example", "start", "🚀 工作流已启动", {
      instanceId,
      workflowId: orderWorkflow.id,
    });

    const instance = await engine.waitForCompletion(instanceId);
    console.log({
      instanceId,
      status: instance.status,
      state: instance.state,
    });
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
