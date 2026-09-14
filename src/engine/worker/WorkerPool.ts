import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Logger } from "../../utils/Logger";
import {
  StickyExecutionManager,
  stickyExecutionManager,
} from "../StickyExecutionManager";
import {
  type ExecuteTaskMessage,
  isTaskErrorMessage,
  isTaskResultMessage,
  type WorkerMessage,
} from "./WorkerMessage";

export interface WorkerPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  taskTimeout: number;
  idleTimeout: number;
}

interface PooledWorker {
  /** Stable identity used for sticky (instance → worker) affinity. */
  workerId: string;
  worker: Worker;
  busy: boolean;
  lastUsed: number;
  currentTaskId?: string;
}

interface QueuedTask {
  message: WorkerMessage;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
  /** Set for execute messages; drives sticky worker affinity. */
  instanceId?: string;
  workflowId?: string;
}

export class WorkerPool extends EventEmitter {
  private readonly config: WorkerPoolConfig;
  private readonly workers: PooledWorker[] = [];
  private readonly taskQueue: QueuedTask[] = [];
  private readonly pendingTasks = new Map<string, QueuedTask>();
  private readonly idleTimer: NodeJS.Timeout;
  private readonly sticky: StickyExecutionManager;
  private shuttingDown = false;
  private workerSequence = 0;

  constructor(config: WorkerPoolConfig, sticky?: StickyExecutionManager) {
    super();
    this.config = config;
    this.sticky = sticky ?? stickyExecutionManager;
    this.validateConfig(config);
    this.initializeWorkers();
    this.idleTimer = setInterval(
      () => this.pruneIdleWorkers(),
      Math.max(1000, Math.min(config.idleTimeout, 30000)),
    );
    this.idleTimer.unref();
  }

  async executeTask(message: WorkerMessage): Promise<unknown> {
    if (this.shuttingDown) {
      throw new Error("Worker pool is shutting down");
    }

    if (this.pendingTasks.has(message.taskId)) {
      throw new Error(`Duplicate task id: ${message.taskId}`);
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTasks.delete(message.taskId);
        this.rejectQueuedTask(
          message.taskId,
          new Error(`Task ${message.taskId} timed out`),
        );
        this.processQueue();
      }, this.config.taskTimeout);

