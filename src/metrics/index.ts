export * from "./MetricsAggregator";

/**
 * 简单的指标收集器
 * 不依赖 prom-client，提供基础的指标收集功能
 * 生产环境可替换为 prom-client 实现
 */

interface MetricValue {
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

interface HistogramBucket {
  le: number;
  count: number;
}

interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: Record<string, string>;
}

class Counter {
  private values = new Map<string, MetricValue>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
  ) {}

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      this.values.set(key, { value, labels, timestamp: Date.now() });
    }
  }

  get(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey(labels);
    return this.values.get(key)?.value || 0;
  }

  getAll(): MetricValue[] {
    return Array.from(this.values.values());
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labelNames
      .map((name) => `${name}=${labels[name] || ""}`)
      .join(",");
  }

  toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} counter`);
    for (const value of this.values.values()) {
      const labelStr = Object.entries(value.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      lines.push(
        `${this.name}${labelStr ? `{${labelStr}}` : ""} ${value.value}`,
      );
    }
    return lines.join("\n");
  }
}

class Gauge {
  private values = new Map<string, MetricValue>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
  ) {}

  set(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey(labels);
    this.values.set(key, { value, labels, timestamp: Date.now() });
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = this.labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
      existing.timestamp = Date.now();
    } else {
      this.values.set(key, { value, labels, timestamp: Date.now() });
    }
  }

  dec(labels: Record<string, string> = {}, value = 1): void {
    this.inc(labels, -value);
  }

  get(labels: Record<string, string> = {}): number {
    const key = this.labelsToKey(labels);
    return this.values.get(key)?.value || 0;
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labelNames
      .map((name) => `${name}=${labels[name] || ""}`)
      .join(",");
  }

  toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} gauge`);
    for (const value of this.values.values()) {
      const labelStr = Object.entries(value.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      lines.push(
        `${this.name}${labelStr ? `{${labelStr}}` : ""} ${value.value}`,
      );
    }
    return lines.join("\n");
  }
}

