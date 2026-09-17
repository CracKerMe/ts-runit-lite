import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { type AppConfig, validateAppConfig } from "./config/AppConfig";
import {
  type AppContainer,
  createContainer,
  destroyContainer,
  setContainer,
} from "./container";
import { configureHeartbeatTracker } from "./engine/HeartbeatTracker";
import {
  configureActionSandboxIsolation,
  shutdownActionSandboxIsolation,
} from "./engine/SandboxEvaluator";
import { stickyExecutionPolicy } from "./engine/StickyExecutionPolicy";
import { initWorkerPool, shutdownWorkerPool } from "./engine/TaskExecutor";
import { WorkflowEngine } from "./engine/WorkflowEngine";
import { setShutdownInstance, setupGracefulShutdown } from "./lifecycle";
import { setupNotificationChannelsFromEnv } from "./notification/index";
import { ArchiveManager } from "./storage/ArchiveManager";
import type { ExternalTimerAdapter } from "./timers/ExternalTimerAdapter";
import { setExternalTimerAdapter } from "./timers/ExternalTimerAdapter";
import { Logger, type LogLevel } from "./utils/Logger";
import { disposeSecretManager, setSecretManager } from "./utils/secrets";
import { SecretManager } from "./utils/SecretManager";

/**
 * 应用启动选项
 */
export interface BootstrapOptions {
  skipValidation?: boolean;
  skipGracefulShutdown?: boolean;
  resumeRunningInstances?: boolean;
  enableArchiving?: boolean;
  archiveDirectory?: string;
  archiveRetentionDays?: number;
  storageType?: "memory" | "file";
  storageDirectory?: string;
  logLevel?: LogLevel;
  externalTimerAdapter?: ExternalTimerAdapter | null;
}

/**
 * 应用上下文
 */
export interface AppContext {
  container: AppContainer;
  engine: WorkflowEngine;
}

/**
 * 启动应用
 * 初始化所有组件并设置优雅关闭
 */
export async function bootstrap(
  options: BootstrapOptions = {},
): Promise<AppContext> {
  if (options.logLevel) {
    Logger.setLevel(options.logLevel);
  }
  setExternalTimerAdapter(options.externalTimerAdapter ?? null);
  Logger.info("system", "bootstrap", "Starting application bootstrap...");

  // 1. 验证配置
  let config: AppConfig | undefined;
  if (!options.skipValidation) {
    Logger.debug("system", "bootstrap", "Validating configuration...");
    config = validateAppConfig();
    Logger.debug("system", "bootstrap", "Configuration validated");
  } else {
    // Even in skip mode, parse config for defaults
    config = validateAppConfig();
  }
  if (!options.logLevel) {
    Logger.setLevel(config.engine.logLevel);
  }

  // 2. 创建依赖容器
  const container = await createContainer({
    storageType: options.storageType ?? config.storage.type,
    storageDirectory: options.storageDirectory ?? config.storage.directory,
  });
  setContainer(container);
  configureHeartbeatTracker(container.storage);
  setupNotificationChannelsFromEnv();

  // Install the secret manager used to resolve ${secret:name} in node configs.
  // Unsupported providers throw here rather than silently falling back to env,
  // so a production misconfiguration fails at startup instead of at node run time.
  setSecretManager(SecretManager.createFor(config.secretProvider));

  const enableArchiving = options.enableArchiving ?? config.archive.enabled;
  if (enableArchiving) {
    const archiveManager = new ArchiveManager(
      container.storage,
      options.archiveDirectory ?? config.archive.directory,
      {
        retentionDays:
          options.archiveRetentionDays ?? config.archive.retentionDays,
        cleanupIntervalMs: config.archive.cleanupIntervalMs,
      },
    );
    archiveManager.initialize();
    container.archiveManager = archiveManager;
  }

  if (config.workerPool.enabled) {
    stickyExecutionPolicy.setOptions({
      enabled: config.workerPool.stickyEnabled,
      cacheSize: config.workerPool.stickyCacheSize,
      ttlMs: config.workerPool.stickyTtlMs,
    });
    initWorkerPool({
      minWorkers: config.workerPool.minWorkers,
      maxWorkers: config.workerPool.maxWorkers,
      taskTimeout: config.workerPool.taskTimeoutMs,
      idleTimeout: config.workerPool.idleTimeoutMs,
    });
    Logger.info("system", "bootstrap", "Worker pool initialized");
  }

  if (config.actionSandbox.isolationEnabled) {
    configureActionSandboxIsolation({
      minWorkers: config.actionSandbox.minWorkers,
      maxWorkers: config.actionSandbox.maxWorkers,
      taskTimeoutMs: config.actionSandbox.taskTimeoutMs,
      idleTimeoutMs: config.actionSandbox.idleTimeoutMs,
    });
    Logger.info(
      "system",
      "bootstrap",
      "Action sandbox worker-thread isolation enabled",
    );
  }

  // 3. 创建工作流引擎
  Logger.info("system", "bootstrap", "Using WorkflowEngine");
  const engine = new WorkflowEngine(
    container.storage,
    container.eventBus,
    container.scheduler,
    container.dlq,
    {
      instanceTtlHours: container.config.instanceTtlHours,
      cleanupIntervalMs: container.config.cleanupIntervalMs,
      maxInstances: container.config.maxInstances,
    },
  );

  const resumeRunningInstances =
    options.resumeRunningInstances ??
    (config.api.enabled && config.api.resumeOnStartup);

  await engine.initialize({ resumeRunningInstances });

  // 4. 设置优雅关闭
  if (!options.skipGracefulShutdown) {
    const shutdown = setupGracefulShutdown(container.storage, [
      async () => {
        Logger.info("system", "shutdown", "Stopping engine...");
        engine.destroy();
      },
      async () => {
        Logger.info("system", "shutdown", "Stopping worker pool...");
        await shutdownWorkerPool();
      },
      async () => {
        Logger.info("system", "shutdown", "Stopping action sandbox pool...");
        await shutdownActionSandboxIsolation();
      },
      async () => {
        Logger.info("system", "shutdown", "Stopping scheduler...");
        container.scheduler.stopAll();
      },
      async () => {
        Logger.info("system", "shutdown", "Disposing secret manager...");
        disposeSecretManager();
      },
      async () => {
        Logger.info("system", "shutdown", "Destroying container...");
        await destroyContainer(container);
      },
    ]);
    setShutdownInstance(shutdown);
  }

  Logger.info("system", "bootstrap", "Application bootstrap completed");

  return {
    container,
    engine,
  };
}

/**
 * 加载环境变量
 */
export function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  const exampleEnvPath = path.resolve(process.cwd(), ".env.example");

  if (!fs.existsSync(envPath) && fs.existsSync(exampleEnvPath)) {
    fs.copyFileSync(exampleEnvPath, envPath);
    Logger.info("system", "env", ".env file created from .env.example");
  }

  dotenv.config();
  Logger.debug("system", "env", "Environment variables loaded");
}
