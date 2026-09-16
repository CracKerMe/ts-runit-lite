import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { MetricsAggregator } from "../../metrics/MetricsAggregator";

/** Build a MemoryStorage seeded with instances + node metrics */
async function buildStorage(
  entries: Array<{
    instanceId: string;
    workflowId: string;
    nodeMetrics: Array<{
      nodeId: string;
      nodeType: string;
      status: "completed" | "failed" | "running";
      duration?: number;
      retryCount?: number;
    }>;
  }>,
): Promise<MemoryStorage> {
  const storage = new MemoryStorage();
  await storage.connect();

  for (const entry of entries) {
    // Save instance so loadInstanceMetrics can find workflowId
    await storage.saveInstance({
      instanceId: entry.instanceId,
      workflowId: entry.workflowId,
      currentNodes: [],
      status: "completed",
      context: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      retries: {},
      state: { nodes: {} },
    });

    for (const nm of entry.nodeMetrics) {
      await storage.updateNodeMetrics(entry.instanceId, nm.nodeId, {
        nodeId: nm.nodeId,
        nodeType: nm.nodeType,
        startTime: Date.now(),
        endTime: Date.now() + (nm.duration ?? 0),
        duration: nm.duration,
        status: nm.status,
        retryCount: nm.retryCount ?? 0,
        retryTimestamps: [],
      });
    }
  }

  return storage;
}

