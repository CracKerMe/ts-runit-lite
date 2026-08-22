import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Logger } from "../../utils/Logger";
import {
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
}

export class WorkerPool extends EventEmitter {
  private readonly config: WorkerPoolConfig;
  private readonly workers: PooledWorker[] = [];
  private readonly taskQueue: QueuedTask[] = [];
  private readonly pendingTasks = new Map<string, QueuedTask>();
  private readonly idleTimer: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(config: WorkerPoolConfig) {
    super();
    this.config = config;
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

      const task: QueuedTask = {
        message,
        resolve,
        reject,
        timeout,
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
    const worker = new Worker(this.getWorkerScriptPath(), {
      execArgv: this.getWorkerExecArgv(),
    });
    const pooled: PooledWorker = {
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

    const idleWorker = this.workers.find((worker) => !worker.busy);
    if (idleWorker) {
      this.assignTask(idleWorker);
      return;
    }

    if (this.workers.length < this.config.maxWorkers) {
      this.assignTask(this.createWorker());
    }
  }

  private assignTask(pooled: PooledWorker): void {
    const task = this.taskQueue.shift();
    if (!task) {
      return;
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
