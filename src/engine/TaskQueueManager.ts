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

interface WorkerRegistration {
  workerId: string;
  queueNames: string[];
  callback: (task: Task) => Promise<void>;
  maxConcurrent: number;
  activeCount: number;
}

export class TaskQueueManager {
  private queues: Map<string, TaskQueueOptions> = new Map();
  private pendingTasks: Map<string, Task[]> = new Map();
  private workers: Map<string, WorkerRegistration> = new Map();
  private taskRouting: Map<string, (task: unknown) => string> = new Map();

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

    this.dispatchTask(targetQueue);

    return task;
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

    try {
      await worker.callback(task);
    } catch (error) {
      Logger.error(
        "system",
        "task-queue",
        `Task execution error: ${task.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      queueTasks.unshift(task);
    } finally {
      worker.activeCount--;
    }

    this.dispatchTask(queueName);
  }

  registerWorker(
    workerId: string,
    queueNames: string[],
    callback: (task: Task) => Promise<void>,
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
