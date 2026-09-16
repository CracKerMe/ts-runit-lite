import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { MetricsAggregator } from "../../metrics/MetricsAggregator";

/**
 * 回归测试：聚合必须覆盖全部匹配实例，而不是默认分页的第一页。
 *
 * 此前 `aggregate()` / `aggregateByTimePeriod()` 调用 `queryInstances()` 时
 * 不传分页参数，被 `pageSize` 默认值 50 静默截断——超过 50 条实例时，
 * 返回的指标数字是错的，且没有任何报错或警告。
 */

const INSTANCE_COUNT = 137; // 刻意远大于默认 pageSize=50
const NODE_DURATION = 10;

async function seedStorage(count: number): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await storage.connect();

  const baseTime = 1_700_000_000_000;

  for (let i = 0; i < count; i++) {
    const instanceId = `inst-${String(i).padStart(4, "0")}`;
    await storage.saveInstance({
      instanceId,
      workflowId: "wf-1",
      currentNodes: [],
      status: "completed",
      context: {},
      history: [],
      createdAt: new Date(baseTime + i * 1000),
      updatedAt: new Date(baseTime + i * 1000),
      retries: {},
      state: { nodes: {} },
    });

    await storage.updateNodeMetrics(instanceId, "node-a", {
      nodeId: "node-a",
      nodeType: "action",
      startTime: baseTime + i * 1000,
      endTime: baseTime + i * 1000 + NODE_DURATION,
      duration: NODE_DURATION,
      status: "completed",
      retryCount: 0,
      retryTimestamps: [],
    });
  }

  return storage;
}

describe("MetricsAggregator — full instance scan", () => {
  it("aggregates across every instance, not just the default first page", async () => {
    const storage = await seedStorage(INSTANCE_COUNT);
    const aggregator = new MetricsAggregator(storage);

    const results = await aggregator.aggregate({ groupBy: "nodeType" });

    expect(results).toHaveLength(1);
    const actionMetrics = results[0]!;
    expect(actionMetrics.dimension).toBe("action");
    // 修复前这里会是 50
    expect(actionMetrics.count).toBe(INSTANCE_COUNT);
    expect(actionMetrics.successCount).toBe(INSTANCE_COUNT);
    expect(actionMetrics.totalDuration).toBe(INSTANCE_COUNT * NODE_DURATION);
  });

  it("groups by nodeId across the full set", async () => {
    const storage = await seedStorage(INSTANCE_COUNT);
    const aggregator = new MetricsAggregator(storage);

    const results = await aggregator.aggregate({ groupBy: "nodeId" });

    const nodeA = results.find((r) => r.dimension === "node-a");
    expect(nodeA).toBeDefined();
    expect(nodeA!.count).toBe(INSTANCE_COUNT);
  });

  it("counts every instance in a time series bucket", async () => {
    const storage = await seedStorage(INSTANCE_COUNT);
    const aggregator = new MetricsAggregator(storage);

    const baseTime = 1_700_000_000_000;
    const series = await aggregator.aggregateByTimePeriod({
      workflowId: "wf-1",
      // 一个足够宽的窗口，把所有实例装进同一天
      startTime: baseTime - 86_400_000,
      endTime: baseTime + 86_400_000,
      bucketSize: "day",
    });

    const totalCounted = series.reduce((sum, point) => sum + point.count, 0);
    // 修复前这里会是 50
    expect(totalCounted).toBe(INSTANCE_COUNT);
  });

  it("still works when the instance count is below one page", async () => {
    const storage = await seedStorage(7);
    const aggregator = new MetricsAggregator(storage);

    const results = await aggregator.aggregate({ groupBy: "nodeType" });

    expect(results[0]!.count).toBe(7);
  });

  it("returns an empty result set for no instances", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    const aggregator = new MetricsAggregator(storage);

    const results = await aggregator.aggregate({ groupBy: "nodeType" });

    expect(results).toEqual([]);
  });
});
