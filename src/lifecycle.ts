import type { StorageProvider } from "./storage/StorageProvider";
import { flush as flushLogger, Logger } from "./utils/Logger";

export interface ShutdownOptions {
  timeout?: number; // 关闭超时时间（毫秒），默认 30 秒
  callbackTimeout?: number; // 单个回调的超时时间（毫秒），默认 8 秒
}

/**
 * 单个关闭回调的默认超时。
 *
 * 整体 `timeout` 只能在所有回调都卡住时强制 `process.exit`，救不回
 * 单个挂死的步骤——后面的清理照样不会执行。按步骤设上限，可以让某个组件
 * 卡住时其余组件仍被正常释放（尤其是监听端口）。
 */
const DEFAULT_CALLBACK_TIMEOUT = 8000;

/**
 * 优雅关闭管理器
 * 处理进程终止信号，确保资源正确清理
 */
export class GracefulShutdown {
  private isShuttingDown = false;
  private shutdownCallbacks: Array<() => Promise<void>> = [];
  private readonly timeout: number;
  private readonly callbackTimeout: number;

  constructor(options: ShutdownOptions = {}) {
    this.timeout = options.timeout || 30000;
    this.callbackTimeout = options.callbackTimeout ?? DEFAULT_CALLBACK_TIMEOUT;
  }

  /**
   * 注册关闭时需要执行的回调（追加到链尾）
   */
  registerCallback(callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * 注册关闭回调并插到链首。
   *
   * 用于必须最先执行的步骤——典型是停止接受新的 HTTP 连接：
   * 必须先于引擎和存储的销毁，否则关闭过程中仍可能有新请求打进来，
   * 落到已经开始拆解的组件上。
   */
  registerCallbackFirst(callback: () => Promise<void>): void {
    this.shutdownCallbacks.unshift(callback);
  }

  /**
   * 执行单个关闭回调，超时则放弃等待并继续下一个。
   *
   * 被放弃的回调仍在后台运行（无法取消），但不再阻塞关闭链。
   */
  private async runCallback(callback: () => Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.callbackTimeout);
      timer.unref();
    });

    try {
      const result = await Promise.race([
        callback().then(() => "done" as const),
        timedOut,
      ]);
      if (result === "timeout") {
        Logger.error(
          "system",
          "shutdown",
          `Shutdown callback exceeded ${this.callbackTimeout}ms, continuing without it`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 主动触发优雅关闭，与收到信号时走完全相同的关闭链。
   *
   * 供没有信号可依赖的场景使用——典型是父进程（watcher）先退出、
   * 本进程被 init 收养，此后不会再有任何信号到来。
   */
  async trigger(reason: string): Promise<void> {
    await this.runShutdown(reason);
  }

  /**
   * 设置信号处理器
   */
  setup(): void {
    process.on("SIGTERM", () => void this.runShutdown("SIGTERM"));
    process.on("SIGINT", () => void this.runShutdown("SIGINT"));

    // 处理未捕获的异常
    process.on("uncaughtException", (error) => {
      Logger.error(
        "system",
        "uncaughtException",
        "Uncaught exception",
        error.stack,
      );
      void this.runShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      Logger.error(
        "system",
        "unhandledRejection",
        "Unhandled rejection",
        reason instanceof Error ? reason.stack : String(reason),
      );
    });
  }

  /**
   * 关闭链本体：信号处理器与 `trigger()` 共用这一条路径。
   */
  private async runShutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) {
      Logger.info(
        "system",
        "shutdown",
        "Shutdown already in progress, ignoring signal",
      );
      return;
    }

    this.isShuttingDown = true;
    Logger.info(
      "system",
      "shutdown",
      `Received ${reason}, starting graceful shutdown...`,
    );

    // 设置强制退出超时
    const forceExitTimeout = setTimeout(() => {
      Logger.error(
        "system",
        "shutdown",
        `Shutdown timeout (${this.timeout}ms) exceeded, forcing exit`,
      );
      process.exit(1);
    }, this.timeout);

    try {
      // 执行所有注册的关闭回调
      for (const callback of this.shutdownCallbacks) {
        try {
          await this.runCallback(callback);
        } catch (error) {
          Logger.error(
            "system",
            "shutdown",
            "Error during shutdown callback",
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      clearTimeout(forceExitTimeout);
      Logger.info("system", "shutdown", "Graceful shutdown completed");
      await flushLogger();
      process.exit(0);
    } catch (error) {
      clearTimeout(forceExitTimeout);
      Logger.error(
        "system",
        "shutdown",
        "Error during shutdown",
        error instanceof Error ? error.stack : String(error),
      );
      await flushLogger();
      process.exit(1);
    }
  }

  /**
   * 检查是否正在关闭
   */
  isInProgress(): boolean {
    return this.isShuttingDown;
  }
}

/**
 * 监视父进程，父进程消失后主动触发关闭。
 *
 * 背景：`tsx watch` 之类的 watcher 在 Ctrl+C 时可能先于子进程退出，
 * 或被强杀而来不及转发信号。此时子进程被 init 收养（ppid 变成 1），
 * 但它自己毫无感知——事件循环还活着，监听套接字还在，端口就一直被占住，
 * 直到手动 kill；watcher 重启时便报 "Previous process hasn't exited yet"。
 *
 * 所以主动轮询 ppid：一旦发现被收养就走正常的优雅关闭流程，
 * 而不是干等一个永远不会到来的信号。
 *
 * 只在确有父进程时启用（ppid > 1）；定时器 unref，不会自己撑着事件循环。
 */
export function watchParentProcess(
  onOrphaned: () => void,
  intervalMs = 1000,
): NodeJS.Timeout | null {
  const initialPpid = process.ppid;
  if (!initialPpid || initialPpid <= 1) return null;

  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    // ppid 变了（通常变成 1）说明原父进程已经没了。
    if (process.ppid !== initialPpid) {
      fired = true;
      clearInterval(timer);
      Logger.warn(
        "system",
        "shutdown",
        `Parent process ${initialPpid} exited (reparented to ${process.ppid}), shutting down to release resources`,
      );
      onOrphaned();
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

/**
 * 设置优雅关闭
 * @param storage 存储提供者（可选）
 * @param additionalCallbacks 额外的关闭回调
 */
export function setupGracefulShutdown(
  storage?: StorageProvider,
  additionalCallbacks: Array<() => Promise<void>> = [],
): GracefulShutdown {
  const shutdown = new GracefulShutdown();

  // 先注册调用方传入的回调（引擎 → worker 池 → sandbox 池 → 调度器 …），
  // 存储放在最后关闭。
  //
  // 顺序很重要：这些组件在停止过程中仍可能写存储（flush 实例状态、落盘
  // metrics）。如果先关存储，这些写入会抛错或挂住，把整条关闭链卡在中途，
  // 直到 30s 强制退出——监听端口也就一直不释放。
  for (const callback of additionalCallbacks) {
    shutdown.registerCallback(callback);
  }

  // 注册存储关闭（链尾）
  if (storage) {
    shutdown.registerCallback(async () => {
      Logger.info("system", "shutdown", "Closing storage connection...");
      await storage.close();
      Logger.info("system", "shutdown", "Storage connection closed");
    });
  }

  shutdown.setup();
  return shutdown;
}

// 导出单例实例
let shutdownInstance: GracefulShutdown | null = null;

export function getShutdownInstance(): GracefulShutdown | null {
  return shutdownInstance;
}

export function setShutdownInstance(instance: GracefulShutdown): void {
  shutdownInstance = instance;
}
