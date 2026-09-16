/**
 * Phase 2 验证：核心引擎不依赖 Express
 *
 * 运行：pnpm example:headless
 *
 * 此文件演示：
 * 1. 只导入核心引擎 API（不触碰 express）
 * 2. 使用 MemoryStorage 运行工作流
 * 3. 不需要安装 express / cors / helmet 等
 */

import {
  bootstrap,
  destroyContainer,
  Logger,
  type WorkflowDefinition,
} from "../src/index";

// 这个工作流定义完全不涉及 API 层
const pureWorkflow: WorkflowDefinition = {
  id: "headless-demo",
  name: "Headless engine demo (no Express needed)",
  startNode: "compute",
  nodes: {
    compute: {
      id: "compute",
      type: "action",
      action: async (instance) => {
        const input = (instance.context as Record<string, unknown>)
          ?.input as string;
        return {
          result: `Processed: ${input}`,
          timestamp: Date.now(),
        };
      },
      next: ["done"],
    },
    done: {
      id: "done",
      type: "action",
      action: async () => ({ status: "finished" }),
      next: [],
    },
  },
};

async function main(): Promise<void> {
  Logger.info(
    "system",
    "headless",
    "Running headless engine — no Express imported",
  );

  const { engine, container } = await bootstrap({
    skipGracefulShutdown: true,
    logLevel: "WARN",
    storageType: "memory",
  });

  try {
    await engine.register(pureWorkflow);
    const id = await engine.start("headless-demo", {
      input: "hello from headless",
    });
    const result = await engine.waitForCompletion(id);
    console.log("✅ Output:", result.state?.nodes?.compute?.output);
    console.log("✅ Status:", result.status);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
