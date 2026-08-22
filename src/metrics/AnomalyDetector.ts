import type { NodeExecutionEvent } from "./AnalyticsCollector";

/**
 * Anomaly types
 */
export type AnomalyType =
  | "latency_spike"
  | "error_burst"
  | "cost_anomaly"
  | "throughput_drop";

/**
 * Anomaly severity levels
 */
export type AnomalySeverity = "info" | "warning" | "critical";

/**
 * Detected anomaly
 */
export interface Anomaly {
  type: AnomalyType;
  severity: AnomalySeverity;
  nodeId: string;
  workflowId: string;
  detectedAt: number;
  description: string;
  suggestedAction: string;
  metrics: Record<string, number>;
}

/**
 * Z-score based anomaly detector for workflow execution metrics.
 * Detects latency spikes, error bursts, cost anomalies, and throughput drops.
 */
export class AnomalyDetector {
  private readonly zScoreThreshold: number;

  constructor(zScoreThreshold = 2.5) {
    this.zScoreThreshold = zScoreThreshold;
  }

  /**
   * Detect latency anomalies using Z-score
   */
  detectLatencyAnomalies(events: NodeExecutionEvent[]): Anomaly[] {
    const anomalies: Anomaly[] = [];
    const durations = events
      .filter((e) => e.duration !== undefined && e.status !== "started")
      .map((e) => ({
        nodeId: e.nodeId,
        workflowId: e.workflowId,
        duration: e.duration!,
        timestamp: e.startTime,
      }));

    if (durations.length < 10) return anomalies; // Need enough data

    // Calculate mean and stddev
    const mean =
      durations.reduce((sum, d) => sum + d.duration, 0) / durations.length;
    const variance =
      durations.reduce((sum, d) => sum + (d.duration - mean) ** 2, 0) /
      durations.length;
    const stddev = Math.sqrt(variance);

    // Check each duration
    for (const d of durations) {
      const zScore = stddev > 0 ? (d.duration - mean) / stddev : 0;

      if (Math.abs(zScore) > this.zScoreThreshold) {
        const severity: AnomalySeverity =
          Math.abs(zScore) > 3.5 ? "critical" : "warning";

        anomalies.push({
          type: "latency_spike",
          severity,
          nodeId: d.nodeId,
          workflowId: d.workflowId,
          detectedAt: d.timestamp,
          description: `Latency spike detected: ${d.duration.toFixed(0)}ms (mean: ${mean.toFixed(0)}ms, z-score: ${zScore.toFixed(2)})`,
          suggestedAction:
            "Check for resource contention, slow dependencies, or increased load",
          metrics: {
            duration: d.duration,
            mean,
            stddev,
            zScore,
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect error bursts
   */
  detectErrorBursts(events: NodeExecutionEvent[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Group events by node
    const nodeEvents = new Map<string, NodeExecutionEvent[]>();
    for (const event of events) {
      if (!nodeEvents.has(event.nodeId)) {
        nodeEvents.set(event.nodeId, []);
      }
      nodeEvents.get(event.nodeId)!.push(event);
    }

    // Check each node for error bursts
    for (const [nodeId, nodeEvts] of nodeEvents) {
      if (nodeEvts.length < 5) continue; // Need enough data

      const errorCount = nodeEvts.filter((e) => e.status === "failed").length;
      const errorRate = errorCount / nodeEvts.length;

      // Check if error rate is significantly high
      if (errorRate > 0.5) {
        // More than 50% errors
        const severity: AnomalySeverity =
          errorRate > 0.8 ? "critical" : "warning";

        anomalies.push({
          type: "error_burst",
          severity,
          nodeId,
          workflowId: nodeEvts[0].workflowId,
          detectedAt: Date.now(),
          description: `Error burst detected: ${(errorRate * 100).toFixed(1)}% error rate (${errorCount}/${nodeEvts.length})`,
          suggestedAction:
            "Check for configuration errors, dependency failures, or invalid inputs",
          metrics: {
            errorRate,
            errorCount,
            totalEvents: nodeEvts.length,
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect cost anomalies (sudden increase in AI costs)
   */
  detectCostAnomalies(events: NodeExecutionEvent[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    // Filter AI events with cost data
    const aiEvents = events.filter(
      (e) => e.aiMetrics?.costUsd !== undefined && e.aiMetrics.costUsd > 0,
    );

    if (aiEvents.length < 10) return anomalies;

    // Calculate cost statistics
    const costs = aiEvents.map((e) => e.aiMetrics!.costUsd!);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const variance =
      costs.reduce((sum, c) => sum + (c - mean) ** 2, 0) / costs.length;
    const stddev = Math.sqrt(variance);

    // Check for cost spikes
    for (const event of aiEvents) {
      const cost = event.aiMetrics!.costUsd!;
      const zScore = stddev > 0 ? (cost - mean) / stddev : 0;

      if (zScore > this.zScoreThreshold) {
        const severity: AnomalySeverity = zScore > 3.5 ? "critical" : "warning";

        anomalies.push({
          type: "cost_anomaly",
          severity,
          nodeId: event.nodeId,
          workflowId: event.workflowId,
          detectedAt: event.startTime,
          description: `Cost anomaly detected: $${cost.toFixed(4)} (mean: $${mean.toFixed(4)}, z-score: ${zScore.toFixed(2)})`,
          suggestedAction:
            "Check for unusually large prompts, model changes, or excessive retries",
          metrics: {
            cost,
            mean,
            stddev,
            zScore,
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Detect all anomaly types
   */
  detectAll(events: NodeExecutionEvent[]): Anomaly[] {
    return [
      ...this.detectLatencyAnomalies(events),
      ...this.detectErrorBursts(events),
      ...this.detectCostAnomalies(events),
    ].sort((a, b) => b.detectedAt - a.detectedAt);
  }
}
