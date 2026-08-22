import { getAppConfig } from "../config/AppConfig";
import { Logger } from "../utils/Logger";

/**
 * 并发控制配置
 */
export interface ConcurrencyConfig {
  maxConcurrentInstances?: number; // 最大并发实例数
  maxConcurrentNodesPerInstance?: number; // 每个实例最大并发节点数
  lockTimeout?: number; // 锁超时时间（毫秒）
  retryDelay?: number; // 重试延迟（毫秒）
  maxRetries?: number; // 最大重试次数
}

/**
 * 锁信息
 */
interface LockInfo {
  holder: string;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * 并发控制器
 * 提供分布式锁和并发限制功能
 */
export class ConcurrencyControl {
  private locks = new Map<string, LockInfo>();
  private semaphores = new Map<string, number>();
  private config: Required<ConcurrencyConfig>;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: ConcurrencyConfig = {}) {
    this.config = {
      maxConcurrentInstances: config.maxConcurrentInstances ?? 100,
      maxConcurrentNodesPerInstance: config.maxConcurrentNodesPerInstance ?? 10,
      lockTimeout: config.lockTimeout ?? 30000,
      retryDelay: config.retryDelay ?? 100,
      maxRetries: config.maxRetries ?? 50,
    };

    // 定期清理过期锁
    this.cleanupInterval = setInterval(() => this.cleanupExpiredLocks(), 10000);
  }

  /**
   * 获取锁
   */
  async acquireLock(
    resourceId: string,
    holderId: string,
    timeout?: number,
  ): Promise<boolean> {
    const lockTimeout = timeout ?? this.config.lockTimeout;
    const now = Date.now();

    // 检查现有锁
    const existingLock = this.locks.get(resourceId);
    if (existingLock) {
      // 检查锁是否过期
      if (existingLock.expiresAt > now) {
        // 锁仍然有效
        if (existingLock.holder === holderId) {
          // 同一持有者，续期
          existingLock.expiresAt = now + lockTimeout;
          return true;
        }
        return false;
      }
      // 锁已过期，可以获取
    }

    // 获取锁
    this.locks.set(resourceId, {
      holder: holderId,
      acquiredAt: now,
      expiresAt: now + lockTimeout,
    });

    Logger.debug(
      "system",
      "lock",
      `Lock acquired: ${resourceId} by ${holderId}`,
    );
    return true;
  }

  /**
   * 释放锁
   */
  releaseLock(resourceId: string, holderId: string): boolean {
    const lock = this.locks.get(resourceId);
    if (!lock) {
      return true; // 锁不存在，视为已释放
    }

    if (lock.holder !== holderId) {
      Logger.warn(
        "system",
        "lock",
        `Cannot release lock ${resourceId}: held by ${lock.holder}, not ${holderId}`,
      );
      return false;
    }

    this.locks.delete(resourceId);
    Logger.debug(
      "system",
      "lock",
      `Lock released: ${resourceId} by ${holderId}`,
    );
    return true;
  }

  /**
   * 带重试的锁获取
   */
  async acquireLockWithRetry(
    resourceId: string,
    holderId: string,
    timeout?: number,
  ): Promise<boolean> {
    for (let i = 0; i < this.config.maxRetries; i++) {
      if (await this.acquireLock(resourceId, holderId, timeout)) {
        return true;
      }
      await this.delay(this.config.retryDelay);
    }

    Logger.warn(
      "system",
      "lock",
      `Failed to acquire lock ${resourceId} after ${this.config.maxRetries} retries`,
    );
    return false;
  }

  /**
   * 执行带锁的操作
   */
  async withLock<T>(
    resourceId: string,
    holderId: string,
    operation: () => Promise<T>,
    timeout?: number,
  ): Promise<T> {
    const acquired = await this.acquireLockWithRetry(
      resourceId,
      holderId,
      timeout,
    );
    if (!acquired) {
      throw new Error(`Failed to acquire lock for resource: ${resourceId}`);
    }

    try {
      return await operation();
    } finally {
      this.releaseLock(resourceId, holderId);
    }
  }

