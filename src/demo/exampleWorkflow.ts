// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * Example Workflow - 订单处理流程
 *
 * 一个完整的示例工作流，用于调试和展示：
 * - 包含 condition 条件分支
 * - 包含多个 action 节点
 * - 有清晰的日志输出
 * - 可以通过 API 直接启动
 *
 * 使用方法：
 *   curl -X POST http://localhost:3345/console/example/start
 */

import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

// 辅助函数：模拟异步操作
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 辅助函数：格式化日志
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

/**
 * 示例工作流：订单处理流程
 */
export const exampleWorkflow: WorkflowDefinition = {
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

/**
 * 预定义的测试场景
 */
export const exampleScenarios = {
  // 场景1：小额订单（走标准通道）
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

  // 场景2：大额订单（走高级通道）
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

  // 场景3：边界值测试
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

/**
 * 运行示例工作流
 */
export async function runExample(
  engine: any,
  scenario?: keyof typeof exampleScenarios,
): Promise<string> {
  // 注册工作流
  await engine.register(exampleWorkflow);
  Logger.info("example", "register", "✅ 示例工作流注册成功");

  // 选择测试场景
  const selectedScenario = scenario
    ? exampleScenarios[scenario]
    : exampleScenarios.largeOrder;

  Logger.info("example", "scenario", `📋 使用场景: ${selectedScenario.name}`, {
    description: selectedScenario.description,
  });

  // 启动工作流
  const instanceId = await engine.start(
    exampleWorkflow.id,
    selectedScenario.context,
  );

  Logger.info("example", "start", "🚀 工作流已启动", {
    instanceId,
    workflowId: exampleWorkflow.id,
  });

  return instanceId;
}

export default exampleWorkflow;
