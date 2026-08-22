import type { NodeMetrics, StorageProvider } from "../storage/StorageProvider";
import { errorStack, Logger } from "../utils/Logger";

/**
 * Aggregated metrics for a specific dimension (node type, workflow, etc.)
 */
export interface AggregatedMetrics {
  dimension: string; // The dimension value (e.g., node type, workflow ID)
  count: number; // Total number of executions
  successCount: number; // Number of successful executions
  failureCount: number; // Number of failed executions
  totalDuration: number; // Total duration in milliseconds
  avgDuration: number; // Average duration in milliseconds
  minDuration: number; // Minimum duration in milliseconds
  maxDuration: number; // Maximum duration in milliseconds
  successRate: number; // Success rate as percentage (0-100)
  totalRetries: number; // Total number of retries
}

/**
 * Query parameters for metrics aggregation
 */
export interface MetricsAggregationQuery {
  groupBy: "nodeType" | "workflow" | "nodeId"; // Dimension to group by
  startTime?: number; // Unix timestamp - filter metrics after this time
  endTime?: number; // Unix timestamp - filter metrics before this time
  workflowId?: string; // Filter by specific workflow
  nodeType?: string; // Filter by specific node type
}

/**
 * Time period aggregation query
 */
export interface TimePeriodQuery {
  workflowId?: string;
  nodeId?: string;
  startTime: number;
  endTime: number;
  bucketSize: "hour" | "day" | "week"; // Time bucket size
}

/**
 * Time series data point
 */
export interface TimeSeriesDataPoint {
  timestamp: number; // Bucket start timestamp
  count: number;
  avgDuration: number;
  successRate: number;
}

/**
 * MetricsAggregator provides functionality to aggregate and analyze
 * workflow execution metrics across different dimensions
 */
export class MetricsAggregator {
  constructor(private storage: StorageProvider) {}

  /**
   * Aggregate metrics by specified dimension
   */
  async aggregate(
    query: MetricsAggregationQuery,
  ): Promise<AggregatedMetrics[]> {
    try {
      // Get all instances to aggregate their metrics
      const instancesResult = await this.storage.queryInstances({
        workflowId: query.workflowId,
        startTime: query.startTime,
        endTime: query.endTime,
      });

      const aggregationMap = new Map<
        string,
        {
          executions: NodeMetrics[];
          workflowId?: string;
        }
      >();

      // Collect metrics from all instances
      for (const instance of instancesResult.instances) {
        const metrics = await this.storage.loadInstanceMetrics(
          instance.instanceId,
        );
        if (!metrics) continue;

        for (const [nodeId, nodeMetrics] of Object.entries(
          metrics.nodeMetrics,
        )) {
          // Apply filters
          if (query.nodeType && nodeMetrics.nodeType !== query.nodeType) {
            continue;
          }

          if (
            query.startTime &&
            nodeMetrics.startTime &&
            nodeMetrics.startTime < query.startTime
          ) {
            continue;
          }

          if (
            query.endTime &&
            nodeMetrics.endTime &&
            nodeMetrics.endTime > query.endTime
          ) {
            continue;
          }

          // Determine dimension key
          let dimensionKey: string;
          switch (query.groupBy) {
            case "nodeType":
              dimensionKey = nodeMetrics.nodeType || "unknown";
              break;
            case "workflow":
              dimensionKey = metrics.workflowId;
              break;
            case "nodeId":
              dimensionKey = nodeId;
              break;
            default:
              dimensionKey = "all";
          }

          if (!aggregationMap.has(dimensionKey)) {
            aggregationMap.set(dimensionKey, {
              executions: [],
              workflowId: metrics.workflowId,
            });
          }

          aggregationMap.get(dimensionKey)!.executions.push(nodeMetrics);
        }
      }

      // Calculate aggregated statistics
      const results: AggregatedMetrics[] = [];

      for (const [dimension, data] of aggregationMap) {
        const executions = data.executions;
        if (executions.length === 0) continue;

        let successCount = 0;
        let failureCount = 0;
        let totalDuration = 0;
        let minDuration = Number.POSITIVE_INFINITY;
        let maxDuration = 0;
        let totalRetries = 0;
        let validDurations = 0;

        for (const exec of executions) {
          // Count successes and failures
          if (exec.status === "completed") {
            successCount++;
          } else if (exec.status === "failed") {
            failureCount++;
          }

          // Aggregate durations
          if (exec.duration !== undefined && exec.duration !== null) {
            totalDuration += exec.duration;
            minDuration = Math.min(minDuration, exec.duration);
            maxDuration = Math.max(maxDuration, exec.duration);
            validDurations++;
          }

          // Count retries
          totalRetries += exec.retryCount || 0;
        }

        const count = executions.length;
        const avgDuration =
          validDurations > 0 ? totalDuration / validDurations : 0;
        const successRate = count > 0 ? (successCount / count) * 100 : 0;

        results.push({
          dimension,
          count,
          successCount,
          failureCount,
          totalDuration,
          avgDuration,
          minDuration:
            minDuration === Number.POSITIVE_INFINITY ? 0 : minDuration,
          maxDuration,
          successRate,
          totalRetries,
        });
      }

      // Sort by count descending
      results.sort((a, b) => b.count - a.count);

      Logger.debug(
        "system",
        "metrics",
        `Aggregated metrics by ${query.groupBy}: ${results.length} groups`,
      );

      return results;
    } catch (error: unknown) {
      Logger.error(
        "system",
        "metrics",
        "Failed to aggregate metrics",
        errorStack(error),
      );
      throw error;
    }
  }

