import { parseEnvInt } from "../utils/env";
import { Logger } from "../utils/Logger";

/**
 * 事件去重器
 * 用于防止同一事件被重复处理
 */
export class EventDeduplicator {
  private processedEvents = new Map<string, number>();
  private readonly ttlMs: number;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(ttlSeconds = 86400) {
    this.ttlMs = ttlSeconds * 1000;
    this.startCleanup();
  }

  /**
   * 检查事件是否重复
   * @returns true 表示是重复事件，应跳过处理
   */
  isDuplicate(eventId: string): boolean {
    const now = Date.now();
    const existingTime = this.processedEvents.get(eventId);

    if (existingTime && now - existingTime < this.ttlMs) {
      Logger.debug("system", "dedup", `Duplicate event detected: ${eventId}`);
      return true;
    }

    // 标记为已处理
    this.processedEvents.set(eventId, now);
    return false;
  }

  /**
   * 手动标记事件为已处理
   */
  markProcessed(eventId: string): void {
    this.processedEvents.set(eventId, Date.now());
  }

  /**
   * 清除事件记录（用于重试场景）
   */
  clearEvent(eventId: string): void {
    this.processedEvents.delete(eventId);
  }

  /**
   * 启动定期清理
   */
  private startCleanup(): void {
    // 每小时清理过期记录
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 3600000);
  }

  /**
   * 清理过期的事件记录
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [eventId, timestamp] of this.processedEvents) {
      if (now - timestamp > this.ttlMs) {
        this.processedEvents.delete(eventId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.debug(
        "system",
        "dedup",
        `Cleaned up ${cleaned} expired event records`,
      );
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalRecords: number; oldestRecordAge: number } {
    let oldestAge = 0;
    const now = Date.now();

    for (const timestamp of this.processedEvents.values()) {
      const age = now - timestamp;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      totalRecords: this.processedEvents.size,
      oldestRecordAge: Math.floor(oldestAge / 1000),
    };
  }

  /**
   * 销毁去重器
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.processedEvents.clear();
  }
}

/**
 * 异步事件去重器接口
 * isDuplicate 为原子的"检查并标记"：首次调用返回 false 并占用该 eventId，
 * TTL 内的后续调用（包括其他节点）返回 true。
 */
export interface AsyncEventDeduplicator {
  isDuplicate(eventId: string): Promise<boolean>;
  clearEvent(eventId: string): Promise<void>;
  destroy(): void;
}

/**
 * 内存异步去重器（包装现有 EventDeduplicator，单进程语义不变）
 */
export class MemoryAsyncDeduplicator implements AsyncEventDeduplicator {
  private readonly inner: EventDeduplicator;

  constructor(ttlSeconds?: number) {
    this.inner = new EventDeduplicator(ttlSeconds ?? getDedupTtlSeconds());
  }

  async isDuplicate(eventId: string): Promise<boolean> {
    return this.inner.isDuplicate(eventId);
  }

  async clearEvent(eventId: string): Promise<void> {
    this.inner.clearEvent(eventId);
  }

  destroy(): void {
    this.inner.destroy();
  }
}

function getDedupTtlSeconds(): number {
  return parseEnvInt(process.env.EVENT_DEDUP_TTL_SECONDS, 86_400, { min: 1 });
}

/**
 * 创建去重器。本精简版只提供单进程内存去重（无分布式/Redis 存储）。
 */
export function createDeduplicator(): AsyncEventDeduplicator {
  return new MemoryAsyncDeduplicator();
}

// 全局去重器实例
let deduplicatorInstance: EventDeduplicator | null = null;

/** @deprecated 使用 createDeduplicator(storage) 获取跨节点安全的异步去重器 */
export function getDeduplicator(): EventDeduplicator {
  if (!deduplicatorInstance) {
    const ttl = Number.parseInt(
      process.env.EVENT_DEDUP_TTL_SECONDS || "86400",
      10,
    );
    deduplicatorInstance = new EventDeduplicator(ttl);
  }
  return deduplicatorInstance;
}

/** @deprecated 使用 createDeduplicator(storage) 获取跨节点安全的异步去重器 */
export function setDeduplicator(dedup: EventDeduplicator): void {
  deduplicatorInstance = dedup;
}
