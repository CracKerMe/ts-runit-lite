import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";
import type {
  EventQueryParams,
  EventRecord,
  EventWaitingState,
  HeartbeatState,
  InstanceMetrics,
  InstanceQueryParams,
  InstanceSortField,
  InstanceSortOrder,
  NodeMetrics,
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
} from "./StorageProvider";

/**
 * 内存存储实现
 * 用于开发测试或 Redis 不可用时的降级方案
 */
export class MemoryStorage implements StorageProvider {
  private instances = new Map<string, WorkflowInstance>();
  private workflows = new Map<string, WorkflowDefinition>();
  private eventWaitingStates = new Map<string, EventWaitingState>();
  private workflowsWithMetadata = new Map<string, StoredWorkflow>();
  private workflowVersions = new Map<
    string,
    Map<number, StoredWorkflowVersion>
  >();
  private instanceMetrics = new Map<string, InstanceMetrics>();
  private events = new Map<string, EventRecord>();
  private heartbeats = new Map<string, HeartbeatState>();

  async connect(): Promise<void> {
    Logger.info("system", "storage", "Memory storage initialized");
  }

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

  private normalizeInstanceDates(instance: WorkflowInstance): WorkflowInstance {
    return {
      ...instance,
      createdAt: new Date(this.toEpochMs(instance.createdAt)),
      updatedAt: new Date(this.toEpochMs(instance.updatedAt)),
      history: Array.isArray(instance.history)
        ? instance.history.map((log) => ({
            ...log,
            timestamp: new Date(this.toEpochMs(log.timestamp)),
          }))
        : [],
    };
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    // 深拷贝以避免引用问题，使用自定义序列化避免循环引用
    const normalizedInstance = this.normalizeInstanceDates(instance);
    const cloned = this.deepClone(normalizedInstance);
    this.instances.set(instance.instanceId, cloned);
    Logger.debug(
      "system",
      "storage",
      `Instance ${instance.instanceId} saved to memory`,
    );
  }

  /**
   * Compare-And-Swap (CAS) update for optimistic concurrency control
   */
  async casUpdateInstance(instance: WorkflowInstance): Promise<boolean> {
    const normalizedInstance = this.normalizeInstanceDates(instance);
    const currentVersion = normalizedInstance.version ?? 1;
    const stored = this.instances.get(instance.instanceId);

    // Check if stored version matches expected version
    if (stored && (stored.version ?? 1) === currentVersion) {
      // Increment version and save
      const cloned = this.deepClone({
        ...normalizedInstance,
        version: currentVersion + 1,
      });
      this.instances.set(instance.instanceId, cloned);
      Logger.debug(
        "system",
        "storage",
        `Instance ${instance.instanceId} CAS update succeeded (version ${currentVersion} -> ${currentVersion + 1})`,
      );
      return true;
    }
    Logger.warn(
      "system",
      "storage",
      `Instance ${instance.instanceId} CAS conflict: expected version ${currentVersion}, actual ${stored?.version ?? 1}`,
    );
    return false;
  }

