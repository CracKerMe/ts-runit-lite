import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { Logger } from "../../utils/Logger";
import {
  type EvaluateMessage,
  isEvaluateErrorMessage,
  isEvaluateResultMessage,
  type WorkerReplyMessage,
} from "./ActionSandboxMessage";

export interface ActionSandboxPoolConfig {
  minWorkers: number;
  maxWorkers: number;
  taskTimeoutMs: number;
  idleTimeoutMs: number;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  lastUsed: number;
  currentTaskId?: string;
}

interface QueuedTask {
  message: EvaluateMessage;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let taskSequence = 0;

/**
 * Runs action/rollback string bodies in dedicated worker threads instead of
 * in-process `vm`. Each task gets a real, separate V8 isolate and heap; a
 * task that exceeds its timeout has its whole worker thread terminated
 * (hard preemption) rather than relying on `vm.Script`'s cooperative-only
 * timeout, which cannot interrupt a tight synchronous loop.
 *
 * Deliberately much simpler than the HTTP/SQL `WorkerPool`: no sticky
 * affinity (action strings are short-lived and stateless per call) and no
 * per-node-type executor cache — one code path, evaluate and reply.
 */
export class ActionSandboxPool {
  private readonly config: ActionSandboxPoolConfig;
  private readonly workers: PooledWorker[] = [];
  private readonly taskQueue: QueuedTask[] = [];
  private readonly pendingTasks = new Map<string, QueuedTask>();
  private readonly idleTimer: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(config: ActionSandboxPoolConfig) {
    this.config = config;
    this.validateConfig(config);
    for (let i = 0; i < config.minWorkers; i += 1) this.createWorker();
    this.idleTimer = setInterval(
      () => this.pruneIdleWorkers(),
      Math.max(1000, Math.min(config.idleTimeoutMs, 30_000)),
    );
    this.idleTimer.unref();
  }

