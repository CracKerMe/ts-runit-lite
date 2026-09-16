/**
 * HTTP 集成编排示例
 *
 * 场景：调用外部 REST API 编排数据——先获取用户信息，
 * 再根据用户类型调用不同的下游服务，带重试和错误处理。
 *
 * 运行：pnpm example:http
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const httpWorkflow: WorkflowDefinition = {
  id: "http-orchestration",
  name: "HTTP API orchestration",
  startNode: "fetch-user",
  nodes: {
    "fetch-user": {
      id: "fetch-user",
      type: "action",
      action: async () => {
        // Simulate HTTP call
        return {
          userId: "user-123",
          name: "Alice",
          tier: "premium",
          email: "alice@example.com",
        };
      },
      next: ["route-by-tier"],
    },
    "route-by-tier": {
      id: "route-by-tier",
      type: "condition",
      config: {
        condition:
          "${instance.state?.nodes['fetch-user']?.output?.tier === 'premium'}",
        trueBranch: "premium-notify",
        falseBranch: "standard-notify",
      },
    },
    "premium-notify": {
      id: "premium-notify",
      type: "action",
      action: async (instance) => {
        const user = instance.state?.nodes?.["fetch-user"]?.output as Record<
          string,
          unknown
        >;
        return {
          channel: "priority-email",
          message: `Premium notification for ${user?.name}`,
          sent: true,
        };
      },
      next: [],
    },
    "standard-notify": {
      id: "standard-notify",
      type: "action",
      action: async (instance) => {
        const user = instance.state?.nodes?.["fetch-user"]?.output as Record<
          string,
          unknown
        >;
        return {
          channel: "standard-email",
          message: `Standard notification for ${user?.name}`,
          sent: true,
        };
      },
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
    await engine.register(httpWorkflow);
    const instanceId = await engine.start("http-orchestration", {});
    const result = await engine.waitForCompletion(instanceId);

    const notifyOutput =
      result.status === "completed"
        ? (result.state?.nodes?.["premium-notify"]?.output ??
          result.state?.nodes?.["standard-notify"]?.output)
        : null;
    console.log("Result:", notifyOutput);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
