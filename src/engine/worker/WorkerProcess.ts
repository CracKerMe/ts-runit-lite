import { parentPort, workerData } from "node:worker_threads";
import type { WorkflowInstance } from "../../model/Instance";
import type { ExecuteTaskMessage, WorkerMessage } from "./WorkerMessage";

type Executor = {
  execute: (config: unknown, instance: WorkflowInstance) => Promise<unknown>;
};

if (!parentPort) {
  throw new Error("WorkerProcess must be run as a worker thread");
}

/** Stable id assigned by the pool; used for sticky-affinity logging. */
const workerId: string = workerData?.workerId ?? "worker-unknown";

/**
 * Executor modules resolved so far, kept across tasks. Sticky affinity routes
 * an instance back to the same worker, so this cache turns the repeated
 * dynamic import of an executor into a one-time cost per worker.
 */
const executorCache = new Map<string, Executor>();

parentPort.on("message", async (message: WorkerMessage): Promise<void> => {
  if (message.type !== "execute") {
    return;
  }

  const executeMessage = message as ExecuteTaskMessage;
  const startTime = Date.now();

  try {
    const executor = await loadExecutor(executeMessage.payload.nodeType);
    const result = await executor.execute(executeMessage.payload.config, {
      instanceId: executeMessage.payload.instanceId,
      workflowId: executeMessage.payload.workflowId,
      status: "running",
      context: executeMessage.payload.context,
      state: executeMessage.payload.state as WorkflowInstance["state"],
      currentNodes: [executeMessage.payload.nodeId],
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 0,
    } as WorkflowInstance);

    parentPort?.postMessage({
      type: "result",
      taskId: executeMessage.taskId,
      payload: {
        output: result,
        duration: Date.now() - startTime,
        workerId,
      },
    });
  } catch (error: unknown) {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));
    parentPort?.postMessage({
      type: "error",
      taskId: executeMessage.taskId,
      payload: {
        message: normalizedError.message,
        stack: normalizedError.stack,
      },
    });
  }
});

async function loadExecutor(nodeType: string): Promise<Executor> {
  const cached = executorCache.get(nodeType);
  if (cached) {
    return cached;
  }

  const executor = await importExecutor(nodeType);
  executorCache.set(nodeType, executor);
  return executor;
}

async function importExecutor(nodeType: string): Promise<Executor> {
  switch (nodeType) {
    case "http": {
      const module = await import("../executors/HttpNodeExecutor");
      return module.HttpNodeExecutor as Executor;
    }
    case "sql": {
      const module = await import("../executors/SqlNodeExecutor");
      return module.SqlNodeExecutor as Executor;
    }
    case "queue": {
      const module = await import("../executors/QueueNodeExecutor");
      return module.QueueNodeExecutor as Executor;
    }
    default:
      throw new Error(
        `No worker executor registered for node type: ${nodeType}`,
      );
  }
}