  async evaluate(
    expression: string,
    context: Record<string, unknown>,
  ): Promise<unknown> {
    if (this.shuttingDown) {
      throw new Error("Action sandbox pool is shutting down");
    }

    taskSequence += 1;
    const taskId = `action-${taskSequence}-${Date.now()}`;
    const message: EvaluateMessage = {
      type: "evaluate",
      taskId,
      payload: { expression, context, timeoutMs: this.config.taskTimeoutMs },
    };

    return new Promise<unknown>((resolve, reject) => {
      this.taskQueue.push({ message, resolve, reject });
      this.processQueue();
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    clearInterval(this.idleTimer);

    const shutdownError = new Error("Action sandbox pool shut down");
    for (const task of this.taskQueue.splice(0)) task.reject(shutdownError);
    for (const task of this.pendingTasks.values()) task.reject(shutdownError);
    this.pendingTasks.clear();

    await Promise.all(this.workers.map((pooled) => pooled.worker.terminate()));
    this.workers.splice(0);
  }

  getStats(): { total: number; busy: number; idle: number; queued: number } {
    const busy = this.workers.filter((w) => w.busy).length;
    return {
      total: this.workers.length,
      busy,
      idle: this.workers.length - busy,
      queued: this.taskQueue.length,
    };
  }

  private validateConfig(config: ActionSandboxPoolConfig): void {
    if (config.minWorkers < 0) {
      throw new Error("minWorkers must be greater than or equal to 0");
    }
    if (config.maxWorkers < 1) {
      throw new Error("maxWorkers must be greater than 0");
    }
    if (config.minWorkers > config.maxWorkers) {
      throw new Error("minWorkers cannot exceed maxWorkers");
    }
    if (config.taskTimeoutMs < 1) {
      throw new Error("taskTimeoutMs must be greater than 0");
    }
  }

  private createWorker(): PooledWorker {
    const worker = new Worker(this.getWorkerScriptPath(), {
      execArgv: this.getWorkerExecArgv(),
    });
    const pooled: PooledWorker = { worker, busy: false, lastUsed: Date.now() };

    worker.on("message", (message: WorkerReplyMessage) => {
      this.handleWorkerMessage(pooled, message);
    });
    worker.on("error", (error: Error) => {
      Logger.error(
        "system",
        "action-sandbox-pool",
        "Worker error",
        error.stack,
      );
      this.failWorker(pooled, error);
    });
    worker.on("exit", (code: number) => {
      this.removeWorker(pooled);
      if (!this.shuttingDown) {
        if (code !== 0) {
          Logger.warn(
            "system",
            "action-sandbox-pool",
            `Worker exited with code ${code}`,
          );
        }
        // Replace the worker (a deliberate terminate() after a timeout also
        // exits with a non-zero code) and let any task still queued behind
        // the one that just timed out get picked up by the replacement —
        // otherwise it waits forever for a worker that will never free up.
        this.ensureMinimumWorkers();
        this.processQueue();
      }
    });

    this.workers.push(pooled);
    return pooled;
  }

  private getWorkerScriptPath(): string {
    const currentFile = fileURLToPath(import.meta.url);
    const extension = path.extname(currentFile);
    return path.join(
      path.dirname(currentFile),
      `ActionSandboxWorker${extension}`,
    );
  }

  private getWorkerExecArgv(): string[] {
    return path.extname(fileURLToPath(import.meta.url)) === ".ts"
      ? ["--experimental-specifier-resolution=node", "--loader", "ts-node/esm"]
      : [];
  }

  private handleWorkerMessage(
    pooled: PooledWorker,
    message: WorkerReplyMessage,
  ): void {
    const task = this.pendingTasks.get(message.taskId);
    if (!task) return;

    this.pendingTasks.delete(message.taskId);
    pooled.busy = false;
    pooled.currentTaskId = undefined;
    pooled.lastUsed = Date.now();

    if (isEvaluateResultMessage(message)) {
      task.resolve(message.payload.result);
    } else if (isEvaluateErrorMessage(message)) {
      const error = new Error(message.payload.message);
      error.stack = message.payload.stack;
      task.reject(error);
    }

    this.processQueue();
  }

  private processQueue(): void {
    if (this.shuttingDown || this.taskQueue.length === 0) return;

    const idleWorker = this.workers.find((w) => !w.busy);
    if (idleWorker) {
      this.assignTask(idleWorker);
      return;
    }

    if (this.workers.length < this.config.maxWorkers) {
      this.assignTask(this.createWorker());
    }
    // Otherwise the task waits in queue until a worker frees up or times out.
  }

  private assignTask(pooled: PooledWorker): void {
    const task = this.taskQueue.shift();
    if (!task) return;

    pooled.busy = true;
    pooled.currentTaskId = task.message.taskId;
    pooled.lastUsed = Date.now();
    this.pendingTasks.set(task.message.taskId, task);

    // Hard preemption: unlike vm.Script's timeout (which can only interrupt
    // at certain bytecode boundaries and never breaks a tight native loop),
    // terminate() unconditionally kills the thread. A replacement worker is
    // spun up via the 'exit' handler's ensureMinimumWorkers/processQueue.
    const timer = setTimeout(() => {
      if (this.pendingTasks.get(task.message.taskId) !== task) return;
      this.pendingTasks.delete(task.message.taskId);
      void pooled.worker.terminate();
      task.reject(
        new Error(
          `Action evaluation timed out after ${this.config.taskTimeoutMs}ms`,
        ),
      );
    }, this.config.taskTimeoutMs + 50); // small grace period over the worker's own timeout
    timer.unref();

    const originalResolve = task.resolve;
    const originalReject = task.reject;
    task.resolve = (value) => {
      clearTimeout(timer);
      originalResolve(value);
    };
    task.reject = (reason) => {
      clearTimeout(timer);
      originalReject(reason);
    };

    pooled.worker.postMessage(task.message);
  }

  private failWorker(pooled: PooledWorker, error: Error): void {
    if (pooled.currentTaskId) {
      const task = this.pendingTasks.get(pooled.currentTaskId);
      if (task) {
        this.pendingTasks.delete(pooled.currentTaskId);
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
    if (index >= 0) this.workers.splice(index, 1);
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
      if (this.workers.length <= this.config.minWorkers) return;
      if (!pooled.busy && now - pooled.lastUsed >= this.config.idleTimeoutMs) {
        this.removeWorker(pooled);
        void pooled.worker.terminate();
      }
    }
  }
}
