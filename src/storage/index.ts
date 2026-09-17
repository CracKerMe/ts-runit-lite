import { Logger } from "../utils/Logger";

export { MemoryStorage } from "./MemoryStorage";
export {
  LocalFileStorage,
  type LocalFileStorageOptions,
} from "./LocalFileStorage";
export type {
  CleanupStorage,
  EventHistoryStorage,
  EventQueryParams,
  EventRecord,
  EventWaitingState,
  FullStorageProvider,
  HeartbeatState,
  HeartbeatStorage,
  InstanceMetrics,
  InstanceQueryParams,
  InstanceSortField,
  InstanceSortOrder,
  MetricsStorage,
  NodeMetrics,
  StorageCore,
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
  WebhookStorage,
  WorkflowMetadataStorage,
} from "./StorageProvider";
export type { DlqStorage } from "./StorageProvider";
export {
  createPostgresStorageAdapter,
  createSqliteStorageAdapter,
  registerDatabaseStorageAdapters,
} from "./database-adapters";
export {
  createStorageFromRegistry,
  listStorageAdapters,
  registerStorageAdapter,
  type StorageFactory,
  unregisterStorageAdapter,
} from "./registry";
export { registerBuiltinStorageAdapters } from "./builtin-adapters";
export {
  type CacheStorageMiddlewareOptions,
  withStorageCache,
  withStorageMetrics,
} from "./middleware";

import { MemoryStorage } from "./MemoryStorage";
import { LocalFileStorage } from "./LocalFileStorage";
import type { StorageProvider } from "./StorageProvider";

/** @deprecated Use `.ts-workflow-engine-data` as the default directory. */
const LEGACY_DEFAULT_DIR = ".ts-workflow-engine-data";
const DEFAULT_DIR = ".ts-workflow-engine-data";

/**
 * 创建存储实例
 * 默认使用本地文件存储；测试或临时任务可显式选择内存存储。
 * 两种实现都面向单进程部署，不提供跨进程协调。
 */
export async function createStorage(options?: {
  type?: "memory" | "file";
  directory?: string;
  fsyncOnWrite?: boolean;
}): Promise<StorageProvider> {
  const type =
    options?.type ??
    (process.env.STORAGE_TYPE as "memory" | "file" | undefined) ??
    (process.env.NODE_ENV === "test" ? "memory" : "file");

  if (type === "file") {
    let directory =
      options?.directory ?? process.env.STORAGE_DIR ?? DEFAULT_DIR;

    // Backward compatibility: detect legacy directory and warn
    if (
      directory === DEFAULT_DIR &&
      !options?.directory &&
      !process.env.STORAGE_DIR
    ) {
      try {
        const fs = await import("node:fs");
        if (fs.existsSync(LEGACY_DEFAULT_DIR) && !fs.existsSync(DEFAULT_DIR)) {
          Logger.warn(
            "system",
            "storage",
            `Legacy storage directory "${LEGACY_DEFAULT_DIR}" detected. ` +
              `Rename it to "${DEFAULT_DIR}" or set STORAGE_DIR. ` +
              `Run: npx tsx scripts/migrate-storage-dir.ts`,
          );
          directory = LEGACY_DEFAULT_DIR;
        }
      } catch {
        // fs import failed — ignore, use default
      }
    }

    const fsyncOnWrite =
      options?.fsyncOnWrite ?? process.env.FSYNC_ON_WRITE === "true";
    Logger.info(
      "system",
      "storage",
      `Using local file storage: ${directory}${fsyncOnWrite ? " (fsync on write)" : ""}`,
    );
    const storage = new LocalFileStorage({ directory, fsyncOnWrite });
    await storage.connect();
    return storage;
  }

  Logger.info("system", "storage", "Using memory storage");
  const storage = new MemoryStorage();
  await storage.connect();
  return storage;
}

/**
 * 存储类型枚举
 */
export enum StorageType {
  MEMORY = "memory",
  FILE = "file",
}

/**
 * 获取当前存储类型
 */
export function getStorageType(storage: StorageProvider): StorageType {
  return storage instanceof LocalFileStorage
    ? StorageType.FILE
    : StorageType.MEMORY;
}
