/**
 * 多分支并行处理示例
 *
 * 场景：数据处理管道——并行执行多个分析任务，汇合后输出聚合结果。
 * 展示 next 数组并行、多节点同时执行。
 *
 * 运行：pnpm example:parallel
 */

import {
  bootstrap,
  destroyContainer,
  type WorkflowDefinition,
} from "../src/index";

const parallelWorkflow: WorkflowDefinition = {
  id: "parallel-analysis",
  name: "Parallel data analysis",
  startNode: "fetch-data",
  nodes: {
    "fetch-data": {
      id: "fetch-data",
      type: "action",
      action: async () => ({
        records: [
          { region: "us-east", revenue: 1200 },
          { region: "eu-west", revenue: 800 },
          { region: "ap-south", revenue: 600 },
        ],
      }),
      next: ["analyze-us", "analyze-eu", "analyze-ap"],
    },
    "analyze-us": {
      id: "analyze-us",
      type: "action",
      action: async (instance) => {
        const data = instance.state?.nodes?.["fetch-data"]?.output as Record<
          string,
          unknown
        >;
        const records = data?.records as Array<Record<string, unknown>>;
        const usRevenue = records
          ?.filter((r) => r.region === "us-east")
          .reduce((sum, r) => sum + (r.revenue as number), 0);
        return {
          region: "us-east",
          totalRevenue: usRevenue,
          status: "analyzed",
        };
      },
      next: ["merge"],
    },
    "analyze-eu": {
      id: "analyze-eu",
      type: "action",
      action: async (instance) => {
        const data = instance.state?.nodes?.["fetch-data"]?.output as Record<
          string,
          unknown
        >;
        const records = data?.records as Array<Record<string, unknown>>;
        const euRevenue = records
          ?.filter((r) => r.region === "eu-west")
          .reduce((sum, r) => sum + (r.revenue as number), 0);
        return {
          region: "eu-west",
          totalRevenue: euRevenue,
          status: "analyzed",
        };
      },
      next: ["merge"],
    },
    "analyze-ap": {
      id: "analyze-ap",
      type: "action",
      action: async (instance) => {
        const data = instance.state?.nodes?.["fetch-data"]?.output as Record<
          string,
          unknown
        >;
        const records = data?.records as Array<Record<string, unknown>>;
        const apRevenue = records
          ?.filter((r) => r.region === "ap-south")
          .reduce((sum, r) => sum + (r.revenue as number), 0);
        return {
          region: "ap-south",
          totalRevenue: apRevenue,
          status: "analyzed",
        };
      },
      next: ["merge"],
    },
    merge: {
      id: "merge",
      type: "action",
      action: async (instance) => {
        const us = instance.state?.nodes?.["analyze-us"]?.output as Record<
          string,
          unknown
        >;
        const eu = instance.state?.nodes?.["analyze-eu"]?.output as Record<
          string,
          unknown
        >;
        const ap = instance.state?.nodes?.["analyze-ap"]?.output as Record<
          string,
          unknown
        >;
        return {
          totalRevenue:
            (us?.totalRevenue as number) +
            (eu?.totalRevenue as number) +
            (ap?.totalRevenue as number),
          regions: [us, eu, ap],
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
    await engine.register(parallelWorkflow);
    const instanceId = await engine.start("parallel-analysis", {});
    const result = await engine.waitForCompletion(instanceId);
    console.log("Final output:", result.state?.nodes?.merge?.output);
  } finally {
    engine.destroy();
    await destroyContainer(container);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
