import { beforeEach, describe, expect, it } from "vitest";
import type { NodeExecutionEvent } from "../AnalyticsCollector";
import { AnalyticsCollector } from "../AnalyticsCollector";

describe("AnalyticsCollector", () => {
  let collector: AnalyticsCollector;

  beforeEach(() => {
    collector = new AnalyticsCollector();
  });

  const createEvent = (
    overrides: Partial<NodeExecutionEvent> = {},
  ): NodeExecutionEvent => ({
    instanceId: "instance-1",
    workflowId: "workflow-1",
    nodeId: "node-1",
    nodeType: "action",
    startTime: Date.now(),
    endTime: Date.now() + 1000,
    duration: 1000,
    status: "completed",
    ...overrides,
  });

  describe("onNodeExecution", () => {
    it("should record events", () => {
      collector.onNodeExecution(createEvent());
      collector.onNodeExecution(createEvent());

      expect(collector.getEventCount()).toBe(2);
    });

    it("should evict old events when max size exceeded", () => {
      const smallCollector = new AnalyticsCollector(3);

      for (let i = 0; i < 5; i++) {
        smallCollector.onNodeExecution(
          createEvent({ instanceId: `instance-${i}` }),
        );
      }

      expect(smallCollector.getEventCount()).toBe(3);
    });
  });

  describe("aggregate", () => {
    it("should aggregate analytics for a workflow", async () => {
      // Add some events
      for (let i = 0; i < 10; i++) {
        collector.onNodeExecution(
          createEvent({
            workflowId: "workflow-1",
            duration: 100 + i * 10,
            status: i < 8 ? "completed" : "failed",
          }),
        );
      }

      const analytics = await collector.aggregate("workflow-1");

      expect(analytics.workflowId).toBe("workflow-1");
      expect(analytics.avgDurationMs).toBeGreaterThan(0);
      expect(analytics.successRate).toBeCloseTo(0.8);
      expect(analytics.failureRate).toBeCloseTo(0.2);
    });

    it("should return empty analytics for no data", async () => {
      const analytics = await collector.aggregate("non-existent");

      expect(analytics.avgDurationMs).toBe(0);
      expect(analytics.successRate).toBe(0);
    });
  });

  describe("aggregateByNode", () => {
    it("should aggregate analytics for a specific node", async () => {
      collector.onNodeExecution(
        createEvent({ nodeId: "node-1", duration: 100 }),
      );
      collector.onNodeExecution(
        createEvent({ nodeId: "node-1", duration: 200 }),
      );
      collector.onNodeExecution(
        createEvent({ nodeId: "node-2", duration: 300 }),
      );

      const analytics = await collector.aggregateByNode("workflow-1", "node-1");

      expect(analytics.nodeId).toBe("node-1");
      expect(analytics.avgDurationMs).toBe(150);
    });
  });

  describe("clear", () => {
    it("should clear all events", () => {
      collector.onNodeExecution(createEvent());
      collector.onNodeExecution(createEvent());

      collector.clear();

      expect(collector.getEventCount()).toBe(0);
    });
  });
});
