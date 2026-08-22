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

class InMemoryLeaseStore implements LeaseStore {
  private leases = new Map<string, { holderId: string; expiresAt: number }>();
  private renewalTimers = new Map<string, NodeJS.Timeout>();

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
