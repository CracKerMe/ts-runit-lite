// oxlint-disable no-explicit-any -- dynamic types used throughout this module
/**
 * Demo 工作流定义
 * 用于演示和测试，与核心代码分离
 */
import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

export const demoWorkflow: WorkflowDefinition = {
  id: "user-onboarding",
  name: "User Onboarding Flow",
  startNode: "send-welcome-email",
  triggerEvents: ["email_confirmed"],
  nodes: {
    "send-welcome-email": {
      id: "send-welcome-email",
      type: "action",
      action: async () => {
        Logger.info("demo", "send-welcome-email", "--------------------");
        Logger.debug(
          "demo",
          "send-welcome-email",
          "[ACTION] Sending welcome email...",
        );
        return { sent: true };
      },
      next: ["wait-for-confirmation"],
    },
    "wait-for-confirmation": {
      id: "wait-for-confirmation",
      type: "event",
      onEvent: "email_confirmed",
      timeout: 5000,
      next: ["setup-account"],
      rollbackTo: "wait-for-confirmation",
      failureNext: ["wait-failed"],
      maxRetries: 2,
    },
    "wait-failed": {
      id: "wait-failed",
      type: "action",
      action: async () => {
        Logger.info("demo", "wait-failed", "=====================");
        Logger.debug("demo", "wait-failed", "[ACTION] Waiting failed...");
        return { waited: false };
      },
      next: ["send-failure-notification"],
    },
    "setup-account": {
      id: "setup-account",
      type: "action",
      action: async () => {
        Logger.info("demo", "setup-account", "=====================");
        Logger.debug(
          "demo",
          "setup-account",
          "[ACTION] Setting up user account...",
        );
        return { setup: true };
      },
      next: [],
    },
    "send-failure-notification": {
      id: "send-failure-notification",
      type: "action",
      action: async () => {
        Logger.info(
          "demo",
          "send-failure-notification",
          "=====================",
        );
        Logger.debug(
          "demo",
          "send-failure-notification",
          "[ACTION] Sending failure notification...",
        );
        return { notified: true };
      },
      next: [],
    },
  },
};

/**
 * 运行 Demo 工作流
 */
export async function runDemo(engine: any, eventBus: any): Promise<void> {
  try {
    await engine.register(demoWorkflow);
    Logger.info("demo", "register", "Demo workflow registered successfully");

    const instanceId = await engine.start("user-onboarding", {
      userId: "U-123",
    });
    Logger.info(
      "demo",
      "engine",
      `Started workflow with instance ID: ${instanceId}`,
    );

    // 模拟事件触发
    setTimeout(() => {
      try {
        Logger.info(
          "demo",
          "event",
          `[EVENT] Emitting email_confirmed for instance ${instanceId}...`,
        );
        eventBus.emit("email_confirmed", { token: "xyz789", instanceId });
      } catch (err) {
        Logger.error(
          "demo",
          "event",
          "Error emitting event",
          err instanceof Error ? err.stack : String(err),
        );
      }
    }, 4000);
  } catch (error) {
    Logger.error(
      "demo",
      "run",
      "Failed to run demo workflow",
      error instanceof Error ? error.stack : String(error),
    );
  }
}
