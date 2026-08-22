import { recordNodeExecution } from "../../metrics/index";
import type { ExecutionLog, WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import type { StorageProvider } from "../../storage/StorageProvider";
import { Logger } from "../../utils/Logger";
import {
  DataValidationError,
  getValidationMode,
  validateAgainstSchema,
} from "../DataValidator";
import { WorkerPool, type WorkerPoolConfig } from "../worker/WorkerPool";

// Configurable threshold for slow execution warnings (in milliseconds)
export const SLOW_EXECUTION_THRESHOLD_MS = 5000; // 5 seconds default
let workerPool: WorkerPool | null = null;

export function initWorkerPool(config?: Partial<WorkerPoolConfig>): WorkerPool {
  if (workerPool) {
    return workerPool;
  }

  workerPool = new WorkerPool({
    minWorkers: config?.minWorkers ?? 2,
    maxWorkers: config?.maxWorkers ?? 8,
    taskTimeout: config?.taskTimeout ?? 60000,
    idleTimeout: config?.idleTimeout ?? 300000,
  });

  return workerPool;
}

export function getWorkerPool(): WorkerPool | null {
  return workerPool;
}

export async function shutdownWorkerPool(): Promise<void> {
  if (!workerPool) {
    return;
  }

  await workerPool.shutdown();
  workerPool = null;
}

/**
 * Handle routing for a node after successful execution.
 * Supports conditionalNext with defaultNext fallback, or standard next pointers.
 */
export async function handleRouting(
  node: TaskNode,
  instance: WorkflowInstance,
  onComplete: (nextNodes: string[]) => void,
) {
  if (node.conditionalNext?.length) {
    const { resolveConditionalNext, interpolateExpressions } =
      await import("../ExpressionEvaluator");

    // Build comprehensive evaluation context
    const evaluationContext: Record<string, unknown> = {
      ...instance.context,
      state: instance.state || {},
    };

    // Add node outputs to context for direct expression access (e.g. node1.output.status)
    if (instance.state?.nodes) {
      for (const [nodeId, nodeState] of Object.entries(instance.state.nodes)) {
        evaluationContext[nodeId] = nodeState;
      }
    }

    // Interpolate conditions with current context and state
    const interpolatedNext = node.conditionalNext.map((bn) => ({
      ...bn,
      condition: interpolateExpressions(
        bn.condition,
        instance.context,
        instance.state,
      ),
    }));

    const nextNode = resolveConditionalNext(
      interpolatedNext,
      node.defaultNext,
      evaluationContext,
    );
    onComplete(nextNode ? [nextNode] : node.next || []);
  } else {
    onComplete(node.next || []);
  }
}

export function ensureNodeState(
  instance: WorkflowInstance,
): Record<string, unknown> {
  if (!instance.state) {
    instance.state = { nodes: {} };
  }
  if (!instance.state.nodes) {
    instance.state.nodes = {};
  }
  return instance.state.nodes;
}

export async function completeStandardNode(params: {
  node: TaskNode;
  instance: WorkflowInstance;
  logEntry: ExecutionLog;
  result: unknown;
  startTime: number;
  onComplete: (nextNodes: string[]) => void;
  storage?: StorageProvider;
  logMessage: string;
  logData?: unknown;
  /** When provided, call onComplete(nextNodes) directly instead of handleRouting. */
  nextNodes?: string[];
}): Promise<void> {
  const {
    node,
    instance,
    logEntry,
    result,
    startTime,
    onComplete,
    storage,
    logMessage,
    logData,
    nextNodes,
  } = params;
  const endTime = Date.now();
  const duration = endTime - startTime;

  logEntry.status = "success";
  logEntry.data = result;
  logEntry.duration = duration;

  ensureNodeState(instance)[node.id] = { output: result };

  Logger.log(
    instance.instanceId,
    node.id,
    logMessage,
    (logData ?? { duration }) as Record<string, unknown>,
    "action",
  );
  Logger.debug(
    instance.instanceId,
    node.id,
    `${node.type} node completed in ${duration}ms`,
  );

  recordNodeExecution(
    instance.workflowId,
    node.id,
    node.type,
    "success",
    duration / 1000,
  );

  if (storage) {
    try {
      await storage.updateNodeMetrics(instance.instanceId, node.id, {
        nodeId: node.id,
        nodeType: node.type,
        startTime,
        endTime,
        duration,
        status: "completed",
        retryCount: instance.retries?.[node.id] || 0,
      });
    } catch (error: unknown) {
      Logger.error(
        instance.instanceId,
        node.id,
        "Failed to record completion metrics",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  if (duration > SLOW_EXECUTION_THRESHOLD_MS) {
    Logger.warn(
      instance.instanceId,
      node.id,
      `Slow execution detected: ${duration}ms (threshold: ${SLOW_EXECUTION_THRESHOLD_MS}ms)`,
    );
  }

  validateNodeOutput(node, instance, result);

  if (nextNodes) {
    onComplete(nextNodes);
  } else {
    await handleRouting(node, instance, onComplete);
  }
}

/**
 * 按节点 outputSchema 校验执行结果（SCHEMA_VALIDATION=strict|warn|off）。
 * strict 模式下抛出 DataValidationError，由节点错误处理流程接管。
 */
export function validateNodeOutput(
  node: TaskNode,
  instance: WorkflowInstance,
  result: unknown,
): void {
  if (!node.outputSchema) return;
  const mode = getValidationMode();
  if (mode === "off") return;

  const validation = validateAgainstSchema(node.outputSchema, result);
  if (validation.valid) return;

  if (mode === "strict") {
    throw new DataValidationError(validation.issues);
  }
  Logger.warn(
    instance.instanceId,
    node.id,
    "Node output validation failed (warn mode)",
    { issues: validation.issues },
  );
}

export function shouldUseWorker(node: TaskNode): boolean {
  return workerPool !== null && node.type === "http";
}

export function requireNodeConfig<T>(
  node: TaskNode,
  label: string,
  fallback?: T,
): T {
  const config = node.config as T | undefined;
  if (config !== undefined) {
    return config;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`${label} node missing config`);
}

export async function executeInWorker(
  node: TaskNode,
  instance: WorkflowInstance,
): Promise<unknown> {
  if (!workerPool) {
    throw new Error("Worker pool is not initialized");
  }

  const response = await workerPool.executeTask({
    type: "execute",
    taskId: `${instance.instanceId}-${node.id}-${Date.now()}`,
    payload: {
      nodeType: node.type,
      config: node.config,
      instanceId: instance.instanceId,
      workflowId: instance.workflowId,
      nodeId: node.id,
      context: instance.context,
      state: instance.state,
    },
  });

  return (response as { output: unknown }).output;
}
