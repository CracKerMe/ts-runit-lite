import { Logger } from "../utils/Logger";

export interface StickyWorker {
  workerId: string;
  workflowId: string;
  instanceId: string;
  lastAccessTime: Date;
  cache: Map<string, unknown>;
}

export interface StickyOptions {
  enabled: boolean;
  cacheSize: number;
  ttlMs: number;
}

export class StickyExecutionManager {
  private stickyWorkers: Map<string, StickyWorker> = new Map();
  private instanceWorkerMap: Map<string, string> = new Map();
  private options: StickyOptions = {
    enabled: true,
    cacheSize: 100,
    ttlMs: 60000,
  };

  setOptions(options: Partial<StickyOptions>): void {
    this.options = { ...this.options, ...options };
    Logger.info("system", "sticky", "Sticky execution options updated");
  }

  isEnabled(): boolean {
    return this.options.enabled;
  }

  async tryAssignWorker(
    instanceId: string,
    workflowId: string,
    workerId: string,
  ): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    const existingWorkerId = this.instanceWorkerMap.get(instanceId);
    if (existingWorkerId && existingWorkerId !== workerId) {
      const existingWorker = this.stickyWorkers.get(
        `${workflowId}:${instanceId}:${existingWorkerId}`,
      );
      if (existingWorker) {
        Logger.debug(
          "system",
          "sticky",
          `Instance ${instanceId} already assigned to worker ${existingWorkerId}`,
        );
        return false;
      }
    }

    const key = `${workflowId}:${instanceId}:${workerId}`;
    let stickyWorker = this.stickyWorkers.get(key);

    if (!stickyWorker) {
      stickyWorker = {
        workerId,
        workflowId,
        instanceId,
        lastAccessTime: new Date(),
        cache: new Map(),
      };
      this.stickyWorkers.set(key, stickyWorker);

      this.cleanupOldEntries();
    }

    stickyWorker.lastAccessTime = new Date();
    this.instanceWorkerMap.set(instanceId, workerId);

    Logger.debug(
      "system",
      "sticky",
      `Instance ${instanceId} assigned to worker ${workerId}`,
    );

    return true;
  }

  /**
   * Return the worker an instance is currently bound to, if any.
   * Used by the worker pool to route follow-up tasks back to the same worker.
   */
  getAssignedWorker(instanceId: string): string | undefined {
    if (!this.options.enabled) {
      return undefined;
    }
    return this.instanceWorkerMap.get(instanceId);
  }

  getWorkerCache(
    workflowId: string,
    instanceId: string,
    workerId: string,
  ): Map<string, unknown> | undefined {
    if (!this.options.enabled) {
      return undefined;
    }

    const key = `${workflowId}:${instanceId}:${workerId}`;
    const stickyWorker = this.stickyWorkers.get(key);

    if (!stickyWorker) {
      return undefined;
    }

    const now = Date.now();
    const lastAccess = stickyWorker.lastAccessTime.getTime();
    if (now - lastAccess > this.options.ttlMs) {
      this.clearWorkerCache(workflowId, instanceId, workerId);
      return undefined;
    }

    return stickyWorker.cache;
  }

  setCacheValue(
    workflowId: string,
    instanceId: string,
    workerId: string,
    key: string,
    value: unknown,
  ): void {
    if (!this.options.enabled) return;

    const cache = this.getWorkerCache(workflowId, instanceId, workerId);
    if (!cache) return;

    if (cache.size >= this.options.cacheSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, value);
  }

  clearWorkerCache(
    workflowId: string,
    instanceId: string,
    workerId: string,
  ): void {
    const key = `${workflowId}:${instanceId}:${workerId}`;
    const stickyWorker = this.stickyWorkers.get(key);
    if (stickyWorker) {
      stickyWorker.cache.clear();
    }
    this.instanceWorkerMap.delete(instanceId);
    Logger.debug(
      "system",
      "sticky",
      `Cache cleared for instance ${instanceId}`,
    );
  }

  /**
   * Drop every binding and cache entry for a worker that no longer exists.
   * Instances bound to it become unbound and are free to land anywhere.
   */
  releaseWorker(workerId: string): void {
    // Collect before deleting: mutating a Map while iterating it is unsafe.
    const staleKeys: string[] = [];
    for (const [key, worker] of this.stickyWorkers.entries()) {
      if (worker.workerId === workerId) {
        worker.cache.clear();
        staleKeys.push(key);
      }
    }
    for (const key of staleKeys) {
      this.stickyWorkers.delete(key);
    }

    const staleInstances: string[] = [];
    for (const [instanceId, assigned] of this.instanceWorkerMap.entries()) {
      if (assigned === workerId) {
        staleInstances.push(instanceId);
      }
    }
    for (const instanceId of staleInstances) {
      this.instanceWorkerMap.delete(instanceId);
    }
    const released = staleInstances.length;

    if (released > 0) {
      Logger.debug(
        "system",
        "sticky",
        `Released ${released} instance(s) from worker ${workerId}`,
      );
    }
  }

  unassignWorker(instanceId: string): void {
    const workerId = this.instanceWorkerMap.get(instanceId);
    if (workerId) {
      this.instanceWorkerMap.delete(instanceId);
      Logger.debug(
        "system",
        "sticky",
        `Worker unassigned from instance ${instanceId}`,
      );
    }
  }

  private cleanupOldEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, worker] of this.stickyWorkers.entries()) {
      const lastAccess = worker.lastAccessTime.getTime();
      if (now - lastAccess > this.options.ttlMs) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const worker = this.stickyWorkers.get(key);
      if (worker) {
        this.instanceWorkerMap.delete(worker.instanceId);
        this.stickyWorkers.delete(key);
      }
    }

    if (keysToDelete.length > 0) {
      Logger.debug(
        "system",
        "sticky",
        `Cleaned up ${keysToDelete.length} stale entries`,
      );
    }
  }

  getStats(): {
    totalWorkers: number;
    assignedInstances: number;
    cacheSize: number;
  } {
    let totalCacheSize = 0;
    for (const worker of this.stickyWorkers.values()) {
      totalCacheSize += worker.cache.size;
    }

    return {
      totalWorkers: this.stickyWorkers.size,
      assignedInstances: this.instanceWorkerMap.size,
      cacheSize: totalCacheSize,
    };
  }

  reset(): void {
    this.stickyWorkers.clear();
    this.instanceWorkerMap.clear();
    Logger.info("system", "sticky", "Sticky execution reset");
  }
}

export const stickyExecutionManager = new StickyExecutionManager();
