/**
 * 嵌入式无 API 使用示例
 *
 * 场景：纯编程接口使用引擎，不启动 REST API 服务器。
 * 适合嵌入到现有应用、CLI 工具、后台任务中。
 *
 * 运行：pnpm example:headless
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const taskWorkflow: WorkflowDefinition = {
  id: "background-task",
  name: "Background data processing",
  startNode: "process",
  nodes: {
    process: {
      id: "process",
      type: "action",
      action: async (instance) => {
        const input = (instance.context as Record<string, unknown>)
          ?.data as string;
        return {
          processed: true,
          input,
          result: input?.toUpperCase(),
          timestamp: Date.now(),
        };
      },
      next: [],
    },
  },
};

async function main(): Promise<void> {
  // No API server, no graceful shutdown needed
  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
    logLevel: "WARN",
    storageType: "memory",
  });

  try {
    await engine.register(taskWorkflow);

    // Start multiple tasks concurrently
    const ids = await Promise.all([
      engine.start("background-task", { data: "hello" }),
      engine.start("background-task", { data: "world" }),
      engine.start("background-task", { data: "ts-we" }),
    ]);

    // Wait for all to complete
    const results = await Promise.all(
      ids.map((id) => engine.waitForCompletion(id)),
    );
    results.forEach((r) => {
      console.log(r.state?.nodes?.process?.output);
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