  /**
   * 深度克隆对象，避免循环引用。
   * 正确处理 Map、Set、Buffer、RegExp、类实例和属性描述符。
   */
  private deepClone<T>(obj: T, seen = new WeakMap()): T {
    // 处理基本类型和 null
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    // 检查循环引用
    if (seen.has(obj as object)) {
      return seen.get(obj as object) as T;
    }

    // 处理 Date
    if (obj instanceof Date) {
      return new Date(obj.getTime()) as T;
    }

    // 处理 RegExp
    if (obj instanceof RegExp) {
      return new RegExp(obj.source, obj.flags) as T;
    }

    // 处理 Buffer
    if (Buffer.isBuffer(obj)) {
      return Buffer.from(obj) as T;
    }

    // 处理 Map
    if (obj instanceof Map) {
      const clone = new Map();
      seen.set(obj as object, clone);
      for (const [k, v] of obj) {
        clone.set(this.deepClone(k, seen), this.deepClone(v, seen));
      }
      return clone as T;
    }

    // 处理 Set
    if (obj instanceof Set) {
      const clone = new Set();
      seen.set(obj as object, clone);
      for (const v of obj) {
        clone.add(this.deepClone(v, seen));
      }
      return clone as T;
    }

    // 处理数组
    if (Array.isArray(obj)) {
      const clone: unknown[] = [];
      seen.set(obj as object, clone);
      for (const item of obj) {
        clone.push(this.deepClone(item, seen));
      }
      return clone as T;
    }

    // 处理普通对象和类实例 — preserve prototype chain
    const proto = Object.getPrototypeOf(obj);
    const clone = proto === Object.prototype ? {} : Object.create(proto);
    seen.set(obj as object, clone);

    // 使用 getOwnPropertyNames + getOwnPropertyDescriptors 保留描述符
    for (const key of Object.getOwnPropertyNames(obj)) {
      const desc = Object.getOwnPropertyDescriptor(obj, key);
      if (!desc) continue;

      if ("value" in desc) {
        Object.defineProperty(clone, key, {
          ...desc,
          value: this.deepClone(desc.value, seen),
        });
      } else {
        // getter/setter — copy as-is
        Object.defineProperty(clone, key, desc);
      }
    }

    return clone as T;
  }

