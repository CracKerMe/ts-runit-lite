import { Logger } from "../utils/Logger";

export { MemoryStorage } from "./MemoryStorage";
export {
  LocalFileStorage,
  type LocalFileStorageOptions,
} from "./LocalFileStorage";
export type {
  EventQueryParams,
  EventRecord,
  EventWaitingState,
  InstanceMetrics,
  InstanceQueryParams,
  NodeMetrics,
  StorageProvider,
  StoredWorkflow,
} from "./StorageProvider";

import { MemoryStorage } from "./MemoryStorage";
import { LocalFileStorage } from "./LocalFileStorage";
import type { StorageProvider } from "./StorageProvider";

/**
 * 创建存储实例
 * 默认使用本地文件存储；测试或临时任务可显式选择内存存储。
 * 两种实现都面向单进程部署，不提供跨进程协调。
 */
export async function createStorage(options?: {
  type?: "memory" | "file";
  directory?: string;
}): Promise<StorageProvider> {
  const type =
    options?.type ??
    (process.env.STORAGE_TYPE as "memory" | "file" | undefined) ??
    (process.env.NODE_ENV === "test" ? "memory" : "file");

  if (type === "file") {
    const directory =
      options?.directory ?? process.env.STORAGE_DIR ?? ".ts-runit-data";
    Logger.info("system", "storage", `Using local file storage: ${directory}`);
    const storage = new LocalFileStorage(directory);
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
