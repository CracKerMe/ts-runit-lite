/**
 * Worker 线程池示例
 *
 * 场景：CPU 密集型任务卸载到 worker 线程执行。
 * 展示 WORKER_POOL_ENABLED 配置和并发控制。
 *
 * 运行：WORKER_POOL_ENABLED=true pnpm example:worker-pool
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const cpuWorkflow: WorkflowDefinition = {
  id: "cpu-intensive",
  name: "CPU-intensive task with worker pool",
  startNode: "compute",
  nodes: {
    compute: {
      id: "compute",
      type: "action",
      action: async (instance) => {
        const n =
          ((instance.context as Record<string, unknown>)
            ?.iterations as number) ?? 1000000;
        // Simulate CPU work
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += Math.sqrt(i);
        }
        return { sum, iterations: n, pid: process.pid };
      },
      next: ["aggregate"],
    },
    aggregate: {
      id: "aggregate",
      type: "action",
      action: async (instance) => {
        const computeOutput = instance.state?.nodes?.compute?.output as Record<
          string,
          unknown
        >;
        return {
          finalResult:
            (computeOutput?.sum as number) /
            ((computeOutput?.iterations as number) ?? 1),
          processedBy: computeOutput?.pid,
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
    await engine.register(cpuWorkflow);

    // Run multiple tasks in parallel
    const ids = await Promise.all([
      engine.start("cpu-intensive", { iterations: 1000000 }),
      engine.start("cpu-intensive", { iterations: 2000000 }),
      engine.start("cpu-intensive", { iterations: 500000 }),
    ]);

    const results = await Promise.all(
      ids.map((id) => engine.waitForCompletion(id)),
    );
    results.forEach((r, i) => {
      console.log(`Task ${i + 1}:`, r.state?.nodes?.aggregate?.output);
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
