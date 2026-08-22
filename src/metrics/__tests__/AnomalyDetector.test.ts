import { beforeEach, describe, expect, it } from "vitest";
import type { NodeExecutionEvent } from "../AnalyticsCollector";
import { AnomalyDetector } from "../AnomalyDetector";

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    detector = new AnomalyDetector(2.5); // Z-score threshold
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

  describe("detectLatencyAnomalies", () => {
    it("should detect latency spikes", () => {
      // Create normal events
      const events: NodeExecutionEvent[] = [];
      for (let i = 0; i < 20; i++) {
        events.push(createEvent({ duration: 100 + Math.random() * 10 }));
      }

      // Add a spike
      events.push(createEvent({ duration: 1000 }));

      const anomalies = detector.detectLatencyAnomalies(events);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe("latency_spike");
    });

    it("should not flag normal variations", () => {
      const events: NodeExecutionEvent[] = [];
      for (let i = 0; i < 20; i++) {
        events.push(createEvent({ duration: 100 + Math.random() * 5 }));
      }

      const anomalies = detector.detectLatencyAnomalies(events);

      expect(anomalies.length).toBe(0);
    });
  });

  describe("detectErrorBursts", () => {
    it("should detect error bursts", () => {
      const events: NodeExecutionEvent[] = [];

      // Create events with high error rate
      for (let i = 0; i < 10; i++) {
        events.push(
          createEvent({
            nodeId: "failing-node",
            status: i < 8 ? "failed" : "completed",
          }),
        );
      }

      const anomalies = detector.detectErrorBursts(events);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe("error_burst");
    });

    it("should not flag normal error rates", () => {
      const events: NodeExecutionEvent[] = [];

      for (let i = 0; i < 20; i++) {
        events.push(
          createEvent({
            status: i < 2 ? "failed" : "completed", // 10% error rate
          }),
        );
      }

      const anomalies = detector.detectErrorBursts(events);

      expect(anomalies.length).toBe(0);
    });
  });

  describe("detectCostAnomalies", () => {
    it("should detect cost spikes", () => {
      const events: NodeExecutionEvent[] = [];

      // Normal costs
      for (let i = 0; i < 20; i++) {
        events.push(
          createEvent({
            aiMetrics: { costUsd: 0.01 + Math.random() * 0.005 },
          }),
        );
      }

      // Add a cost spike
      events.push(
        createEvent({
          aiMetrics: { costUsd: 0.5 },
        }),
      );

      const anomalies = detector.detectCostAnomalies(events);

      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies[0].type).toBe("cost_anomaly");
    });
  });

  describe("detectAll", () => {
    it("should detect all anomaly types", () => {
      const events: NodeExecutionEvent[] = [];

      // Add latency spike
      for (let i = 0; i < 30; i++) {
        events.push(createEvent({ duration: 100 + Math.random() * 10 }));
      }
      events.push(createEvent({ duration: 1000 }));

      // Add error burst
      for (let i = 0; i < 10; i++) {
        events.push(
          createEvent({
            nodeId: "error-node",
            status: i < 9 ? "failed" : "completed",
          }),
        );
      }

      const anomalies = detector.detectAll(events);

      expect(anomalies.length).toBeGreaterThan(0);
    });
  });
});
