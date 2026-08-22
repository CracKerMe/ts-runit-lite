import { Logger } from "../utils/Logger";

/**
 * Node execution event for analytics
 */
export interface NodeExecutionEvent {
  instanceId: string;
  workflowId: string;
  nodeId: string;
  nodeType: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "started" | "completed" | "failed";
  error?: string;
  aiMetrics?: {
    model?: string;
    provider?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
    latencyMs?: number;
  };
}

/**
 * Hourly trend data point
 */
export interface HourlyTrend {
  hour: number;
  count: number;
  avgDuration: number;
  errorRate: number;
}

/**
 * Execution analytics for a workflow or node
 */
export interface ExecutionAnalytics {
  workflowId: string;
  nodeId?: string;
  // Performance
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  // Success rates
  successRate: number;
  failureRate: number;
  retryRate: number;
  // Concurrency
  avgConcurrency: number;
  maxConcurrency: number;
  conflictRate: number;
  // AI metrics
  avgAiCostUsd: number;
  avgAiLatencyMs: number;
  avgTokenUsage: number;
  // Time series
  hourlyTrend: HourlyTrend[];
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * AnalyticsCollector captures and aggregates workflow execution metrics
 * for analysis and dashboard display.
 */
export class AnalyticsCollector {
  private events: NodeExecutionEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 10000) {
    this.maxEvents = maxEvents;
  }

  /**
   * Record a node execution event
   */
  onNodeExecution(event: NodeExecutionEvent): void {
    this.events.push(event);

    // Evict old events if we exceed max size
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    Logger.debug("system", "analytics", "Node execution recorded", {
      workflowId: event.workflowId,
      nodeId: event.nodeId,
      status: event.status,
    });
  }

  /**
   * Aggregate analytics for a specific workflow
   */
  async aggregate(
    workflowId: string,
    windowMs?: number,
  ): Promise<ExecutionAnalytics> {
    const now = Date.now();
    const startTime = windowMs ? now - windowMs : 0;

    const workflowEvents = this.events.filter(
      (e) =>
        e.workflowId === workflowId &&
        e.startTime >= startTime &&
        e.status !== "started",
    );

    return this.calculateAnalytics(workflowId, workflowEvents);
  }

  /**
   * Aggregate analytics for a specific node
   */
  async aggregateByNode(
    workflowId: string,
    nodeId: string,
    windowMs?: number,
  ): Promise<ExecutionAnalytics> {
    const now = Date.now();
    const startTime = windowMs ? now - windowMs : 0;

    const nodeEvents = this.events.filter(
      (e) =>
        e.workflowId === workflowId &&
        e.nodeId === nodeId &&
        e.startTime >= startTime &&
        e.status !== "started",
    );

    return this.calculateAnalytics(workflowId, nodeEvents, nodeId);
  }

  /**
   * Calculate analytics from events
   */
  private calculateAnalytics(
    workflowId: string,
    events: NodeExecutionEvent[],
    nodeId?: string,
  ): ExecutionAnalytics {
    if (events.length === 0) {
      return this.emptyAnalytics(workflowId, nodeId);
    }

    // Performance metrics
    const durations = events
      .filter((e) => e.duration !== undefined)
      .map((e) => e.duration!)
      .sort((a, b) => a - b);

    const avgDurationMs =
      durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;

    // Success/failure rates
    const completed = events.filter((e) => e.status === "completed").length;
    const failed = events.filter((e) => e.status === "failed").length;
    const total = events.length;

    // AI metrics
    const aiEvents = events.filter((e) => e.aiMetrics);
    const avgAiCostUsd =
      aiEvents.length > 0
        ? aiEvents.reduce((sum, e) => sum + (e.aiMetrics?.costUsd || 0), 0) /
          aiEvents.length
        : 0;
    const avgAiLatencyMs =
      aiEvents.length > 0
        ? aiEvents.reduce((sum, e) => sum + (e.aiMetrics?.latencyMs || 0), 0) /
          aiEvents.length
        : 0;
    const avgTokenUsage =
      aiEvents.length > 0
        ? aiEvents.reduce(
            (sum, e) => sum + (e.aiMetrics?.totalTokens || 0),
            0,
          ) / aiEvents.length
        : 0;

    // Hourly trends
    const hourlyTrend = this.calculateHourlyTrend(events);

    return {
      workflowId,
      nodeId,
      avgDurationMs,
      p50DurationMs: percentile(durations, 50),
      p95DurationMs: percentile(durations, 95),
      p99DurationMs: percentile(durations, 99),
      successRate: total > 0 ? completed / total : 0,
      failureRate: total > 0 ? failed / total : 0,
      retryRate: 0, // Would need retry tracking
      avgConcurrency: 0, // Would need concurrency tracking
      maxConcurrency: 0,
      conflictRate: 0,
      avgAiCostUsd,
      avgAiLatencyMs,
      avgTokenUsage,
      hourlyTrend,
    };
  }

  /**
   * Calculate hourly trend data
   */
  private calculateHourlyTrend(events: NodeExecutionEvent[]): HourlyTrend[] {
    const hourlyData = new Map<
      number,
      { count: number; totalDuration: number; errors: number }
    >();

    for (const event of events) {
      const hour = Math.floor(event.startTime / (60 * 60 * 1000));

      if (!hourlyData.has(hour)) {
        hourlyData.set(hour, { count: 0, totalDuration: 0, errors: 0 });
      }

      const data = hourlyData.get(hour)!;
      data.count++;
      if (event.duration) {
        data.totalDuration += event.duration;
      }
      if (event.status === "failed") {
        data.errors++;
      }
    }

    return Array.from(hourlyData.entries())
      .sort(([a], [b]) => a - b)
      .map(([hour, data]) => ({
        hour,
        count: data.count,
        avgDuration: data.count > 0 ? data.totalDuration / data.count : 0,
        errorRate: data.count > 0 ? data.errors / data.count : 0,
      }));
  }

  /**
   * Return empty analytics
   */
  private emptyAnalytics(
    workflowId: string,
    nodeId?: string,
  ): ExecutionAnalytics {
    return {
      workflowId,
      nodeId,
      avgDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      successRate: 0,
      failureRate: 0,
      retryRate: 0,
      avgConcurrency: 0,
      maxConcurrency: 0,
      conflictRate: 0,
      avgAiCostUsd: 0,
      avgAiLatencyMs: 0,
      avgTokenUsage: 0,
      hourlyTrend: [],
    };
  }

  /**
   * Clear all stored events (for testing)
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.length;
  }
}
