/**
 * 优雅降级与死信队列示例
 *
 * 场景：外部 API 调用失败时，通过 failureNext 走降级路径，
 * 最终失败的消息进入死信队列供后续排查。
 *
 * 运行：pnpm example:degradation
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const degradeWorkflow: WorkflowDefinition = {
  id: "graceful-degrade",
  name: "Graceful degradation with DLQ",
  startNode: "call-api",
  nodes: {
    "call-api": {
      id: "call-api",
      type: "action",
      maxRetries: 2,
      action: async () => {
        // Simulate API failure
        throw new Error("External API unavailable");
      },
      failureNext: ["fallback"],
    },
    fallback: {
      id: "fallback",
      type: "action",
      action: async () => ({
        degraded: true,
        reason: "Using cached data due to API failure",
        cachedAt: new Date().toISOString(),
      }),
      failureNext: ["dlq-handler"],
    },
    "dlq-handler": {
      id: "dlq-handler",
      type: "action",
      action: async (instance) => ({
        sentToDlq: true,
        instanceId: instance.instanceId,
      }),
      next: [],
    },
  },
};

async function main(): Promise<void> {
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
    logLevel: "WARN",
  });

  try {
    await engine.register(degradeWorkflow);
    const instanceId = await engine.start("graceful-degrade", {});
    const result = await engine.waitForCompletion(instanceId);
    console.log("Status:", result.status);
    console.log("Fallback output:", result.state?.nodes?.fallback?.output);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