  /**
   * 获取信号量（用于限制并发数）
   */
  async acquireSemaphore(
    name: string,
    maxConcurrent: number,
  ): Promise<boolean> {
    const current = this.semaphores.get(name) ?? 0;
    if (current >= maxConcurrent) {
      return false;
    }
    this.semaphores.set(name, current + 1);
    return true;
  }

  /**
   * 释放信号量
   */
  releaseSemaphore(name: string): void {
    const current = this.semaphores.get(name) ?? 0;
    if (current > 0) {
      this.semaphores.set(name, current - 1);
    }
  }

  /**
   * 带重试的信号量获取
   */
  async acquireSemaphoreWithRetry(
    name: string,
    maxConcurrent: number,
  ): Promise<boolean> {
    for (let i = 0; i < this.config.maxRetries; i++) {
      if (await this.acquireSemaphore(name, maxConcurrent)) {
        return true;
      }
      await this.delay(this.config.retryDelay);
    }
    return false;
  }

  /**
   * 检查是否可以启动新实例
   */
  canStartInstance(): boolean {
    const current = this.semaphores.get("instances") ?? 0;
    return current < this.config.maxConcurrentInstances;
  }

  /**
   * 注册实例启动
   */
  registerInstanceStart(): boolean {
    return this.acquireSemaphore(
      "instances",
      this.config.maxConcurrentInstances,
    ) as unknown as boolean;
  }

  /**
   * 注册实例完成
   */
  registerInstanceComplete(): void {
    this.releaseSemaphore("instances");
  }

  /**
   * 获取解析后的配置（用于其他模块读取默认并发限制）
   */
  getConfig(): Readonly<Required<ConcurrencyConfig>> {
    return this.config;
  }

  /**
   * 获取当前并发统计
   */
  getStats(): {
    activeLocks: number;
    activeInstances: number;
    semaphores: Record<string, number>;
  } {
    return {
      activeLocks: this.locks.size,
      activeInstances: this.semaphores.get("instances") ?? 0,
      semaphores: Object.fromEntries(this.semaphores),
    };
  }

  /**
   * 清理过期锁
   */
  private cleanupExpiredLocks(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [resourceId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(resourceId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.debug("system", "lock", `Cleaned up ${cleaned} expired locks`);
    }
  }

  /**
   * 延迟辅助函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 销毁并发控制器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.locks.clear();
    this.semaphores.clear();
  }
}

// 全局并发控制器实例
let concurrencyControlInstance: ConcurrencyControl | null = null;

export function getConcurrencyControl(): ConcurrencyControl {
  if (!concurrencyControlInstance) {
    // Prefer the validated AppConfig (parses MAX_CONCURRENT_INSTANCES /
    // MAX_CONCURRENT_NODES / LOCK_TIMEOUT_MS), falling back to raw env vars
    // when AppConfig hasn't been initialized yet (e.g. in isolated tests).
    try {
      const { resources } = getAppConfig();
      concurrencyControlInstance = new ConcurrencyControl({
        maxConcurrentInstances: resources.maxConcurrentInstances,
        maxConcurrentNodesPerInstance: resources.maxConcurrentNodesPerInstance,
        lockTimeout: resources.lockTimeoutMs,
      });
    } catch {
      concurrencyControlInstance = new ConcurrencyControl({
        maxConcurrentInstances: Number.parseInt(
          process.env.MAX_CONCURRENT_INSTANCES || "100",
          10,
        ),
        maxConcurrentNodesPerInstance: Number.parseInt(
          process.env.MAX_CONCURRENT_NODES || "10",
          10,
        ),
        lockTimeout: Number.parseInt(
          process.env.LOCK_TIMEOUT_MS || "30000",
          10,
        ),
      });
    }
  }
  return concurrencyControlInstance;
}

export function setConcurrencyControl(control: ConcurrencyControl): void {
  concurrencyControlInstance = control;
}
