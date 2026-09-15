import { Logger } from "./Logger";

export interface LeaseStore {
  acquire(key: string, holderId: string, ttlMs: number): Promise<boolean>;
  renew(key: string, holderId: string, ttlMs: number): Promise<boolean>;
  release(key: string, holderId: string): Promise<boolean>;
  startAutoRenewal(
    key: string,
    holderId: string,
    ttlMs: number,
    renewIntervalMs?: number,
  ): () => void;
}

/** 过期 lease 的清扫周期。 */
const LEASE_SWEEP_INTERVAL_MS = 60_000;

class InMemoryLeaseStore implements LeaseStore {
  private leases = new Map<string, { holderId: string; expiresAt: number }>();
  private renewalTimers = new Map<string, NodeJS.Timeout>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor() {
    // 过期 lease 此前只被判定、从不删除，而 CronScheduler 每秒为每个
    // 工作流生成一个新 key（`cron:<workflowId>:<秒桶>`）且从不 release
    // ——Map 只增不减，是全仓最明确的无界内存泄漏。
    this.sweepTimer = setInterval(
      () => this.evictExpired(),
      LEASE_SWEEP_INTERVAL_MS,
    );
    // 不要让清扫定时器阻止进程退出
    this.sweepTimer.unref?.();
  }

  /** 删除所有已过期的 lease，返回删除条数。 */
  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [key, lease] of this.leases) {
      // 仍有续期定时器在跑的 key 不动：那是活跃持有者，
      // 只是恰好卡在两次续期之间。
      if (lease.expiresAt <= now && !this.renewalTimers.has(key)) {
        this.leases.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  /** 当前保存的 lease 数量。用于测试与内存诊断。 */
  get size(): number {
    return this.leases.size;
  }

  /** 停止清扫定时器并释放全部状态。 */
  dispose(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const timer of this.renewalTimers.values()) {
      clearInterval(timer);
    }
    this.renewalTimers.clear();
    this.leases.clear();
  }

  async acquire(
    key: string,
    holderId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(key);
    if (
      existing &&
      existing.expiresAt > now &&
      existing.holderId !== holderId
    ) {
      return false;
    }
    if (existing && existing.expiresAt <= now) {
      // 顺手清掉过期条目，不要留给周期清扫慢慢回收
      this.leases.delete(key);
    }
    this.leases.set(key, { holderId, expiresAt: now + ttlMs });
    return true;
  }

  async renew(key: string, holderId: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const existing = this.leases.get(key);
    if (!existing || existing.expiresAt <= now) {
      return false;
    }
    if (existing.holderId !== holderId) {
      return false;
    }
    existing.expiresAt = now + ttlMs;
    this.leases.set(key, existing);
    return true;
  }

  async release(key: string, holderId: string): Promise<boolean> {
    const existing = this.leases.get(key);
    if (!existing) return true;
    if (existing.holderId !== holderId) return false;
    this.leases.delete(key);

    // Stop auto-renewal timer if exists
    const timer = this.renewalTimers.get(key);
    if (timer) {
      clearInterval(timer);
      this.renewalTimers.delete(key);
    }

    return true;
  }

  startAutoRenewal(
    key: string,
    holderId: string,
    ttlMs: number,
    renewIntervalMs = Math.max(ttlMs * 0.5, 1000),
  ): () => void {
    // Stop any existing renewal for this key
    const existingTimer = this.renewalTimers.get(key);
    if (existingTimer) {
      clearInterval(existingTimer);
    }

    // Start new renewal timer
    const timer = setInterval(async () => {
      const success = await this.renew(key, holderId, ttlMs);
      if (!success) {
        Logger.warn(
          holderId,
          "lease",
          `Failed to renew lease ${key}, lease may have been lost`,
        );
        clearInterval(timer);
        this.renewalTimers.delete(key);
      }
    }, renewIntervalMs);

    // 续期定时器不应阻止进程退出（与 SlaMonitor、ConcurrencyControl
    // 等处已有的做法一致）。
    timer.unref?.();

    this.renewalTimers.set(key, timer);

    // Return cleanup function
    return () => {
      clearInterval(timer);
      this.renewalTimers.delete(key);
    };
  }
}

/**
 * Lease acquisition and auto-renewal are always process-local. The workflow
 * state may be file-backed, but leases are not a cross-process lock.
 */
export function createLeaseStore(): LeaseStore {
  Logger.debug("system", "lease", "Using in-memory lease store");
  return new InMemoryLeaseStore();
}
