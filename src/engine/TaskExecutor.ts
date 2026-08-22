// oxlint-disable no-explicit-any -- TaskExecutor dispatches to heterogeneous node executors with dynamic config
import { workflowDebugger } from "../debug/WorkflowDebugger";
import { recordNodeExecution } from "../metrics/index";
import type { ExecutionLog, WorkflowInstance } from "../model/Instance";
import type { TaskNode } from "../model/Workflow";
import type { StorageProvider } from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";
import { dispatchControlNode } from "./nodeDispatch/controlNodes";
import {
  getWorkerPool,
  initWorkerPool,
  shutdownWorkerPool,
} from "./nodeDispatch/helpers";
import { dispatchIoNode } from "./nodeDispatch/ioNodes";
import { dispatchWorkflowNode } from "./nodeDispatch/workflowNodes";
import type { WorkerPoolConfig } from "./worker/WorkerPool";

export { initWorkerPool, getWorkerPool, shutdownWorkerPool };
export type { WorkerPoolConfig };

/**
 * Task Executor
 * Responsible for executing specific task nodes based on their type.
 */
export async function execute(
  node: TaskNode,
  instance: WorkflowInstance,
  onComplete: (nextNodes: string[]) => void,
  onError: (error: Error) => void,
  storage?: StorageProvider,
) {
  const logEntry: ExecutionLog = {
    nodeId: node.id,
    timestamp: new Date(),
    status: "started",
  };

  instance.history.push(logEntry);
  Logger.log(instance.instanceId, node.id, "Task started", undefined, "action");
  workflowDebugger.onNodeEnter(instance.instanceId, node.id, {
    ...instance.context,
    state: instance.state ?? {},
  });

  // Record node start metrics
  const startTime = Date.now();
  if (storage) {
    try {
      await storage.updateNodeMetrics(instance.instanceId, node.id, {
        nodeId: node.id,
        nodeType: node.type,
        startTime,
        status: "running",
        retryCount: instance.retries?.[node.id] || 0,
        retryTimestamps: [],
      });
    } catch (error: any) {
      Logger.error(
        instance.instanceId,
        node.id,
        "Failed to record start metrics",
        error?.stack,
      );
    }
  }

  const ctx = { node, instance, logEntry, startTime, onComplete, storage };

  try {
    let handled = await dispatchIoNode(ctx);
    if (handled !== undefined) return;

    handled = await dispatchControlNode(ctx);
    if (handled !== undefined) return;

    handled = await dispatchWorkflowNode(ctx);
    if (handled !== undefined) return;

    // 不支持的任务类型
    const errorMsg = `Unsupported task type: ${node.type}`;
    logEntry.status = "failed";
    logEntry.error = errorMsg;

    Logger.error(instance.instanceId, node.id, errorMsg);

    // Record error metrics
    if (storage) {
      try {
        await storage.updateNodeMetrics(instance.instanceId, node.id, {
          nodeId: node.id,
          nodeType: node.type,
          startTime,
          endTime: Date.now(),
          duration: Date.now() - startTime,
          status: "failed",
          retryCount: instance.retries?.[node.id] || 0,
          error: {
            message: errorMsg,
            timestamp: Date.now(),
          },
        });
      } catch (error: any) {
        Logger.error(
          instance.instanceId,
          node.id,
          "Failed to record error metrics",
          error?.stack,
        );
      }
    }

    throw new Error(errorMsg);
  } catch (err: unknown) {
    // 错误处理
    const endTime = Date.now();
    const duration = endTime - startTime;

    logEntry.status = "failed";
    logEntry.error =
      (err instanceof Error ? err.message : String(err)) || String(err);
    logEntry.stack = err instanceof Error ? err.stack : undefined;
    logEntry.duration = duration;

    Logger.error(
      instance.instanceId,
      node.id,
      "Task failed",
      err instanceof Error ? err.message : String(err),
      "action",
    );

    // Record Prometheus metrics for failed execution
    recordNodeExecution(
      instance.workflowId,
      node.id,
      node.type,
      "failed",
      duration / 1000, // Convert to seconds
    );

    // Record error metrics with full details
    if (storage) {
      try {
        await storage.updateNodeMetrics(instance.instanceId, node.id, {
          nodeId: node.id,
          nodeType: node.type,
          startTime,
          endTime,
          duration,
          status: "failed",
          retryCount: instance.retries?.[node.id] || 0,
          error: {
            message:
              (err instanceof Error ? err.message : String(err)) || String(err),
            stack: err instanceof Error ? err.stack : undefined,
            timestamp: endTime,
          },
        });
      } catch (error: any) {
        Logger.error(
          instance.instanceId,
          node.id,
          "Failed to record error metrics",
          error?.stack,
        );
      }
    }

    // 确保错误对象是Error类型
    const error = err instanceof Error ? err : new Error(String(err));
    onError(error);
  } finally {
    workflowDebugger.onNodeExit(instance.instanceId, node.id);
  }
}

/**
 * TaskExecutor
 * Access to task execution functionality.
 */
export const TaskExecutor = {
  execute,
};
