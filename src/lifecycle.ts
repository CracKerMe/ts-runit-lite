import type { StorageProvider } from "./storage/StorageProvider";
import { flush as flushLogger, Logger } from "./utils/Logger";

export interface ShutdownOptions {
  timeout?: number; // 关闭超时时间（毫秒），默认 30 秒
}

/**
 * 优雅关闭管理器
 * 处理进程终止信号，确保资源正确清理
 */
export class GracefulShutdown {
  private isShuttingDown = false;
  private shutdownCallbacks: Array<() => Promise<void>> = [];
  private readonly timeout: number;

  constructor(options: ShutdownOptions = {}) {
    this.timeout = options.timeout || 30000;
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
   * 设置信号处理器
   */
  setup(): void {
    const shutdown = async (signal: string) => {
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
        `Received ${signal}, starting graceful shutdown...`,
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
            await callback();
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
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // 处理未捕获的异常
    process.on("uncaughtException", (error) => {
      Logger.error(
        "system",
        "uncaughtException",
        "Uncaught exception",
        error.stack,
      );
      shutdown("uncaughtException");
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
   * 检查是否正在关闭
   */
  isInProgress(): boolean {
    return this.isShuttingDown;
  }
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

  // 注册存储关闭
  if (storage) {
    shutdown.registerCallback(async () => {
      Logger.info("system", "shutdown", "Closing storage connection...");
      await storage.close();
      Logger.info("system", "shutdown", "Storage connection closed");
    });
  }

  // 注册额外的回调
  for (const callback of additionalCallbacks) {
    shutdown.registerCallback(callback);
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