  /**
   * Aggregate metrics over time periods (time series)
   */
  async aggregateByTimePeriod(
    query: TimePeriodQuery,
  ): Promise<TimeSeriesDataPoint[]> {
    try {
      // Calculate bucket size in milliseconds
      const bucketSizeMs = this.getBucketSizeMs(query.bucketSize);

      // Get all instances in the time range
      const instancesResult = await this.storage.queryInstances({
        workflowId: query.workflowId,
        startTime: query.startTime,
        endTime: query.endTime,
      });

      // Create time buckets
      const buckets = new Map<
        number,
        {
          count: number;
          totalDuration: number;
          successCount: number;
          validDurations: number;
        }
      >();

      // Initialize buckets
      for (let ts = query.startTime; ts < query.endTime; ts += bucketSizeMs) {
        const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
        buckets.set(bucketStart, {
          count: 0,
          totalDuration: 0,
          successCount: 0,
          validDurations: 0,
        });
      }

      // Collect metrics from all instances
      for (const instance of instancesResult.instances) {
        const metrics = await this.storage.loadInstanceMetrics(
          instance.instanceId,
        );
        if (!metrics) continue;

        for (const [nodeId, nodeMetrics] of Object.entries(
          metrics.nodeMetrics,
        )) {
          // Apply filters
          if (query.nodeId && nodeId !== query.nodeId) {
            continue;
          }

          if (!nodeMetrics.startTime) continue;

          // Find the bucket for this execution
          const bucketStart =
            Math.floor(nodeMetrics.startTime / bucketSizeMs) * bucketSizeMs;

          if (bucketStart < query.startTime || bucketStart >= query.endTime) {
            continue;
          }

          if (!buckets.has(bucketStart)) {
            buckets.set(bucketStart, {
              count: 0,
              totalDuration: 0,
              successCount: 0,
              validDurations: 0,
            });
          }

          const bucket = buckets.get(bucketStart)!;
          bucket.count++;

          if (nodeMetrics.status === "completed") {
            bucket.successCount++;
          }

          if (
            nodeMetrics.duration !== undefined &&
            nodeMetrics.duration !== null
          ) {
            bucket.totalDuration += nodeMetrics.duration;
            bucket.validDurations++;
          }
        }
      }

      // Convert buckets to time series data points
      const timeSeries: TimeSeriesDataPoint[] = [];

      for (const [timestamp, bucket] of Array.from(buckets.entries()).sort(
        (a, b) => a[0] - b[0],
      )) {
        timeSeries.push({
          timestamp,
          count: bucket.count,
          avgDuration:
            bucket.validDurations > 0
              ? bucket.totalDuration / bucket.validDurations
              : 0,
          successRate:
            bucket.count > 0 ? (bucket.successCount / bucket.count) * 100 : 0,
        });
      }

      Logger.debug(
        "system",
        "metrics",
        `Generated time series with ${timeSeries.length} data points`,
      );

      return timeSeries;
    } catch (error: unknown) {
      Logger.error(
        "system",
        "metrics",
        "Failed to aggregate metrics by time period",
        errorStack(error),
      );
      throw error;
    }
  }

  /**
   * Get metrics summary for a specific workflow
   */
  async getWorkflowSummary(
    workflowId: string,
  ): Promise<AggregatedMetrics | null> {
    try {
      const results = await this.aggregate({
        groupBy: "workflow",
        workflowId,
      });

      return results.length > 0 ? results[0] : null;
    } catch (error: unknown) {
      Logger.error(
        "system",
        "metrics",
        `Failed to get workflow summary for ${workflowId}`,
        errorStack(error),
      );
      return null;
    }
  }

  /**
   * Get metrics summary for a specific node across all instances
   */
  async getNodeSummary(
    nodeId: string,
    workflowId?: string,
  ): Promise<AggregatedMetrics | null> {
    try {
      const results = await this.aggregate({
        groupBy: "nodeId",
        workflowId,
      });

      return results.find((r) => r.dimension === nodeId) || null;
    } catch (error: unknown) {
      Logger.error(
        "system",
        "metrics",
        `Failed to get node summary for ${nodeId}`,
        errorStack(error),
      );
      return null;
    }
  }

  /**
   * Convert bucket size to milliseconds
   */
  private getBucketSizeMs(bucketSize: "hour" | "day" | "week"): number {
    switch (bucketSize) {
      case "hour":
        return 60 * 60 * 1000;
      case "day":
        return 24 * 60 * 60 * 1000;
      case "week":
        return 7 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000; // Default to hour
    }
  }
}
