import { getWorkflowEngineConfig } from "./config/redis.config";
import { DeadLetterQueue, setDLQ } from "./dlq/index";
import { EventBus } from "./event/EventBus";
import { CronScheduler } from "./scheduler/CronScheduler";
import { EnhancedCronScheduler } from "./scheduler/EnhancedCronScheduler";
import type { ArchiveManager } from "./storage/ArchiveManager";
import { createStorage, type StorageProvider } from "./storage/index";
import { Logger } from "./utils/Logger";

/**
 * 引擎配置
 */
export interface EngineConfig {
  logLevel: string;
  maxInstances: number;
  instanceTtlHours: number;
  cleanupIntervalMs: number;
}

/**
 * 应用容器 - 管理所有依赖
 */
export interface AppContainer {
  storage: StorageProvider;
  eventBus: EventBus;
  scheduler: CronScheduler;
  /**
   * Advanced cron scheduling (jitter, backfill, time windows, overlap
   * policies) via Schedule objects — a separate, richer model from
   * `scheduler`'s simple per-workflow cron jobs. Not wired into the
   * `workflow.cron` field's automatic scheduling path; use it directly
   * (createSchedule/startSchedule/pauseSchedule/backfill) when a workflow
   * needs those capabilities.
   */
  enhancedScheduler: EnhancedCronScheduler;
  dlq: DeadLetterQueue;
  config: EngineConfig;
  archiveManager?: ArchiveManager;
}

/**
 * 创建应用容器
 * 初始化所有依赖并建立关联
 */
export async function createContainer(options?: {
  storageType?: "memory" | "file";
  storageDirectory?: string;
}): Promise<AppContainer> {
  Logger.info("system", "container", "Creating application container...");

  // 加载配置
  const engineConfig = getWorkflowEngineConfig();
  const config: EngineConfig = {
    logLevel: engineConfig.logLevel,
    maxInstances: engineConfig.maxInstances,
    instanceTtlHours: engineConfig.instanceTtlHours,
    cleanupIntervalMs: engineConfig.cleanupIntervalMs,
  };

  // 创建存储（默认本地文件，测试环境默认内存）
  const storage = await createStorage({
    type: options?.storageType,
    directory: options?.storageDirectory,
  });

  // 创建事件总线
  const eventBus: EventBus = new EventBus();

  // 创建调度器
  const scheduler = new CronScheduler(storage);
  const enhancedScheduler = new EnhancedCronScheduler(storage);

  // 创建死信队列
  const dlq = new DeadLetterQueue(storage);
  setDLQ(dlq);

  Logger.info(
    "system",
    "container",
    "Application container created successfully",
  );

  return {
    storage,
    eventBus,
    scheduler,
    enhancedScheduler,
    dlq,
    config,
  };
}

/**
 * 销毁容器，释放资源
 */
export async function destroyContainer(container: AppContainer): Promise<void> {
  Logger.info("system", "container", "Destroying application container...");

  try {
    container.archiveManager?.destroy();

    // 停止调度器
    container.scheduler.stopAll();
    container.enhancedScheduler.stopAll();
    Logger.debug("system", "container", "Scheduler stopped");

    // 关闭事件总线
    await container.eventBus.close();
    Logger.debug("system", "container", "Event bus closed");

    // 关闭存储连接
    await container.storage.close();
    Logger.debug("system", "container", "Storage closed");

    Logger.info("system", "container", "Application container destroyed");
  } catch (error) {
    Logger.error(
      "system",
      "container",
      "Error destroying container",
      error instanceof Error ? error.stack : String(error),
    );
    throw error;
  }
}

// 全局容器实例
let globalContainer: AppContainer | null = null;

/**
 * 获取全局容器实例
 */
export function getContainer(): AppContainer | null {
  return globalContainer;
}

/**
 * 设置全局容器实例
 */
export function setContainer(container: AppContainer): void {
  globalContainer = container;
}