describe("MetricsAggregator", () => {
  describe("aggregate – groupBy nodeType", () => {
    it("should group metrics by node type", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-1",
          workflowId: "wf-1",
          nodeMetrics: [
            {
              nodeId: "n1",
              nodeType: "action",
              status: "completed",
              duration: 100,
            },
            { nodeId: "n2", nodeType: "http", status: "failed", duration: 200 },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeType" });
      const types = results.map((r) => r.dimension);
      expect(types).toContain("action");
      expect(types).toContain("http");
    });

    it("should compute successCount and failureCount correctly", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-2",
          workflowId: "wf-1",
          nodeMetrics: [
            {
              nodeId: "n1",
              nodeType: "action",
              status: "completed",
              duration: 50,
            },
            {
              nodeId: "n2",
              nodeType: "action",
              status: "completed",
              duration: 80,
            },
            {
              nodeId: "n3",
              nodeType: "action",
              status: "failed",
              duration: 30,
            },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeType" });
      const action = results.find((r) => r.dimension === "action")!;
      expect(action.successCount).toBe(2);
      expect(action.failureCount).toBe(1);
      expect(action.count).toBe(3);
    });

    it("should compute avgDuration, minDuration, maxDuration", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-3",
          workflowId: "wf-1",
          nodeMetrics: [
            {
              nodeId: "n1",
              nodeType: "sql",
              status: "completed",
              duration: 100,
            },
            {
              nodeId: "n2",
              nodeType: "sql",
              status: "completed",
              duration: 300,
            },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeType" });
      const sql = results.find((r) => r.dimension === "sql")!;
      expect(sql.avgDuration).toBe(200);
      expect(sql.minDuration).toBe(100);
      expect(sql.maxDuration).toBe(300);
    });

    it("should compute successRate as percentage", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-4",
          workflowId: "wf-1",
          nodeMetrics: [
            { nodeId: "n1", nodeType: "action", status: "completed" },
            { nodeId: "n2", nodeType: "action", status: "failed" },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeType" });
      const action = results.find((r) => r.dimension === "action")!;
      expect(action.successRate).toBe(50);
    });

    it("should aggregate totalRetries", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-5",
          workflowId: "wf-retry",
          nodeMetrics: [
            {
              nodeId: "n1",
              nodeType: "action",
              status: "completed",
              retryCount: 2,
            },
            {
              nodeId: "n2",
              nodeType: "action",
              status: "completed",
              retryCount: 1,
            },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeType" });
      const action = results.find((r) => r.dimension === "action")!;
      expect(action.totalRetries).toBe(3);
    });
  });

  describe("aggregate – groupBy workflow", () => {
    it("should group metrics by workflow", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-wf-1",
          workflowId: "wf-alpha",
          nodeMetrics: [
            { nodeId: "n1", nodeType: "action", status: "completed" },
          ],
        },
        {
          instanceId: "inst-wf-2",
          workflowId: "wf-beta",
          nodeMetrics: [{ nodeId: "n2", nodeType: "action", status: "failed" }],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "workflow" });
      const dims = results.map((r) => r.dimension);
      expect(dims).toContain("wf-alpha");
      expect(dims).toContain("wf-beta");
    });

    it("should filter by workflowId", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-filter-1",
          workflowId: "wf-filter",
          nodeMetrics: [
            { nodeId: "n1", nodeType: "action", status: "completed" },
          ],
        },
        {
          instanceId: "inst-filter-2",
          workflowId: "wf-other",
          nodeMetrics: [{ nodeId: "n2", nodeType: "action", status: "failed" }],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({
        groupBy: "workflow",
        workflowId: "wf-filter",
      });
      expect(results).toHaveLength(1);
      expect(results[0].dimension).toBe("wf-filter");
    });
  });

  describe("aggregate – groupBy nodeId", () => {
    it("should group metrics by node ID", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-nid",
          workflowId: "wf-1",
          nodeMetrics: [
            { nodeId: "validate", nodeType: "action", status: "completed" },
            { nodeId: "notify", nodeType: "action", status: "completed" },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({ groupBy: "nodeId" });
      const nodeIds = results.map((r) => r.dimension);
      expect(nodeIds).toContain("validate");
      expect(nodeIds).toContain("notify");
    });
  });

  describe("aggregate – filters", () => {
    it("should filter by nodeType", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-nt",
          workflowId: "wf-nt",
          nodeMetrics: [
            { nodeId: "n1", nodeType: "http", status: "completed" },
            { nodeId: "n2", nodeType: "sql", status: "completed" },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const results = await aggregator.aggregate({
        groupBy: "nodeType",
        nodeType: "http",
      });
      expect(results).toHaveLength(1);
      expect(results[0].dimension).toBe("http");
    });
  });

  describe("getWorkflowSummary", () => {
    it("should return aggregated summary for a specific workflow", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-summary",
          workflowId: "wf-summary",
          nodeMetrics: [
            { nodeId: "n1", nodeType: "action", status: "completed" },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const summary = await aggregator.getWorkflowSummary("wf-summary");
      expect(summary).not.toBeNull();
      expect(summary!.count).toBeGreaterThanOrEqual(1);
    });

    it("should return null for a workflow with no metrics", async () => {
      const storage = new MemoryStorage();
      await storage.connect();
      const aggregator = new MetricsAggregator(storage);
      const summary = await aggregator.getWorkflowSummary("nonexistent-wf");
      expect(summary).toBeNull();
    });
  });

  describe("getNodeSummary", () => {
    it("should return aggregated summary for a specific node", async () => {
      const storage = await buildStorage([
        {
          instanceId: "inst-node-sum",
          workflowId: "wf-ns",
          nodeMetrics: [
            {
              nodeId: "validate-order",
              nodeType: "action",
              status: "completed",
            },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const summary = await aggregator.getNodeSummary("validate-order");
      expect(summary).not.toBeNull();
      expect(summary!.dimension).toBe("validate-order");
    });

    it("should return null when node has no metrics", async () => {
      const storage = new MemoryStorage();
      await storage.connect();
      const aggregator = new MetricsAggregator(storage);
      expect(await aggregator.getNodeSummary("ghost-node")).toBeNull();
    });
  });

  describe("aggregateByTimePeriod", () => {
    it("should return time series data points for the given range", async () => {
      // Use a fixed startTime aligned to an hour boundary to avoid flakiness
      const hourMs = 60 * 60 * 1000;
      const now = Date.now();
      // Align startTime to the *current* hour boundary so the node's bucket
      // (which is also floor(now/h)*h) is guaranteed to be initialized
      const startTime = Math.floor(now / hourMs) * hourMs - 2 * hourMs; // 2h ago, aligned
      const endTime = startTime + 4 * hourMs; // covers current hour

      const storage = await buildStorage([
        {
          instanceId: "inst-ts",
          workflowId: "wf-ts",
          nodeMetrics: [
            {
              nodeId: "n1",
              nodeType: "action",
              status: "completed",
              duration: 100,
            },
          ],
        },
      ]);
      const aggregator = new MetricsAggregator(storage);
      const series = await aggregator.aggregateByTimePeriod({
        startTime,
        endTime,
        bucketSize: "hour",
        workflowId: "wf-ts",
      });
      // At least 1 bucket should exist (the range spans 4 hours)
      expect(series.length).toBeGreaterThanOrEqual(1);
      // The node's metric falls in the current-hour bucket – at least one bucket
      // anywhere in the series should have count >= 1
      const totalCount = series.reduce((sum, p) => sum + p.count, 0);
      expect(totalCount).toBeGreaterThanOrEqual(1);
    });

    it("should return empty array when no instances in range", async () => {
      const storage = new MemoryStorage();
      await storage.connect();
      const aggregator = new MetricsAggregator(storage);
      const series = await aggregator.aggregateByTimePeriod({
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        bucketSize: "day",
      });
      expect(series.every((p) => p.count === 0)).toBe(true);
    });
  });
});
