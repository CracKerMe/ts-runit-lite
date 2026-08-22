import type { WorkflowInstance } from "../model/Instance";
import type { StorageProvider } from "../storage/StorageProvider";
import { errorStack, Logger } from "../utils/Logger";
import { searchAttributeManager } from "./SearchAttributeManager";

/**
 * 生命周期管理器
 * 负责实例清理、资源释放和生命周期管理
 */
export class LifecycleManager {
  private cleanupInterval?: NodeJS.Timeout;
  private lastEventCleanup = Date.now();

  constructor(
    private storage: StorageProvider | undefined,
    private config: {
      instanceTtlHours: number;
      cleanupIntervalMs: number;
      eventRetentionDays?: number;
    },
  ) {}

  private toEpochMs(value: unknown): number {
    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return 0;
  }

  /**
   * 启动自动清理机制
   */
  start(getInstances: () => Map<string, WorkflowInstance>): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleInstances(getInstances());
      this.cleanupStorageResources();
    }, this.config.cleanupIntervalMs);

    Logger.debug(
      "system",
      "lifecycle",
      `Instance cleanup scheduled every ${this.config.cleanupIntervalMs}ms`,
    );
  }

  /**
   * 清理过期实例
   */
  cleanupStaleInstances(instances: Map<string, WorkflowInstance>): number {
    const threshold =
      Date.now() - this.config.instanceTtlHours * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [id, instance] of instances) {
      const isCompleted =
        instance.status === "completed" || instance.status === "failed";
      const isStale = this.toEpochMs(instance.updatedAt) < threshold;

      if (isCompleted && isStale) {
        instances.delete(id);
        searchAttributeManager.removeIndex(id);
        if (typeof this.storage?.deleteInstance === "function") {
          void this.storage.deleteInstance(id).catch((error: unknown) => {
            Logger.error(
              "system",
              "cleanup",
              `Failed to delete stale instance ${id} from storage`,
              errorStack(error),
            );
          });
        }
        cleaned++;
        Logger.debug("system", "cleanup", `Cleaned up stale instance ${id}`);
      }
    }

    if (cleaned > 0) {
      Logger.info("system", "cleanup", `Cleaned up ${cleaned} stale instances`);
    }

    return cleaned;
  }

  /**
   * 清理存储资源（事件、heartbeats等）
   */
  private async cleanupStorageResources(): Promise<void> {
    if (!this.storage) return;

    try {
      // Cleanup expired heartbeats
      await this.storage.cleanupExpiredHeartbeats?.();

      // Cleanup stale events every 6 hours
      const sixHoursMs = 6 * 60 * 60 * 1000;
      if (Date.now() - this.lastEventCleanup > sixHoursMs) {
        const retentionDays = this.config.eventRetentionDays ?? 90;
        await this.storage.cleanupStaleEvents?.(retentionDays);
        this.lastEventCleanup = Date.now();
      }
    } catch (error: unknown) {
      Logger.error(
        "system",
        "cleanup",
        "Failed to clean up storage resources",
        errorStack(error),
      );
    }
  }

  /**
   * 停止清理机制并释放资源
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    Logger.debug("system", "lifecycle", "LifecycleManager destroyed");
  }
}
