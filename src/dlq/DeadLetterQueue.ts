// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { StorageProvider } from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";

/**
 * 死信条目
 */
export type DeadLetterStatus =
  | "pending"
  | "retried"
  | "acknowledged"
  | "permanently_failed";

export interface DeadLetterEntry {
  id: string;
  type: "event" | "task" | "workflow";
  payload: any;
  error: string;
  stack?: string;
  failedAt: Date;
  retryCount: number;
  /** 处理状态，默认 pending */
  status?: DeadLetterStatus;
  /** 人工处理备注 */
  notes?: string;
  instanceId?: string;
  nodeId?: string;
  workflowId?: string;
  metadata?: Record<string, any>;
}

/**
 * 死信队列
 * 用于存储处理失败的事件和任务，支持后续重试或人工处理
 */
export class DeadLetterQueue {
  private entries: DeadLetterEntry[] = [];
  /**
   * id -> entry 索引，与 entries 数组保持同步。
   * entries 数组保留插入顺序（push/shift 实现 FIFO 与容量淘汰），
   * 而按 id 查找原本是 O(n) 线性扫描：批量重试 100 条要做数万次比较。
   */
  private entryIndex = new Map<string, DeadLetterEntry>();

  /** 整体替换 entries 后重建索引。 */
  private rebuildIndex(): void {
    this.entryIndex.clear();
    for (const entry of this.entries) {
      this.entryIndex.set(entry.id, entry);
    }
  }
  private readonly maxSize: number;
  private idCounter = 0;
  // The legacy Redis-shaped fields are retained for API compatibility. The
  // lite build persists through StorageProvider (memory or local files).
  private redis?: any;
  private readonly DLQ_IDS_KEY = "workflow:dlq:ids";
  private readonly DLQ_ENTRY_PREFIX = "workflow:dlq:entry:";
  private readonly DLQ_IDS_BY_TYPE_PREFIX = "workflow:dlq:ids:by-type:";
  private readonly DLQ_IDS_BY_WORKFLOW_PREFIX = "workflow:dlq:ids:by-workflow:";
  private storage?: StorageProvider;
  private restorePromise?: Promise<void>;

  constructor(storage?: StorageProvider, maxSize = 1000) {
    this.maxSize = maxSize;
    this.storage = storage;
    // File and memory providers expose the StorageProvider persistence hooks;
    // getClient() is only relevant to legacy Redis-compatible integrations.
    this.redis = storage?.getClient?.();
    if (!this.redis && storage?.loadAllDeadLetterEntries) {
      this.restorePromise = this.restoreFromStorage();
    }
  }

  private async ensureRestored(): Promise<void> {
    await this.restorePromise;
  }

  private async restoreFromStorage(): Promise<void> {
    const stored = await this.storage?.loadAllDeadLetterEntries?.();
    if (!stored) return;
    this.entries = stored.map((value) => {
      const entry = value as DeadLetterEntry;
      return { ...entry, failedAt: new Date(entry.failedAt) };
    });
    this.entries.sort((a, b) => a.failedAt.getTime() - b.failedAt.getTime());
    this.rebuildIndex();
    this.idCounter = this.entries.reduce((max, entry) => {
      const suffix = Number.parseInt(entry.id.split("_").pop() ?? "0", 10);
      return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
    }, 0);
  }

  private async persistEntry(entry: DeadLetterEntry): Promise<void> {
    await this.storage?.saveDeadLetterEntry?.(entry);
  }

  private getEntryKey(id: string): string {
    return `${this.DLQ_ENTRY_PREFIX}${id}`;
  }

  private getTypeIndexKey(type: DeadLetterEntry["type"]): string {
    return `${this.DLQ_IDS_BY_TYPE_PREFIX}${type}`;
  }

  private getWorkflowIndexKey(workflowId: string): string {
    return `${this.DLQ_IDS_BY_WORKFLOW_PREFIX}${workflowId}`;
  }

  private async enforceMaxSizeRedis(): Promise<void> {
    if (!this.redis) return;
    const total = await this.redis.zcard(this.DLQ_IDS_KEY);
    if (total <= this.maxSize) return;
    const toRemove = total - this.maxSize;
    const ids = await this.redis.zrange(this.DLQ_IDS_KEY, 0, toRemove - 1);
    for (const id of ids) {
      await this.remove(id);
    }
  }

