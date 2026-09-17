// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { WorkflowInstance } from "../model/Instance";
import type { StorageProvider } from "../storage/StorageProvider";
import { mapWithConcurrency } from "../utils/concurrency";
import { Logger } from "../utils/Logger";
import { ConcurrencyConflictError } from "./errors";
import { searchAttributeTracker } from "./SearchAttributeTracker";

/**
 * 实例管理器
 * 负责工作流实例的 CRUD 操作和存储同步
 */
export class InstanceManager {
  private instances = new Map<string, WorkflowInstance>();
  private instanceCounter = 0;

  constructor(private storage?: StorageProvider) {}

  get storageProvider(): StorageProvider | undefined {
    return this.storage;
  }

  /**
   * 创建新实例
   */
  async createInstance(
    workflowId: string,
    startNode: string,
    context: Record<string, any> = {},
    workflowVersion?: string,
    searchAttributes?: Record<string, string | number | boolean>,
    parentInstanceId?: string,
    tenantId?: string,
  ): Promise<WorkflowInstance> {
    const instanceId = this.generateInstanceId(workflowId);
    const instance: WorkflowInstance = {
      instanceId,
      workflowId,
      workflowVersion,
      currentNodes: [startNode],
      status: "pending",
      context: { ...context },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      retries: {},
      version: 1,
      ...(searchAttributes ? { searchAttributes } : {}),
      ...(parentInstanceId
        ? { parentInstanceId, triggeredBy: "subworkflow" as const }
        : {}),
      ...(tenantId ? { tenantId } : {}),
    };

    this.instances.set(instanceId, instance);
    this.syncSearchIndex(instance);

    // 保存到存储
    if (this.storage) {
      try {
        await this.storage.saveInstance(instance);
      } catch (error) {
        Logger.error(
          instanceId,
          "system",
          "Failed to save instance to storage",
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return instance;
  }

  private generateInstanceId(workflowId: string): string {
    const sequence = this.instanceCounter++;
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `${workflowId}_${timestamp}_${sequence}_${random}`;
  }

  /**
   * 获取实例
   */
  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * 将实例的 searchAttributes 与状态同步到搜索索引。
   * 未注册的属性会按值类型自动注册为定义，以便可被检索。
   */
  private syncSearchIndex(instance: WorkflowInstance): void {
    const attributes = instance.searchAttributes ?? {};

    for (const [key, value] of Object.entries(attributes)) {
      if (!searchAttributeTracker.getDefinition(key)) {
        const type =
          typeof value === "boolean"
            ? "bool"
            : typeof value === "number"
              ? "double"
              : "keyword";
        searchAttributeTracker.registerAttribute({ name: key, type });
      }
    }

    searchAttributeTracker.index(instance.instanceId, attributes, {
      workflowId: instance.workflowId,
      status: instance.status,
    });
  }

  /**
   * 从内存与搜索索引中移除实例（供生命周期清理调用）
   */
  removeInstance(instanceId: string): void {
    this.instances.delete(instanceId);
    searchAttributeTracker.removeIndex(instanceId);
  }

  /**
   * 用一份新的快照替换内存中的实例，并同步搜索索引。
   *
   * 控制操作（pause/resume/cancel）此前直接 `getInstancesMap().set(...)`
   * 写内部 Map，绕过了索引同步——实例状态改了，但按 status 搜索到的还是
   * 旧值。任何需要"就地换掉某个实例"的地方都应该走这里，而不是拿着活
   * Map 自己写。
   */
  replaceInstance(instance: WorkflowInstance): void {
    this.instances.set(instance.instanceId, instance);
    this.syncSearchIndex(instance);
  }

  /**
   * 更新实例（使用 CAS 乐观并发控制）
   * 如果版本不匹配，会从存储重新加载并重试
   */
  async updateInstance(
    instance: WorkflowInstance,
    maxRetries = 3,
  ): Promise<void> {
    instance.updatedAt = new Date();

    // 先更新内存
    this.instances.set(instance.instanceId, instance);
    this.syncSearchIndex(instance);

    // 同步到存储（使用 CAS）
    if (this.storage) {
      let retries = maxRetries;
      let currentVersion = instance.version ?? 1;
      let lastKnownGood: WorkflowInstance | undefined;

      let attempt = 0;
      while (retries-- > 0) {
        try {
          // 在副本上设置版本号，不要改写调用方的对象：CAS 失败后，
          // 调用方持有的引用会带着一个从未持久化的 version，而下面的
          // lastKnownGood 回滚只能修 Map 条目，修不了那个悬空引用。
          const candidate: WorkflowInstance = {
            ...instance,
            version: currentVersion,
          };
          const success = await this.storage.casUpdateInstance(candidate);
          if (success) {
            // CAS 成功：写入存储时用的是 currentVersion，存储侧会将其递增为 currentVersion+1
            // 内存中同步为相同的新版本，避免内存与存储分叉
            candidate.version = currentVersion + 1;
            // 成功后才把版本号写回调用方对象，使其与已持久化的状态一致
            instance.version = currentVersion + 1;
            this.instances.set(candidate.instanceId, candidate);
            return; // CAS 成功，退出
          }

          // CAS 失败，从存储重新加载，更新新状态，重试
          Logger.warn(
            instance.instanceId,
            "system",
            `CAS conflict detected, retrying... (${maxRetries - retries}/${maxRetries})`,
          );

          const freshInstance = await this.storage.loadInstance(
            instance.instanceId,
          );
          if (freshInstance) {
            // 使用最新的 version 作为下一次 CAS 的基准，并记录为"最后已知良好状态"——
            // 如果重试最终耗尽，内存缓存要回退到这里，而不是停在本次失败、从未持久化的版本上
            lastKnownGood = freshInstance;
            currentVersion = freshInstance.version ?? 1;
          }

          // 退让一小段带抖动的时间再重试。此前三次 CAS 背靠背在同一个
          // tick 内发出，竞争方的写入根本来不及落地，重试必然全部失败，
          // 整个重试机制退化成"必定抛 ConcurrencyConflictError"。
          if (retries > 0) {
            await this.casBackoff(attempt++);
          }
        } catch (error) {
          Logger.error(
            instance.instanceId,
            "system",
            "Failed to update instance in storage",
            error instanceof Error ? error.stack : String(error),
          );
          throw error;
        }
      }

      // 超过重试次数：内存中的 instance 对象从未成功持久化，必须把内存缓存
      // 回退到存储侧最后一次确认过的版本，否则会与存储永久分叉（内存领先、
      // 存储落后），后续基于内存状态做的判断都会是错的。
      if (lastKnownGood) {
        this.instances.set(instance.instanceId, lastKnownGood);
        this.syncSearchIndex(lastKnownGood);
      }

      Logger.error(
        instance.instanceId,
        "system",
        `Failed to update instance after ${maxRetries} CAS retries, possible concurrent modification`,
      );
      throw new ConcurrencyConflictError(instance.instanceId, maxRetries);
    }
  }

  /**
   * CAS 重试之间的退让：指数增长 + 抖动，让竞争方的写入有机会落地。
   * 基数刻意取得很小（2ms）——这是进程内的内存竞争，不是网络往返。
   */
  private casBackoff(attempt: number): Promise<void> {
    const base = 2 * 2 ** Math.min(attempt, 4);
    const delay = Math.round(base * (0.5 + Math.random() * 0.5));
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /**
   * 列出所有实例 ID
   */
  listInstances(): string[] {
    return Array.from(this.instances.keys());
  }

  /**
   * 获取实例总数
   */
  getInstanceCount(): number {
    return this.instances.size;
  }

  /**
   * 获取内部实例 Map（用于清理等操作）
   */
  getInstancesMap(): Map<string, WorkflowInstance> {
    return this.instances;
  }

  /**
   * 从存储加载实例
   */
  async loadFromStorage(): Promise<void> {
    if (!this.storage) return;

    try {
      const instanceIds = await this.storage.listInstances();

      // 以受限并发加载，替代逐个 await 的串行循环：
      // 串行时启动延迟是 N × 单次读取往返。
      const loaded = await mapWithConcurrency(instanceIds, (instanceId) =>
        this.storage!.loadInstance(instanceId),
      );

      for (const instance of loaded) {
        if (!instance) continue;
        this.instances.set(instance.instanceId, instance);
        this.instanceCounter = Math.max(
          this.instanceCounter,
          this.extractSequence(instance.instanceId) + 1,
        );
      }

      Logger.info(
        "system",
        "instance-manager",
        `Loaded ${instanceIds.length} instances from storage`,
      );
    } catch (error) {
      Logger.error(
        "system",
        "instance-manager",
        "Failed to load instances from storage",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private extractSequence(instanceId: string): number {
    const parts = instanceId.split("_");
    for (let index = parts.length - 1; index >= 0; index--) {
      const parsed = Number.parseInt(parts[index] ?? "", 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return 0;
  }
}