      const payload = (message as ExecuteTaskMessage).payload;
      const task: QueuedTask = {
        message,
        resolve,
        reject,
        timeout,
        instanceId: payload?.instanceId,
        workflowId: payload?.workflowId,
      };

      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.idleTimer);

    const shutdownError = new Error("Worker pool shut down");
    for (const task of this.taskQueue.splice(0)) {
      clearTimeout(task.timeout);
      task.reject(shutdownError);
    }

    for (const task of this.pendingTasks.values()) {
      clearTimeout(task.timeout);
      task.reject(shutdownError);
    }
    this.pendingTasks.clear();

    for (const pooled of this.workers) {
      this.sticky.releaseWorker(pooled.workerId);
    }

    await Promise.all(this.workers.map((pooled) => pooled.worker.terminate()));
    this.workers.splice(0);
  }

  getStats(): { total: number; busy: number; idle: number; queued: number } {
    const busy = this.workers.filter((worker) => worker.busy).length;
    return {
      total: this.workers.length,
      busy,
      idle: this.workers.length - busy,
      queued: this.taskQueue.length,
    };
  }

  private validateConfig(config: WorkerPoolConfig): void {
    if (config.minWorkers < 0) {
      throw new Error("minWorkers must be greater than or equal to 0");
    }
    if (config.maxWorkers < 1) {
      throw new Error("maxWorkers must be greater than 0");
    }
    if (config.minWorkers > config.maxWorkers) {
      throw new Error("minWorkers cannot exceed maxWorkers");
    }
    if (config.taskTimeout < 1) {
      throw new Error("taskTimeout must be greater than 0");
    }
    if (config.idleTimeout < 1) {
      throw new Error("idleTimeout must be greater than 0");
    }
  }

  private initializeWorkers(): void {
    for (let index = 0; index < this.config.minWorkers; index += 1) {
      this.createWorker();
    }
  }

  private createWorker(): PooledWorker {
    this.workerSequence += 1;
    const workerId = `worker-${this.workerSequence}`;
    const worker = new Worker(this.getWorkerScriptPath(), {
      execArgv: this.getWorkerExecArgv(),
      workerData: { workerId },
    });
    const pooled: PooledWorker = {
      workerId,
      worker,
      busy: false,
      lastUsed: Date.now(),
    };

    worker.on("message", (message: WorkerMessage) => {
      this.handleWorkerMessage(pooled, message);
    });

    worker.on("error", (error: Error) => {
      Logger.error("system", "worker-pool", "Worker error", error.stack);
      this.failWorker(pooled, error);
    });

    worker.on("exit", (code: number) => {
      this.removeWorker(pooled);
      if (!this.shuttingDown && code !== 0) {
        Logger.warn("system", "worker-pool", `Worker exited with code ${code}`);
        this.ensureMinimumWorkers();
      }
    });

    this.workers.push(pooled);
    return pooled;
  }

  private getWorkerScriptPath(): string {
    const currentFile = fileURLToPath(import.meta.url);
    const extension = path.extname(currentFile);
    return path.join(path.dirname(currentFile), `WorkerProcess${extension}`);
  }

  private getWorkerExecArgv(): string[] {
    return path.extname(fileURLToPath(import.meta.url)) === ".ts"
      ? ["--experimental-specifier-resolution=node", "--loader", "ts-node/esm"]
      : [];
  }

  private handleWorkerMessage(
    pooled: PooledWorker,
    message: WorkerMessage,
  ): void {
    const task = this.pendingTasks.get(message.taskId);
    if (!task) {
      Logger.warn(
        "system",
        "worker-pool",
        `Received response for unknown task ${message.taskId}`,
      );
      return;
    }

    this.pendingTasks.delete(message.taskId);
    clearTimeout(task.timeout);
    pooled.busy = false;
    pooled.currentTaskId = undefined;
    pooled.lastUsed = Date.now();

    if (isTaskResultMessage(message)) {
      task.resolve(message.payload);
    } else if (isTaskErrorMessage(message)) {
      const error = new Error(message.payload.message);
      error.stack = message.payload.stack;
      task.reject(error);
    } else {
      task.reject(new Error(`Unexpected worker message type: ${message.type}`));
    }

    this.processQueue();
  }

  private processQueue(): void {
    if (this.shuttingDown || this.taskQueue.length === 0) {
      return;
    }

    const task = this.taskQueue[0];

    // Prefer the worker this instance is already bound to, so its cached state
    // stays warm. Falls back to any idle worker when the bound one is busy —
    // affinity is an optimization, never a reason to stall a task.
    const preferred = this.findPreferredWorker(task);
    if (preferred) {
      this.assignTask(preferred, task);
      return;
    }

    const idleWorker = this.workers.find((worker) => !worker.busy);
    if (idleWorker) {
      this.assignTask(idleWorker, task);
      return;
    }

    if (this.workers.length < this.config.maxWorkers) {
      this.assignTask(this.createWorker(), task);
    }
  }

  /**
   * Resolve the sticky-bound worker for a task, if it exists and is free.
   */
  private findPreferredWorker(task: QueuedTask): PooledWorker | undefined {
    if (!task.instanceId || !this.sticky.isEnabled()) {
      return undefined;
    }

    const boundWorkerId = this.sticky.getAssignedWorker(task.instanceId);
    if (!boundWorkerId) {
      return undefined;
    }

    return this.workers.find(
      (worker) => worker.workerId === boundWorkerId && !worker.busy,
    );
  }

  private assignTask(pooled: PooledWorker, expected?: QueuedTask): void {
    const index = expected ? this.taskQueue.indexOf(expected) : 0;
    if (index < 0) {
      return;
    }

    const [task] = this.taskQueue.splice(index, 1);
    if (!task) {
      return;
    }

    // Bind the instance to this worker so subsequent nodes of the same
    // instance land here again while the binding is alive.
    if (task.instanceId && task.workflowId) {
      void this.sticky.tryAssignWorker(
        task.instanceId,
        task.workflowId,
        pooled.workerId,
      );
    }

    pooled.busy = true;
    pooled.currentTaskId = task.message.taskId;
    pooled.lastUsed = Date.now();
    this.pendingTasks.set(task.message.taskId, task);
    pooled.worker.postMessage(task.message);
  }

  private rejectQueuedTask(taskId: string, error: Error): void {
    const queuedIndex = this.taskQueue.findIndex(
      (task) => task.message.taskId === taskId,
    );
    if (queuedIndex >= 0) {
      const [task] = this.taskQueue.splice(queuedIndex, 1);
      clearTimeout(task.timeout);
      task.reject(error);
      return;
    }

    const worker = this.workers.find(
      (candidate) => candidate.currentTaskId === taskId,
    );
    if (worker) {
      worker.busy = false;
      worker.currentTaskId = undefined;
      worker.lastUsed = Date.now();
      const pending = this.pendingTasks.get(taskId);
      this.pendingTasks.delete(taskId);
      pending?.reject(error);
    }
  }

  private failWorker(pooled: PooledWorker, error: Error): void {
    if (pooled.currentTaskId) {
      const task = this.pendingTasks.get(pooled.currentTaskId);
      if (task) {
        this.pendingTasks.delete(pooled.currentTaskId);
        clearTimeout(task.timeout);
        task.reject(error);
      }
    }

    void pooled.worker.terminate();
    this.removeWorker(pooled);
    this.ensureMinimumWorkers();
    this.processQueue();
  }

  private removeWorker(pooled: PooledWorker): void {
    // Release affinity bindings first: an instance bound to a worker that no
    // longer exists would otherwise never regain a preferred worker.
    this.sticky.releaseWorker(pooled.workerId);

    const index = this.workers.indexOf(pooled);
    if (index >= 0) {
      this.workers.splice(index, 1);
    }
  }

  private ensureMinimumWorkers(): void {
    while (!this.shuttingDown && this.workers.length < this.config.minWorkers) {
      this.createWorker();
    }
  }

  private pruneIdleWorkers(): void {
    if (this.shuttingDown || this.workers.length <= this.config.minWorkers) {
      return;
    }

    const now = Date.now();
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot needed: removeWorker() splices this.workers during iteration
    for (const pooled of [...this.workers]) {
      if (this.workers.length <= this.config.minWorkers) {
        return;
      }

      if (!pooled.busy && now - pooled.lastUsed >= this.config.idleTimeout) {
        this.removeWorker(pooled);
        void pooled.worker.terminate();
      }
    }
  }
}