class Histogram {
  private values = new Map<string, HistogramValue>();
  private readonly buckets: number[];

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
    buckets: number[] = [0.1, 0.5, 1, 5, 10, 30, 60],
  ) {
    this.buckets = [...buckets, Number.POSITIVE_INFINITY].sort((a, b) => a - b);
  }

  observe(labels: Record<string, string>, value: number): void {
    const key = this.labelsToKey(labels);
    let existing = this.values.get(key);

    if (!existing) {
      existing = {
        buckets: this.buckets.map((le) => ({ le, count: 0 })),
        sum: 0,
        count: 0,
        labels,
      };
      this.values.set(key, existing);
    }

    existing.sum += value;
    existing.count++;
    for (const bucket of existing.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  private labelsToKey(labels: Record<string, string>): string {
    return this.labelNames
      .map((name) => `${name}=${labels[name] || ""}`)
      .join(",");
  }

  toPrometheus(): string {
    const lines: string[] = [];
    lines.push(`# HELP ${this.name} ${this.help}`);
    lines.push(`# TYPE ${this.name} histogram`);

    for (const value of this.values.values()) {
      const labelStr = Object.entries(value.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      const labelPrefix = labelStr ? `${labelStr},` : "";

      for (const bucket of value.buckets) {
        const le =
          bucket.le === Number.POSITIVE_INFINITY
            ? "+Inf"
            : bucket.le.toString();
        lines.push(
          `${this.name}_bucket{${labelPrefix}le="${le}"} ${bucket.count}`,
        );
      }
      lines.push(`${this.name}_sum{${labelStr}} ${value.sum}`);
      lines.push(`${this.name}_count{${labelStr}} ${value.count}`);
    }
    return lines.join("\n");
  }
}

// 工作流引擎指标
export const workflowDuration = new Histogram(
  "workflow_duration_seconds",
  "Workflow execution duration in seconds",
  ["workflow_id", "status"],
  [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
);

export const nodeExecutions = new Counter(
  "workflow_node_executions_total",
  "Total number of node executions",
  ["workflow_id", "node_id", "node_type", "status"],
);

export const nodeRetries = new Counter(
  "workflow_node_retries_total",
  "Total number of node retries",
  ["workflow_id", "node_id"],
);

export const nodeDuration = new Histogram(
  "workflow_node_duration_seconds",
  "Node execution duration in seconds",
  ["workflow_id", "node_id", "node_type"],
  [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
);

export const activeInstances = new Gauge(
  "workflow_active_instances",
  "Number of currently active workflow instances",
  ["workflow_id", "status"],
);

export const eventsWaiting = new Gauge(
  "workflow_events_waiting",
  "Number of events currently being waited for",
  ["workflow_id"],
);

export const totalInstances = new Counter(
  "workflow_instances_total",
  "Total number of workflow instances created",
  ["workflow_id", "status"],
);

export const eventProcessed = new Counter(
  "workflow_events_processed_total",
  "Total number of events processed",
  ["event_type", "status"],
);

export const apiRequests = new Counter(
  "workflow_api_requests_total",
  "Total number of API requests",
  ["method", "path", "status"],
);

export const apiLatency = new Histogram(
  "workflow_api_latency_seconds",
  "API request latency in seconds",
  ["method", "path"],
  [0.01, 0.05, 0.1, 0.5, 1, 5],
);

// LLM 指标
export const llmCacheEvents = new Counter(
  "llm_cache_events_total",
  "Total number of LLM cache lookups by result",
  ["provider", "model", "result"],
);

export const llmTokens = new Counter(
  "llm_tokens_total",
  "Total number of LLM tokens consumed",
  ["provider", "model", "type"],
);

export const llmCostUsd = new Counter(
  "llm_cost_usd_total",
  "Total LLM cost in USD",
  ["provider", "model"],
);

// 系统指标
export const memoryUsage = new Gauge(
  "nodejs_memory_usage_bytes",
  "Node.js memory usage",
  ["type"],
);

export const eventLoopLag = new Gauge(
  "nodejs_eventloop_lag_seconds",
  "Node.js event loop lag",
);

export const webhookDeliveryCleanupRuns = new Counter(
  "webhook_delivery_cleanup_runs_total",
  "Total number of webhook delivery cleanup runs",
  ["result", "mode"],
);

export const webhookDeliveryCleanupRemoved = new Counter(
  "webhook_delivery_cleanup_removed_total",
  "Total number of webhook delivery records removed by cleanup",
  ["mode"],
);

export const webhookDeliveryCleanupDuration = new Histogram(
  "webhook_delivery_cleanup_duration_seconds",
  "Webhook delivery cleanup duration in seconds",
  ["result", "mode"],
  [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
);

export const webhookDeliveryCleanupLastRun = new Gauge(
  "webhook_delivery_cleanup_last_run_timestamp_seconds",
  "Unix timestamp of the most recent webhook delivery cleanup run",
  ["result", "mode"],
);

export const webhookDeliveryCleanupLastSuccess = new Gauge(
  "webhook_delivery_cleanup_last_success_timestamp_seconds",
  "Unix timestamp of the most recent successful webhook delivery cleanup run",
  ["mode"],
);

/**
 * 收集系统指标
 */
export function collectSystemMetrics(): void {
  const mem = process.memoryUsage();
  memoryUsage.set({ type: "heapTotal" }, mem.heapTotal);
  memoryUsage.set({ type: "heapUsed" }, mem.heapUsed);
  memoryUsage.set({ type: "rss" }, mem.rss);
  memoryUsage.set({ type: "external" }, mem.external);
}

/**
 * 获取所有指标的 Prometheus 格式输出
 */
export function getMetrics(): string {
  collectSystemMetrics();

  const metrics = [
    workflowDuration,
    nodeExecutions,
    nodeRetries,
    nodeDuration,
    activeInstances,
    eventsWaiting,
    totalInstances,
    eventProcessed,
    apiRequests,
    apiLatency,
    llmCacheEvents,
    llmTokens,
    llmCostUsd,
    memoryUsage,
    eventLoopLag,
    webhookDeliveryCleanupRuns,
    webhookDeliveryCleanupRemoved,
    webhookDeliveryCleanupDuration,
    webhookDeliveryCleanupLastRun,
    webhookDeliveryCleanupLastSuccess,
  ];

  return metrics.map((m) => m.toPrometheus()).join("\n\n");
}

/**
 * 记录工作流开始
 */
export function recordWorkflowStart(
  workflowId: string,
  status = "running",
): void {
  activeInstances.inc({ workflow_id: workflowId, status });
  totalInstances.inc({ workflow_id: workflowId, status: "started" });
}

/**
 * 记录工作流完成
 */
export function recordWorkflowComplete(
  workflowId: string,
  status: "completed" | "failed",
  durationSeconds: number,
): void {
  activeInstances.dec({ workflow_id: workflowId, status: "running" });
  totalInstances.inc({ workflow_id: workflowId, status });
  workflowDuration.observe(
    { workflow_id: workflowId, status },
    durationSeconds,
  );
}

/**
 * 记录节点执行
 */
export function recordNodeExecution(
  workflowId: string,
  nodeId: string,
  nodeType: string,
  status: "success" | "failed",
  durationSeconds?: number,
): void {
  nodeExecutions.inc({
    workflow_id: workflowId,
    node_id: nodeId,
    node_type: nodeType,
    status,
  });

  if (durationSeconds !== undefined) {
    nodeDuration.observe(
      { workflow_id: workflowId, node_id: nodeId, node_type: nodeType },
      durationSeconds,
    );
  }
}

/**
 * 记录节点重试
 */
export function recordNodeRetry(workflowId: string, nodeId: string): void {
  nodeRetries.inc({ workflow_id: workflowId, node_id: nodeId });
}

/**
 * 记录事件等待开始
 */
export function recordEventWaitStart(workflowId: string): void {
  eventsWaiting.inc({ workflow_id: workflowId });
}

/**
 * 记录事件等待结束
 */
export function recordEventWaitEnd(workflowId: string): void {
  eventsWaiting.dec({ workflow_id: workflowId });
}

/**
 * 记录事件处理
 */
export function recordEventProcessed(
  eventType: string,
  status: "success" | "failed",
): void {
  eventProcessed.inc({ event_type: eventType, status });
}

/**
 * 记录 API 请求
 */
export function recordApiRequest(
  method: string,
  path: string,
  status: number,
  durationSeconds: number,
): void {
  apiRequests.inc({ method, path, status: status.toString() });
  apiLatency.observe({ method, path }, durationSeconds);
}

/**
 * 记录 LLM 缓存命中/未命中
 */
export function recordLlmCacheEvent(
  provider: string,
  model: string,
  result: "hit" | "miss",
): void {
  llmCacheEvents.inc({ provider, model, result });
}

/**
 * 记录 LLM token 消耗与成本
 */
export function recordLlmUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
): void {
  if (inputTokens > 0) {
    llmTokens.inc({ provider, model, type: "input" }, inputTokens);
  }
  if (outputTokens > 0) {
    llmTokens.inc({ provider, model, type: "output" }, outputTokens);
  }
  if (costUsd > 0) {
    llmCostUsd.inc({ provider, model }, costUsd);
  }
}

export function recordWebhookDeliveryCleanup(
  result: "success" | "failed" | "skipped",
  mode: "all_nodes" | "leader_only",
  durationSeconds: number,
  removedCount = 0,
): void {
  webhookDeliveryCleanupRuns.inc({ result, mode });
  webhookDeliveryCleanupDuration.observe({ result, mode }, durationSeconds);
  webhookDeliveryCleanupLastRun.set({ result, mode }, Date.now() / 1000);

  if (removedCount > 0) {
    webhookDeliveryCleanupRemoved.inc({ mode }, removedCount);
  }

  if (result === "success") {
    webhookDeliveryCleanupLastSuccess.set({ mode }, Date.now() / 1000);
  }
}
