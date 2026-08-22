export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

/**
 * 限流计数存储抽象：hit 为原子的"计数并判定"
 */
export interface RateLimitStore {
  hit(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitResult>;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * 内存固定窗口限流（单进程）
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private lastCleanup = Date.now();

  async hit(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    this.maybeCleanup(now, windowMs);

    const entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      this.store.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs,
      };
    }

    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetTime: entry.resetTime,
    };
  }

  private maybeCleanup(now: number, windowMs: number): void {
    if (now - this.lastCleanup < windowMs) return;
    this.lastCleanup = now;
    for (const [key, entry] of this.store) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}
