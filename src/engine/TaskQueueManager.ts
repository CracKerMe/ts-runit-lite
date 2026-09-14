import { Logger } from "../utils/Logger";

export type TaskQueueType = "workflow" | "activity";

export interface TaskQueueOptions {
  name: string;
  type: TaskQueueType;
  routing?: (task: unknown) => string;
  maxConcurrent?: number;
  rateLimit?: number;
}

export interface Task<T = unknown> {
  id: string;
  queueName: string;
  payload: T;
  correlationId?: string;
  timestamp: Date;
  priority?: number;
}

/**
 * Worker callback. A returned value settles the corresponding `submit()` call;
 * fire-and-forget `enqueue()` workers may keep returning void.
 */
export type TaskHandler = (task: Task) => Promise<unknown>;

interface WorkerRegistration {
  workerId: string;
  queueNames: string[];
  callback: TaskHandler;
  maxConcurrent: number;
  activeCount: number;
}

/** Settlement handlers for tasks submitted via `submit()`. */
interface TaskSettlement {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class TaskQueueManager {
  private queues: Map<string, TaskQueueOptions> = new Map();
  private pendingTasks: Map<string, Task[]> = new Map();
  private workers: Map<string, WorkerRegistration> = new Map();
  private taskRouting: Map<string, (task: unknown) => string> = new Map();
  private settlements: Map<string, TaskSettlement> = new Map();

  createQueue(options: TaskQueueOptions): void {
    this.queues.set(options.name, options);
    this.pendingTasks.set(options.name, []);
    if (options.routing) {
      this.taskRouting.set(options.name, options.routing);
    }
    Logger.info("system", "task-queue", `Queue created: ${options.name}`, {
      type: options.type,
    });
  }

  getQueue(name: string): TaskQueueOptions | undefined {
    return this.queues.get(name);
  }

  listQueues(): TaskQueueOptions[] {
    return Array.from(this.queues.values());
  }

  deleteQueue(name: string): void {
    const queue = this.queues.get(name);
    if (!queue) {
      return;
    }

    const pending = this.pendingTasks.get(name) ?? [];
    if (pending.length > 0) {
      Logger.warn(
        "system",
        "task-queue",
        `Deleting queue with pending tasks: ${name}`,
        {
          pendingCount: pending.length,
        },
      );

      // Fail awaiting callers rather than leaving their promises pending forever.
      const deleted = new Error(`Queue deleted while task pending: ${name}`);
      for (const task of pending) {
        const settlement = this.settlements.get(task.id);
        if (settlement) {
          this.settlements.delete(task.id);
          settlement.reject(deleted);
        }
      }
    }

    this.queues.delete(name);
    this.pendingTasks.delete(name);
    this.taskRouting.delete(name);
    Logger.info("system", "task-queue", `Queue deleted: ${name}`);
  }

  enqueue<T = unknown>(
    queueName: string,
    payload: T,
    correlationId?: string,
    /** Runs after the task is queued but before dispatch, so callers can
     * register a settlement that a synchronous dispatch would otherwise miss. */
    beforeDispatch?: (taskId: string) => void,
  ): Task<T> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    let targetQueue = queueName;
    const routing = this.taskRouting.get(queueName);
    if (routing) {
      targetQueue = routing(payload);
    }

    const task: Task<T> = {
      id: `${targetQueue}:${Date.now()}:${Math.random().toString(36).substring(2, 9)}`,
      queueName: targetQueue,
      payload,
      correlationId,
      timestamp: new Date(),
    };

    const queueTasks = this.pendingTasks.get(targetQueue) ?? [];
    queueTasks.push(task);
    this.pendingTasks.set(targetQueue, queueTasks);

    Logger.debug("system", "task-queue", `Task enqueued: ${task.id}`, {
      queue: targetQueue,
    });

    beforeDispatch?.(task.id);

    this.dispatchTask(targetQueue);

    return task;
  }

  /**
   * Whether any registered worker serves this queue. Callers use this to fall
   * back to local execution instead of enqueuing a task nothing will pick up.
   */
  hasWorkerFor(queueName: string): boolean {
    for (const worker of this.workers.values()) {
      if (worker.queueNames.includes(queueName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Enqueue a task and resolve with the worker's return value.
   * Rejects if the worker callback throws.
   */
  submit<TResult = unknown, T = unknown>(
    queueName: string,
    payload: T,
    correlationId?: string,
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      let task: Task<T>;
      try {
        task = this.enqueue(queueName, payload, correlationId, (id) => {
          this.settlements.set(id, {
            resolve: resolve as (value: unknown) => void,
            reject,
          });
        });
      } catch (error) {
        reject(error);
        return;
      }
      // Guard against an enqueue path that never registered the settlement.
      if (!this.settlements.has(task.id)) {
        reject(new Error(`Task ${task.id} was not registered for settlement`));
      }
    });
  }

  private async dispatchTask(queueName: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) return;

    const queueTasks = this.pendingTasks.get(queueName) ?? [];
    if (queueTasks.length === 0) return;

    const availableWorkers = Array.from(this.workers.values()).filter(
      (w) =>
        w.queueNames.includes(queueName) && w.activeCount < w.maxConcurrent,
    );

    if (availableWorkers.length === 0) return;

    const worker = availableWorkers[0];
    const task = queueTasks.shift()!;

    worker.activeCount++;

    const settlement = this.settlements.get(task.id);

    try {
      const result = await worker.callback(task);
      if (settlement) {
        this.settlements.delete(task.id);
        settlement.resolve(result);
      }
    } catch (error) {
      Logger.error(
        "system",
        "task-queue",
        `Task execution error: ${task.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      if (settlement) {
        // A submitted task has a caller awaiting it: surface the failure
        // instead of re-queueing, which would retry a failing task forever.
        this.settlements.delete(task.id);
        settlement.reject(error);
      } else {
        queueTasks.unshift(task);
      }
    } finally {
      worker.activeCount--;
    }

    this.dispatchTask(queueName);
  }

  registerWorker(
    workerId: string,
    queueNames: string[],
    callback: TaskHandler,
    options?: { maxConcurrent?: number },
  ): void {
    const worker: WorkerRegistration = {
      workerId,
      queueNames,
      callback,
      maxConcurrent: options?.maxConcurrent ?? 10,
      activeCount: 0,
    };

    this.workers.set(workerId, worker);

    for (const queueName of queueNames) {
      if (!this.queues.has(queueName)) {
        this.createQueue({ name: queueName, type: "activity" });
      }
    }

    Logger.info("system", "task-queue", `Worker registered: ${workerId}`, {
      queues: queueNames,
    });
  }

  unregisterWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    this.workers.delete(workerId);
    Logger.info("system", "task-queue", `Worker unregistered: ${workerId}`);
  }

  getPendingCount(queueName: string): number {
    return (this.pendingTasks.get(queueName) ?? []).length;
  }

  getWorkerStatus(
    workerId: string,
  ): { active: number; max: number } | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) return undefined;
    return { active: worker.activeCount, max: worker.maxConcurrent };
  }
}

export const taskQueueManager = new TaskQueueManager();