  async loadInstance(instanceId: string): Promise<WorkflowInstance | null> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return null;
    }
    // 返回深拷贝
    return this.normalizeInstanceDates(this.deepClone(instance));
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    // 注意：工作流定义包含函数，无法完全序列化
    // 这里只保存引用
    this.workflows.set(workflow.id, workflow);
    Logger.debug(
      "system",
      "storage",
      `Workflow ${workflow.id} saved to memory`,
    );
  }

  async loadWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    return this.workflows.get(workflowId) || null;
  }

  async listInstances(): Promise<string[]> {
    return Array.from(this.instances.keys());
  }

  async listWorkflows(): Promise<string[]> {
    return Array.from(this.workflows.keys());
  }

  async deleteInstance(instanceId: string): Promise<void> {
    this.instances.delete(instanceId);
    Logger.debug(
      "system",
      "storage",
      `Instance ${instanceId} deleted from memory`,
    );
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    this.workflows.delete(workflowId);
    this.workflowsWithMetadata.delete(workflowId);
    this.workflowVersions.delete(workflowId);
    Logger.debug(
      "system",
      "storage",
      `Workflow ${workflowId} deleted from memory`,
    );
  }

  async close(): Promise<void> {
    Logger.info("system", "storage", "Memory storage closed");
  }

  // Event waiting state methods
  async saveEventWaitingState(state: EventWaitingState): Promise<void> {
    const key = `${state.instanceId}:${state.nodeId}`;
    this.eventWaitingStates.set(key, this.deepClone(state));
    Logger.debug("system", "storage", `Event waiting state saved for ${key}`);
  }

  async loadEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<EventWaitingState | null> {
    const key = `${instanceId}:${nodeId}`;
    const state = this.eventWaitingStates.get(key);
    return state ? this.deepClone(state) : null;
  }

  async loadAllEventWaitingStates(): Promise<EventWaitingState[]> {
    return Array.from(this.eventWaitingStates.values()).map((state) =>
      this.deepClone(state),
    );
  }

  async deleteEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<void> {
    const key = `${instanceId}:${nodeId}`;
    this.eventWaitingStates.delete(key);
    Logger.debug("system", "storage", `Event waiting state deleted for ${key}`);
  }

  // Enhanced workflow methods with metadata
  async saveWorkflowWithMetadata(workflow: StoredWorkflow): Promise<void> {
    this.workflowsWithMetadata.set(workflow.id, this.deepClone(workflow));
    Logger.debug(
      "system",
      "storage",
      `Workflow ${workflow.id} with metadata saved to memory`,
    );
  }

  async loadWorkflowWithMetadata(
    workflowId: string,
  ): Promise<StoredWorkflow | null> {
    const workflow = this.workflowsWithMetadata.get(workflowId);
    return workflow ? this.deepClone(workflow) : null;
  }

  async listWorkflowsWithMetadata(): Promise<StoredWorkflow[]> {
    return Array.from(this.workflowsWithMetadata.values()).map((wf) =>
      this.deepClone(wf),
    );
  }

  async saveWorkflowVersion(version: StoredWorkflowVersion): Promise<void> {
    const versions =
      this.workflowVersions.get(version.id) ||
      new Map<number, StoredWorkflowVersion>();
    versions.set(version.version, this.deepClone(version));
    this.workflowVersions.set(version.id, versions);
  }

  async loadWorkflowVersion(
    workflowId: string,
    version: number,
  ): Promise<StoredWorkflowVersion | null> {
    const versions = this.workflowVersions.get(workflowId);
    if (!versions) return null;
    const stored = versions.get(version);
    return stored ? this.deepClone(stored) : null;
  }

  async listWorkflowVersions(workflowId: string): Promise<number[]> {
    const versions = this.workflowVersions.get(workflowId);
    if (!versions) return [];
    return Array.from(versions.keys()).sort((a, b) => a - b);
  }

  // Instance metrics methods
  async saveInstanceMetrics(metrics: InstanceMetrics): Promise<void> {
    this.instanceMetrics.set(metrics.instanceId, this.deepClone(metrics));
    Logger.debug(
      "system",
      "storage",
      `Instance metrics saved for ${metrics.instanceId}`,
    );
  }

  async loadInstanceMetrics(
    instanceId: string,
  ): Promise<InstanceMetrics | null> {
    const metrics = this.instanceMetrics.get(instanceId);
    return metrics ? this.deepClone(metrics) : null;
  }

  async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    const existing = this.instanceMetrics.get(instanceId);
    // Derive workflowId from the stored instance if available
    const workflowId =
      existing?.workflowId || this.instances.get(instanceId)?.workflowId || "";
    const instanceMetrics: InstanceMetrics = existing || {
      instanceId,
      workflowId,
      nodeMetrics: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    instanceMetrics.nodeMetrics[nodeId] = metrics;
    instanceMetrics.updatedAt = Date.now();

    this.instanceMetrics.set(instanceId, instanceMetrics);
    Logger.debug(
      "system",
      "storage",
      `Node metrics updated for ${instanceId}:${nodeId}`,
    );
  }

  // Event history methods
  async saveEvent(event: EventRecord): Promise<void> {
    this.events.set(event.id, this.deepClone(event));
    Logger.debug("system", "storage", `Event ${event.id} saved to memory`);
  }

  async loadEvent(eventId: string): Promise<EventRecord | null> {
    const event = this.events.get(eventId);
    return event ? this.deepClone(event) : null;
  }

  async queryEvents(
    params: EventQueryParams,
  ): Promise<{ events: EventRecord[]; total: number }> {
    let events = Array.from(this.events.values());

    // Apply filters
    if (params.instanceId) {
      events = events.filter((e) => e.instanceId === params.instanceId);
    }
    if (params.eventType) {
      events = events.filter((e) => e.eventType === params.eventType);
    }
    if (params.startTime) {
      events = events.filter((e) => e.timestamp >= params.startTime!);
    }
    if (params.endTime) {
      events = events.filter((e) => e.timestamp <= params.endTime!);
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    const total = events.length;

    // Apply pagination
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    events = events.slice(start, end);

    return { events: events.map((e) => this.deepClone(e)), total };
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.events.delete(eventId);
    Logger.debug("system", "storage", `Event ${eventId} deleted from memory`);
  }

  // Instance query methods with filtering
  async queryInstances(
    params: InstanceQueryParams,
  ): Promise<{ instances: WorkflowInstance[]; total: number }> {
    let instances = Array.from(this.instances.values());

    // Apply filters
    if (params.workflowId) {
      instances = instances.filter((i) => i.workflowId === params.workflowId);
    }
    if (params.status) {
      instances = instances.filter((i) => i.status === params.status);
    }
    if (params.startTime) {
      instances = instances.filter(
        (i) => this.toEpochMs(i.createdAt) >= params.startTime!,
      );
    }
    if (params.endTime) {
      instances = instances.filter(
        (i) => this.toEpochMs(i.createdAt) <= params.endTime!,
      );
    }
    if (params.parentInstanceId) {
      instances = instances.filter(
        (i) => i.parentInstanceId === params.parentInstanceId,
      );
    }

    const total = instances.length;

    // Sort BEFORE pagination. Sorting a page after slicing produces duplicated
    // and missing rows across pages, and Map insertion order is not a stable
    // ordering to paginate against.
    this.sortInstances(instances, params.sortBy, params.sortOrder);

    // Apply pagination
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 50;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    instances = instances.slice(start, end);

    return { instances: instances.map((i) => this.deepClone(i)), total };
  }

  /**
   * 按指定字段稳定排序实例列表（原地排序）。
   * instanceId 作为最终 tie-breaker，保证分页结果可重现。
   */
  private sortInstances(
    instances: WorkflowInstance[],
    sortBy: InstanceSortField = "createdAt",
    sortOrder: InstanceSortOrder = "desc",
  ): void {
    const direction = sortOrder === "asc" ? 1 : -1;

    instances.sort((a, b) => {
      let cmp: number;
      if (sortBy === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortBy === "updatedAt") {
        cmp = this.toEpochMs(a.updatedAt) - this.toEpochMs(b.updatedAt);
      } else {
        cmp = this.toEpochMs(a.createdAt) - this.toEpochMs(b.createdAt);
      }

      if (cmp !== 0) return cmp * direction;
      // Stable tie-breaker so equal keys keep a deterministic page order.
      return a.instanceId.localeCompare(b.instanceId) * direction;
    });
  }

  /**
   * 获取所有实例（用于清理）
   */
  getAllInstances(): Map<string, WorkflowInstance> {
    return this.instances;
  }

  /**
   * 清理过期实例
   * @param maxAgeMs 最大存活时间（毫秒）
   */
  cleanupStaleInstances(maxAgeMs: number): number {
    const threshold = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [id, instance] of this.instances) {
      const isCompleted =
        instance.status === "completed" || instance.status === "failed";
      const isStale = this.toEpochMs(instance.updatedAt) < threshold;

      if (isCompleted && isStale) {
        this.instances.delete(id);
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
   * 获取存储统计信息
   */
  getStats(): { instanceCount: number; workflowCount: number } {
    return {
      instanceCount: this.instances.size,
      workflowCount: this.workflows.size,
    };
  }

  // Heartbeat persistence methods
  async saveHeartbeat(state: HeartbeatState): Promise<void> {
    this.heartbeats.set(state.heartbeatKey, this.deepClone(state));
    Logger.debug(
      state.instanceId,
      state.nodeId,
      `Heartbeat saved for ${state.heartbeatKey}`,
    );
  }

  async loadAllHeartbeats(): Promise<HeartbeatState[]> {
    return Array.from(this.heartbeats.values()).map((hb) => this.deepClone(hb));
  }

  async deleteHeartbeat(instanceId: string, nodeId: string): Promise<void> {
    const key = `${instanceId}:${nodeId}`;
    this.heartbeats.delete(key);
    Logger.debug(instanceId, nodeId, "Heartbeat deleted");
  }

  // Event cleanup methods
  async cleanupStaleEvents(retentionDays: number): Promise<number> {
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const [id, event] of this.events) {
      if (event.timestamp < cutoffTime) {
        this.events.delete(id);
        deleted++;
      }
    }

    if (deleted > 0) {
      Logger.info(
        "system",
        "cleanup",
        `Cleaned up ${deleted} stale events (older than ${retentionDays} days)`,
      );
    }

    return deleted;
  }

  async cleanupExpiredHeartbeats(): Promise<number> {
    let cleaned = 0;

    for (const [key, hb] of this.heartbeats) {
      if (hb.deadline < Date.now()) {
        this.heartbeats.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      Logger.debug(
        "system",
        "cleanup",
        `Cleaned up ${cleaned} expired heartbeats`,
      );
    }

    return cleaned;
  }
}