  /**
   * 添加死信条目
   */
  async push(entry: Omit<DeadLetterEntry, "id" | "failedAt">): Promise<string> {
    await this.ensureRestored();
    const id = `dlq_${Date.now()}_${++this.idCounter}`;
    const fullEntry: DeadLetterEntry = {
      ...entry,
      id,
      failedAt: new Date(),
    };

    if (this.redis) {
      const score = fullEntry.failedAt.getTime();
      const entryKey = this.getEntryKey(id);
      const pipeline = this.redis.pipeline();
      pipeline.set(entryKey, JSON.stringify(fullEntry));
      pipeline.zadd(this.DLQ_IDS_KEY, score, id);
      pipeline.zadd(this.getTypeIndexKey(fullEntry.type), score, id);
      if (fullEntry.workflowId) {
        pipeline.zadd(
          this.getWorkflowIndexKey(fullEntry.workflowId),
          score,
          id,
        );
      }
      await pipeline.exec();
      await this.enforceMaxSizeRedis();

      Logger.info("system", "dlq", `Added entry to DLQ: ${id}`, {
        type: entry.type,
        error: entry.error,
        instanceId: entry.instanceId,
      });
      return id;
    }

    // 如果超过最大容量，移除最旧的条目
    if (this.entries.length >= this.maxSize) {
      const removed = this.entries.shift();
      if (removed) {
        this.entryIndex.delete(removed.id);
        await this.storage?.deleteDeadLetterEntry?.(removed.id);
        Logger.warn(
          "system",
          "dlq",
          `DLQ capacity exceeded, removed oldest entry: ${removed.id}`,
        );
      }
    }

    this.entries.push(fullEntry);
    this.entryIndex.set(fullEntry.id, fullEntry);
    await this.persistEntry(fullEntry);
    Logger.info("system", "dlq", `Added entry to DLQ: ${id}`, {
      type: entry.type,
      error: entry.error,
      instanceId: entry.instanceId,
    });

    return id;
  }

  /**
   * 获取并移除最旧的条目
   */
  async pop(): Promise<DeadLetterEntry | null> {
    await this.ensureRestored();
    if (this.redis) {
      const ids = await this.redis.zrange(this.DLQ_IDS_KEY, 0, 0);
      const id = ids[0];
      if (!id) return null;
      const entry = await this.get(id);
      if (!entry) return null;
      await this.remove(id);
      return entry;
    }
    const entry = this.entries.shift();
    if (entry) {
      this.entryIndex.delete(entry.id);
      await this.storage?.deleteDeadLetterEntry?.(entry.id);
      Logger.debug("system", "dlq", `Popped entry from DLQ: ${entry.id}`);
    }
    return entry || null;
  }

  /**
   * 获取指定条目（不移除）
   */
  async get(id: string): Promise<DeadLetterEntry | null> {
    await this.ensureRestored();
    if (this.redis) {
      const data = await this.redis.get(this.getEntryKey(id));
      if (!data) return null;
      const parsed = JSON.parse(data) as DeadLetterEntry;
      parsed.failedAt = new Date(parsed.failedAt);
      return parsed;
    }
    return this.entryIndex.get(id) ?? null;
  }

  /**
   * 列出所有条目
   */
  async list(
    options: {
      limit?: number;
      offset?: number;
      type?: "event" | "task" | "workflow";
      workflowId?: string;
    } = {},
  ): Promise<{ entries: DeadLetterEntry[]; total: number }> {
    await this.ensureRestored();
    if (this.redis) {
      const offset = options.offset || 0;
      const limit = options.limit || 100;
      const indexKey = options.workflowId
        ? this.getWorkflowIndexKey(options.workflowId)
        : options.type
          ? this.getTypeIndexKey(options.type)
          : this.DLQ_IDS_KEY;

      const total = await this.redis.zcard(indexKey);
      const ids = await this.redis.zrevrange(
        indexKey,
        offset,
        offset + limit - 1,
      );
      if (ids.length === 0) return { entries: [], total };

      const keys = ids.map((id: string) => this.getEntryKey(id));
      const raw = await this.redis.mget(...keys);
      const entries: DeadLetterEntry[] = [];
      raw.forEach((value: string | null, i: number) => {
        if (!value) return;
        const parsed = JSON.parse(value) as DeadLetterEntry;
        parsed.failedAt = new Date(parsed.failedAt);
        entries.push(parsed);
        if (!parsed.id) {
          parsed.id = ids[i];
        }
      });
      return { entries, total };
    }

    let filtered = this.entries;

    if (options.type) {
      filtered = filtered.filter((e) => e.type === options.type);
    }
    if (options.workflowId) {
      filtered = filtered.filter((e) => e.workflowId === options.workflowId);
    }

    const total = filtered.length;
    const offset = options.offset || 0;
    const limit = options.limit || 100;

    return {
      entries: filtered.slice(offset, offset + limit),
      total,
    };
  }

