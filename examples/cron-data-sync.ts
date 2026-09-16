/**
 * 定时数据同步示例
 *
 * 场景：定时从数据源拉取数据，转换后写入目标。
 * 展示 cron 调度、action 节点、错误回滚。
 *
 * 运行：pnpm example:cron-sync
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const syncWorkflow: WorkflowDefinition = {
  id: "data-sync",
  name: "Scheduled data sync",
  cron: "*/5 * * * *",
  startNode: "extract",
  nodes: {
    extract: {
      id: "extract",
      type: "action",
      action: async () => {
        // Simulate data extraction
        return {
          records: [
            { id: 1, name: "Item A", value: 100 },
            { id: 2, name: "Item B", value: 200 },
            { id: 3, name: "Item C", value: 300 },
          ],
          extractedAt: new Date().toISOString(),
        };
      },
      next: ["transform"],
    },
    transform: {
      id: "transform",
      type: "action",
      action: async (instance) => {
        const extracted = instance.state?.nodes?.extract?.output as Record<
          string,
          unknown
        >;
        const records = extracted?.records as Array<Record<string, unknown>>;
        const transformed = records?.map((r) => ({
          ...r,
          value: (r.value as number) * 1.1,
          syncedAt: new Date().toISOString(),
        }));
        return { transformed, count: transformed?.length ?? 0 };
      },
      next: ["load"],
    },
    load: {
      id: "load",
      type: "action",
      maxRetries: 3,
      action: async (instance) => {
        const data = instance.state?.nodes?.transform?.output as Record<
          string,
          unknown
        >;
        // Simulate load
        return {
          loaded: true,
          recordsCount: data?.count,
          loadedAt: new Date().toISOString(),
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
    await engine.register(syncWorkflow);

    // Run once manually (without waiting for cron)
    const instanceId = await engine.start("data-sync", {});
    const result = await engine.waitForCompletion(instanceId);
    console.log("Sync result:", result.state?.nodes?.load?.output);
    console.log("Status:", result.status);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
