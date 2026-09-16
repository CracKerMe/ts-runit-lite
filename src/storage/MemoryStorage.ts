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
 * 走二级索引的选择度阈值。
 *
 * 候选桶超过全量的这个比例时，改走全量扫描：索引路径要为桶里每个 id 再做
 * 一次 Map.get（随机访问），而全量扫描是顺序遍历。桶越接近全量，前者的
 * 额外查找开销就越不划算——实测 47k/50k 的桶走索引比全量扫描慢约 1/3。
 */
const INDEX_SELECTIVITY_THRESHOLD = 0.5;

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
  /**
   * 最近一次 cleanup 删掉的 id，供子类精确删除对应文件。
   *
   * 没有它时，LocalFileStorage 只能反过来"物化全部存活记录 + readdir 整个
   * 目录，再求差集"来推断该删哪些文件——一次清理就要 deepClone 整个事件库
   * 并排序。记录被删的 id 把这一步降到与删除量成正比。
   */
  protected lastCleanedEventIds: string[] = [];
  protected lastCleanedHeartbeatKeys: string[] = [];
  protected lastCleanedInstanceIds: string[] = [];

  /**
   * 等值过滤字段的二级索引：`字段值 -> id 集合`。
   *
   * 此前每次 queryInstances/queryEvents 都是 `Array.from(map.values())`
   * 全量扫描再链式 filter——要从 10 万条实例里取出某个 workflowId 的第一页
   * 50 条，得先摸过全部 10 万条。有了索引就只从匹配的集合出发。
   *
   * 一致性是这里唯一的风险。为此所有对 `instances`/`events` 的增删都**只**
   * 允许走 {@link putInstance}/{@link dropInstance}/{@link putEvent}/
   * {@link dropEvent} 这四个私有入口——不要在别处直接 `this.instances.set(...)`，
   * 否则索引会静默失配。property-style 测试（对照暴力全扫描）守住这一点。
   */
  private instancesByWorkflowId = new Map<string, Set<string>>();
  private instancesByStatus = new Map<string, Set<string>>();
  private instancesByParentId = new Map<string, Set<string>>();
  private eventsByInstanceId = new Map<string, Set<string>>();
  private eventsByType = new Map<string, Set<string>>();

  /**
   * 索引的内部规模快照，仅供测试断言"索引是紧的"。
   *
   * 查询路径在缩小候选集之后仍会对每条记录做完整过滤，因此**失配的索引
   * 不会产生错误结果，只会让桶白白变大**。这意味着只看查询结果是测不出
   * 索引漏摘的——必须直接看索引本身。
   *
   * 返回每个索引里的条目总数（各桶大小之和）。索引正确时它应当恰好等于
   * 拥有该字段的记录条数。
   */
  protected indexSizesForTest(): {
    instancesByWorkflowId: number;
    instancesByStatus: number;
    instancesByParentId: number;
    eventsByInstanceId: number;
    eventsByType: number;
  } {
    const total = (index: Map<string, Set<string>>): number => {
      let sum = 0;
      for (const bucket of index.values()) sum += bucket.size;
      return sum;
    };
    return {
      instancesByWorkflowId: total(this.instancesByWorkflowId),
      instancesByStatus: total(this.instancesByStatus),
      instancesByParentId: total(this.instancesByParentId),
      eventsByInstanceId: total(this.eventsByInstanceId),
      eventsByType: total(this.eventsByType),
    };
  }

  /** 把 id 挂到 `index[value]` 下。value 为空时跳过（该字段未设置）。 */
  private addToIndex(
    index: Map<string, Set<string>>,
    value: string | undefined,
    id: string,
  ): void {
    if (!value) return;
    const bucket = index.get(value);
    if (bucket) bucket.add(id);
    else index.set(value, new Set([id]));
  }

  /** 从 `index[value]` 摘掉 id，桶空了就连桶一起删，避免无限积累空桶。 */
  private removeFromIndex(
    index: Map<string, Set<string>>,
    value: string | undefined,
    id: string,
  ): void {
    if (!value) return;
    const bucket = index.get(value);
    if (!bucket) return;
    bucket.delete(id);
    if (bucket.size === 0) index.delete(value);
  }

  /**
   * 写入实例并维护索引。**所有** instances 的写入都必须走这里。
   *
   * 覆盖写时要先按**旧值**摘除索引再按新值挂入——实例的 status 会变，
   * 只按新值挂而不摘旧值会让它同时出现在 running 和 completed 两个桶里。
   */
  private putInstance(instanceId: string, instance: WorkflowInstance): void {
    const previous = this.instances.get(instanceId);
    if (previous) {
      this.removeFromIndex(
        this.instancesByWorkflowId,
        previous.workflowId,
        instanceId,
      );
      this.removeFromIndex(this.instancesByStatus, previous.status, instanceId);
      this.removeFromIndex(
        this.instancesByParentId,
        previous.parentInstanceId,
        instanceId,
      );
    }
    this.instances.set(instanceId, instance);
    this.addToIndex(
      this.instancesByWorkflowId,
      instance.workflowId,
      instanceId,
    );
    this.addToIndex(this.instancesByStatus, instance.status, instanceId);
    this.addToIndex(
      this.instancesByParentId,
      instance.parentInstanceId,
      instanceId,
    );
  }

  /** 删除实例并维护索引。**所有** instances 的删除都必须走这里。 */
  private dropInstance(instanceId: string): boolean {
    const previous = this.instances.get(instanceId);
    if (!previous) return false;
    this.removeFromIndex(
      this.instancesByWorkflowId,
      previous.workflowId,
      instanceId,
    );
    this.removeFromIndex(this.instancesByStatus, previous.status, instanceId);
    this.removeFromIndex(
      this.instancesByParentId,
      previous.parentInstanceId,
      instanceId,
    );
    return this.instances.delete(instanceId);
  }

  /** 写入事件并维护索引。见 {@link putInstance}。 */
  private putEvent(eventId: string, event: EventRecord): void {
    const previous = this.events.get(eventId);
    if (previous) {
      this.removeFromIndex(
        this.eventsByInstanceId,
        previous.instanceId,
        eventId,
      );
      this.removeFromIndex(this.eventsByType, previous.eventType, eventId);
    }
    this.events.set(eventId, event);
    this.addToIndex(this.eventsByInstanceId, event.instanceId, eventId);
    this.addToIndex(this.eventsByType, event.eventType, eventId);
  }

  /** 删除事件并维护索引。见 {@link dropInstance}。 */
  private dropEvent(eventId: string): boolean {
    const previous = this.events.get(eventId);
    if (!previous) return false;
    this.removeFromIndex(this.eventsByInstanceId, previous.instanceId, eventId);
    this.removeFromIndex(this.eventsByType, previous.eventType, eventId);
    return this.events.delete(eventId);
  }

  /**
   * 把索引桶里的 id 换成实际记录，跳过已不存在的。
   *
   * 正常情况下索引与主 Map 是一致的（所有增删都走四个 put/drop 入口），
   * 这里的跳过只是防御性的——万一某条路径绕过了funnel，宁可漏一条也不要
   * 让 query 抛 undefined。
   */
  private *idsToRecords<T>(
    ids: Iterable<string>,
    source: Map<string, T>,
  ): Generator<T> {
    for (const id of ids) {
      const record = source.get(id);
      if (record !== undefined) yield record;
    }
  }

  /**
   * 从若干个候选索引里挑最小的那个桶作为扫描起点。
   *
   * 返回 undefined 表示没有可用的等值索引（查询没带这些字段），调用方
   * 退回全量扫描。返回空数组表示确实没有匹配项，可以直接短路。
   */
  private narrowByIndexes(
    lookups: readonly {
      index: Map<string, Set<string>>;
      value: string | undefined;
    }[],
    totalRecords: number,
  ): Set<string> | undefined {
    let smallest: Set<string> | undefined;
    for (const { index, value } of lookups) {
      if (!value) continue;
      // 桶不存在 == 没有任何匹配，直接给出空集短路后续过滤
      const bucket = index.get(value) ?? new Set<string>();
      if (!smallest || bucket.size < smallest.size) smallest = bucket;
    }

    // 选择度不够高时反而更慢：走索引要对桶里每个 id 再做一次 Map.get，
    // 而直接遍历主 Map 是顺序访问、没有额外查找。实测 47k/50k 的桶走索引
    // 比全量扫描慢约 1/3。只有当候选集显著小于全量时才值得走索引。
    if (
      smallest &&
      smallest.size > totalRecords * INDEX_SELECTIVITY_THRESHOLD
    ) {
      return undefined;
    }
    return smallest;
  }

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

  /**
   * 返回存储中的实例**引用**，不做深拷贝。
   *
   * 仅供子类（LocalFileStorage）在内部使用：持久化路径需要一份"写入前的
   * 快照"用于失败回滚，以及一份"待写入磁盘的值"。这两者此前都各自走一次
   * `loadInstance()`，也就是各自一次全量 deepClone——实例最多携带 1000 条
   * history，每个节点转换都要克隆三遍，纯属浪费。
   *
   * 借用引用的安全性依据：`instances` 这个 Map 的条目永远是**整体替换**
   * （`saveInstance`/`casUpdateInstance` 都是 `set(id, 全新的 clone)`），
   * 从不就地修改。因此一个已被取出的引用等价于一份按约定不可变的快照，
   * 后续写入不会从它脚下改掉内容。
   *
   * ⚠️ 不要把它暴露到 StorageProvider 接口上：引擎侧（ExecutionOrchestrator）
   * 会直接修改 load 出来的实例，返回活引用会让内存存储在 CAS 校验之前
   * 就被改掉，破坏 CAS 契约。
   */
  protected peekInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  /** 见 {@link peekInstance}；heartbeats 同样是整体替换。 */
  protected peekHeartbeat(heartbeatKey: string): HeartbeatState | undefined {
    return this.heartbeats.get(heartbeatKey);
  }

  /** 事件是否还在内存里。孤儿清扫用，不需要取值因此不 clone。 */
  protected hasEventInMemory(eventId: string): boolean {
    return this.events.has(eventId);
  }

  /**
   * 磁盘上的 heartbeat 文件名是 `<instanceId>:<nodeId>`，而内存 Map 以
   * `heartbeatKey` 为键，两者不一定相同，所以这里按文件名形态反查。
   */
  protected hasHeartbeatFileKeyInMemory(fileKey: string): boolean {
    for (const hb of this.heartbeats.values()) {
      if (`${hb.instanceId}:${hb.nodeId}` === fileKey) return true;
    }
    return false;
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    // 深拷贝以避免引用问题，使用自定义序列化避免循环引用
    const normalizedInstance = this.normalizeInstanceDates(instance);
    const cloned = this.deepClone(normalizedInstance);
    this.putInstance(instance.instanceId, cloned);
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
      this.putInstance(instance.instanceId, cloned);
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
   *
   * 优先走 `structuredClone`：它在 C++ 层原生处理 Date/Map/Set/Buffer/
   * 循环引用，比逐属性描述符遍历快一个数量级。而这是最热的写入路径
   * ——实例的 `history` 会随生命周期增长，每个节点转换都要克隆一次。
   *
   * 回退到手写实现的场景：`structuredClone` 遇到函数、getter/setter 或
   * 类实例的原型链时会抛 `DataCloneError`。工作流定义允许携带函数，
   * 所以这个回退路径必须保留，不能直接替换。
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    // structuredClone 有两处静默的语义差异，必须先排除：
    //   1. Buffer 会降级成普通 Uint8Array（Buffer.isBuffer 变为 false）
    //   2. 类实例会丢失原型链（不抛错，静默退化成普通对象）
    // 两者都不会报错，只会在运行时表现为诡异的行为，所以在这里主动检测
    // 并改走保留语义的回退实现。
    if (this.needsStructuralFidelity(obj)) {
      return this.deepCloneFallback(obj);
    }

    try {
      return structuredClone(obj);
    } catch {
      // DataCloneError：含函数等不可克隆的值，
      // 退回逐属性克隆（保留原型链与属性描述符）。
      return this.deepCloneFallback(obj);
    }
  }

  /**
   * 判断对象树中是否存在 `structuredClone` 会静默改变语义的值
   * （Buffer 或带自定义原型的类实例）。
   *
   * 只做有限深度的探测：绝大多数实例的 context 都是普通 JSON 形状，
   * 探测会很快返回 false，让热路径走上原生克隆。
   */
  private needsStructuralFidelity(value: unknown, depth = 0): boolean {
    if (depth > 6 || value === null || typeof value !== "object") {
      return false;
    }

    if (Buffer.isBuffer(value)) return true;

    if (Array.isArray(value)) {
      return value.some((item) =>
        this.needsStructuralFidelity(item, depth + 1),
      );
    }

    if (value instanceof Date || value instanceof RegExp) return false;

    if (value instanceof Map) {
      for (const [k, v] of value) {
        if (
          this.needsStructuralFidelity(k, depth + 1) ||
          this.needsStructuralFidelity(v, depth + 1)
        ) {
          return true;
        }
      }
      return false;
    }

    if (value instanceof Set) {
      for (const v of value) {
        if (this.needsStructuralFidelity(v, depth + 1)) return true;
      }
      return false;
    }

    // 带自定义原型的类实例：structuredClone 会把它压成普通对象
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return true;

    for (const v of Object.values(value)) {
      if (this.needsStructuralFidelity(v, depth + 1)) return true;
    }
    return false;
  }

  /**
   * `structuredClone` 无法处理时的逐属性深拷贝。
   * 保留 Map、Set、Buffer、RegExp、类实例原型链和属性描述符。
   */
  private deepCloneFallback<T>(obj: T, seen = new WeakMap()): T {
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
        clone.set(
          this.deepCloneFallback(k, seen),
          this.deepCloneFallback(v, seen),
        );
      }
      return clone as T;
    }

    // 处理 Set
    if (obj instanceof Set) {
      const clone = new Set();
      seen.set(obj as object, clone);
      for (const v of obj) {
        clone.add(this.deepCloneFallback(v, seen));
      }
      return clone as T;
    }

    // 处理数组
    if (Array.isArray(obj)) {
      const clone: unknown[] = [];
      seen.set(obj as object, clone);
      for (const item of obj) {
        clone.push(this.deepCloneFallback(item, seen));
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
          value: this.deepCloneFallback(desc.value, seen),
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
    // 只克隆，不再归一化：写入时（saveInstance / casUpdateInstance）
    // 已经归一化过一次，读取路径重复做一遍等于每次读都全量重建对象。
    return this.deepClone(instance);
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
    this.dropInstance(instanceId);
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

  /**
   * 删除一个实例的全部 metrics。
   *
   * 归档终态实例时调用：ArchiveManager 此前只删实例本身，metrics 记录会
   * 一直留在内存（和磁盘）里，成为随归档量线性增长的泄漏。
   */
  async deleteInstanceMetrics(instanceId: string): Promise<void> {
    this.instanceMetrics.delete(instanceId);
    Logger.debug(
      "system",
      "storage",
      `Instance metrics deleted for ${instanceId}`,
    );
  }

  async loadInstanceMetrics(
    instanceId: string,
  ): Promise<InstanceMetrics | null> {
    const metrics = this.instanceMetrics.get(instanceId);
    return metrics ? this.deepClone(metrics) : null;
  }

  /**
   * 写入单个节点的 metrics。
   *
   * 注意这里是**替换而非就地修改**：旧实现直接在已存储的 InstanceMetrics
   * 上写 `nodeMetrics[nodeId] = ...`，这让任何"先取出引用当快照、再写入"
   * 的调用方拿到的快照会被就地改掉。改成浅拷贝一层（nodeMetrics 换成新
   * 对象）后，已取出的引用才真正是不可变快照，
   * {@link peekInstanceMetrics} 才能安全借用。
   *
   * 浅拷贝足够：被替换的只有 nodeMetrics 这一层的键，各个 NodeMetrics
   * 值对象本身不会被就地修改。
   */
  async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    const existing = this.instanceMetrics.get(instanceId);
    // Derive workflowId from the stored instance if available
    const workflowId =
      existing?.workflowId || this.instances.get(instanceId)?.workflowId || "";

    const instanceMetrics: InstanceMetrics = {
      instanceId,
      workflowId,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      nodeMetrics: {
        ...existing?.nodeMetrics,
        [nodeId]: this.deepClone(metrics),
      },
    };

    this.instanceMetrics.set(instanceId, instanceMetrics);
    Logger.debug(
      "system",
      "storage",
      `Node metrics updated for ${instanceId}:${nodeId}`,
    );
  }

  /**
   * 返回存储中 metrics 记录的**引用**，不做深拷贝。见 {@link peekInstance}。
   *
   * 安全性依赖于 {@link updateNodeMetrics} 的替换语义——不要把它改回就地修改。
   */
  protected peekInstanceMetrics(
    instanceId: string,
  ): InstanceMetrics | undefined {
    return this.instanceMetrics.get(instanceId);
  }

  // Event history methods
  async saveEvent(event: EventRecord): Promise<void> {
    this.putEvent(event.id, this.deepClone(event));
    Logger.debug("system", "storage", `Event ${event.id} saved to memory`);
  }

  async loadEvent(eventId: string): Promise<EventRecord | null> {
    const event = this.events.get(eventId);
    return event ? this.deepClone(event) : null;
  }

  async queryEvents(
    params: EventQueryParams,
  ): Promise<{ events: EventRecord[]; total: number }> {
    // 见 queryInstances：先用等值索引缩小候选集，再单遍过滤。
    const narrowed = this.narrowByIndexes(
      [
        { index: this.eventsByInstanceId, value: params.instanceId },
        { index: this.eventsByType, value: params.eventType },
      ],
      this.events.size,
    );

    const candidates: Iterable<EventRecord> = narrowed
      ? this.idsToRecords(narrowed, this.events)
      : this.events.values();

    let events: EventRecord[] = [];
    for (const event of candidates) {
      if (params.instanceId && event.instanceId !== params.instanceId) continue;
      if (params.eventType && event.eventType !== params.eventType) continue;
      if (params.startTime && event.timestamp < params.startTime) continue;
      if (params.endTime && event.timestamp > params.endTime) continue;
      events.push(event);
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
    this.dropEvent(eventId);
    Logger.debug("system", "storage", `Event ${eventId} deleted from memory`);
  }

  // Instance query methods with filtering
  async queryInstances(
    params: InstanceQueryParams,
  ): Promise<{ instances: WorkflowInstance[]; total: number }> {
    // 先用等值索引把候选集缩到最小的那个桶，再在桶内做完整过滤。
    // 没带任何可索引字段时退回全量扫描（语义与此前一致）。
    const narrowed = this.narrowByIndexes(
      [
        { index: this.instancesByWorkflowId, value: params.workflowId },
        { index: this.instancesByStatus, value: params.status },
        { index: this.instancesByParentId, value: params.parentInstanceId },
      ],
      this.instances.size,
    );

    const candidates: Iterable<WorkflowInstance> = narrowed
      ? this.idsToRecords(narrowed, this.instances)
      : this.instances.values();

    // 单遍过滤：此前是链式 .filter()，每个条件都要再分配一个完整数组。
    let instances: WorkflowInstance[] = [];
    for (const instance of candidates) {
      if (params.workflowId && instance.workflowId !== params.workflowId)
        continue;
      if (params.status && instance.status !== params.status) continue;
      if (
        params.parentInstanceId &&
        instance.parentInstanceId !== params.parentInstanceId
      )
        continue;
      if (params.startTime || params.endTime) {
        const createdAt = this.toEpochMs(instance.createdAt);
        if (params.startTime && createdAt < params.startTime) continue;
        if (params.endTime && createdAt > params.endTime) continue;
      }
      instances.push(instance);
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

    // Decorate-sort-undecorate：排序键只算一次。
    //
    // 此前 toEpochMs 写在比较器内部，日期强制转换因此跑了 O(N log N) 次
    // ——5000 条实例排一次序要做约 12 万次 Date 解析，而其中只有 5000 次
    // 是必要的。
    const decorated = instances.map((instance) => ({
      instance,
      key:
        sortBy === "status"
          ? instance.status
          : sortBy === "updatedAt"
            ? this.toEpochMs(instance.updatedAt)
            : this.toEpochMs(instance.createdAt),
    }));

    decorated.sort((a, b) => {
      const cmp =
        typeof a.key === "string"
          ? a.key.localeCompare(b.key as string)
          : a.key - (b.key as number);

      if (cmp !== 0) return cmp * direction;
      // Stable tie-breaker so equal keys keep a deterministic page order.
      return (
        a.instance.instanceId.localeCompare(b.instance.instanceId) * direction
      );
    });

    // 原地写回，保持 sortInstances 的既有签名（调用方依赖它就地排序）
    for (const [index, entry] of decorated.entries()) {
      instances[index] = entry.instance;
    }
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

    // 见 lastCleanedEventIds：记录被删的 id 供子类精确删文件。
    this.lastCleanedInstanceIds = [];
    for (const [id, instance] of this.instances) {
      const isCompleted =
        instance.status === "completed" || instance.status === "failed";
      const isStale = this.toEpochMs(instance.updatedAt) < threshold;

      if (isCompleted && isStale) {
        this.dropInstance(id);
        this.lastCleanedInstanceIds.push(id);
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

    // 记录被删的 id 供子类精确删除对应文件。此前 LocalFileStorage 需要
    // 反过来物化整个事件库来推断"谁还活着"，代价是全量 clone + 排序。
    this.lastCleanedEventIds = [];
    for (const [id, event] of this.events) {
      if (event.timestamp < cutoffTime) {
        this.dropEvent(id);
        this.lastCleanedEventIds.push(id);
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

    // 见 cleanupStaleEvents：记录被删的 key 供子类精确删文件。
    this.lastCleanedHeartbeatKeys = [];
    for (const [key, hb] of this.heartbeats) {
      if (hb.deadline < Date.now()) {
        this.heartbeats.delete(key);
        this.lastCleanedHeartbeatKeys.push(`${hb.instanceId}:${hb.nodeId}`);
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