  /**
   * 删除指定条目
   */
  async remove(id: string): Promise<boolean> {
    await this.ensureRestored();
    if (this.redis) {
      const entry = await this.get(id);
      const pipeline = this.redis.pipeline();
      pipeline.del(this.getEntryKey(id));
      pipeline.zrem(this.DLQ_IDS_KEY, id);
      if (entry) {
        pipeline.zrem(this.getTypeIndexKey(entry.type), id);
        if (entry.workflowId) {
          pipeline.zrem(this.getWorkflowIndexKey(entry.workflowId), id);
        }
      }
      await pipeline.exec();
      Logger.debug("system", "dlq", `Removed entry from DLQ: ${id}`);
      return true;
    }

    if (!this.entryIndex.has(id)) {
      return false;
    }
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) {
      this.entryIndex.delete(id);
      return false;
    }
    this.entries.splice(index, 1);
    this.entryIndex.delete(id);
    await this.storage?.deleteDeadLetterEntry?.(id);
    Logger.debug("system", "dlq", `Removed entry from DLQ: ${id}`);
    return true;
  }

  /**
   * 清空所有条目
   */
  async clear(): Promise<number> {
    await this.ensureRestored();
    if (this.redis) {
      const ids = await this.redis.zrange(this.DLQ_IDS_KEY, 0, -1);
      if (ids.length === 0) return 0;
      const keys = ids.map((id: string) => this.getEntryKey(id));
      const pipeline = this.redis.pipeline();
      pipeline.del(...keys);
      pipeline.del(this.DLQ_IDS_KEY);
      pipeline.del(
        this.getTypeIndexKey("event"),
        this.getTypeIndexKey("task"),
        this.getTypeIndexKey("workflow"),
      );
      // Best-effort cleanup for workflow index keys
      const workflowIndexKeys = await this.redis.keys(
        `${this.DLQ_IDS_BY_WORKFLOW_PREFIX}*`,
      );
      if (workflowIndexKeys.length > 0) {
        pipeline.del(...workflowIndexKeys);
      }
      await pipeline.exec();

      Logger.info("system", "dlq", `Cleared ${ids.length} entries from DLQ`);
      return ids.length;
    }

    const count = this.entries.length;
    await Promise.all(
      this.entries.map((entry) =>
        this.storage?.deleteDeadLetterEntry?.(entry.id),
      ),
    );
    this.entries = [];
    this.entryIndex.clear();
    Logger.info("system", "dlq", `Cleared ${count} entries from DLQ`);
    return count;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byWorkflow: Record<string, number>;
  }> {
    await this.ensureRestored();
    if (this.redis) {
      const [total, eventCount, taskCount, workflowCount] = await Promise.all([
        this.redis.zcard(this.DLQ_IDS_KEY),
        this.redis.zcard(this.getTypeIndexKey("event")),
        this.redis.zcard(this.getTypeIndexKey("task")),
        this.redis.zcard(this.getTypeIndexKey("workflow")),
      ]);

      const byWorkflow: Record<string, number> = {};
      const workflowIndexKeys = await this.redis.keys(
        `${this.DLQ_IDS_BY_WORKFLOW_PREFIX}*`,
      );
      for (const key of workflowIndexKeys) {
        const workflowId = key.slice(this.DLQ_IDS_BY_WORKFLOW_PREFIX.length);
        const count = await this.redis.zcard(key);
        byWorkflow[workflowId] = count;
      }

      return {
        total,
        byType: {
          event: eventCount,
          task: taskCount,
          workflow: workflowCount,
        },
        byWorkflow,
      };
    }
    const byType: Record<string, number> = {};
    const byWorkflow: Record<string, number> = {};

    for (const entry of this.entries) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
      if (entry.workflowId) {
        byWorkflow[entry.workflowId] = (byWorkflow[entry.workflowId] || 0) + 1;
      }
    }

    return {
      total: this.entries.length,
      byType,
      byWorkflow,
    };
  }

  /**
   * 更新条目处理状态
   */
  async updateStatus(
    id: string,
    status: DeadLetterStatus,
    notes?: string,
  ): Promise<boolean> {
    await this.ensureRestored();
    if (this.redis) {
      const entry = await this.get(id);
      if (!entry) return false;
      entry.status = status;
      if (notes !== undefined) entry.notes = notes;
      await this.redis.set(this.getEntryKey(id), JSON.stringify(entry));
      Logger.info("system", "dlq", `Updated entry status: ${id} -> ${status}`);
      return true;
    }

    const entry = this.entryIndex.get(id);
    if (!entry) return false;
    entry.status = status;
    if (notes !== undefined) entry.notes = notes;
    await this.persistEntry(entry);
    Logger.info("system", "dlq", `Updated entry status: ${id} -> ${status}`);
    return true;
  }

  /**
   * 增加重试计数
   */
  async incrementRetry(id: string): Promise<number> {
    await this.ensureRestored();
    if (this.redis) {
      const entry = await this.get(id);
      if (!entry) {
        throw new Error(`DLQ entry not found: ${id}`);
      }
      entry.retryCount++;
      await this.redis.set(this.getEntryKey(id), JSON.stringify(entry));
      return entry.retryCount;
    }

    const entry = this.entryIndex.get(id);
    if (!entry) {
      throw new Error(`DLQ entry not found: ${id}`);
    }
    entry.retryCount++;
    await this.persistEntry(entry);
    return entry.retryCount;
  }
}

// 全局死信队列实例
let dlqInstance: DeadLetterQueue | null = null;

export function getDLQ(): DeadLetterQueue {
  if (!dlqInstance) {
    dlqInstance = new DeadLetterQueue();
  }
  return dlqInstance;
}

export function setDLQ(dlq: DeadLetterQueue): void {
  dlqInstance = dlq;
}
