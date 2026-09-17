// oxlint-disable no-explicit-any -- local persistence stores workflow payloads with dynamic shapes
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import {
  getRestoreConcurrency,
  mapWithConcurrency,
} from "../utils/concurrency";
import { Logger } from "../utils/Logger";
import { MemoryStorage } from "./MemoryStorage";
import type {
  EventRecord,
  EventWaitingState,
  HeartbeatState,
  InstanceMetrics,
  InstanceQueryParams,
  EventQueryParams,
  NodeMetrics,
  StorageProvider,
  StoredWorkflow,
  StoredWorkflowVersion,
} from "./StorageProvider";

export interface LocalFileStorageOptions {
  directory: string;
  /**
   * When true, fsync the temp file before rename and fsync the parent
   * directory after rename, for every write. This protects against data
   * loss on an abrupt host crash or power loss, not just a process restart.
   *
   * Default false: atomic rename alone already protects against ordinary
   * process restarts (the OS page cache survives those), and fsync on every
   * write materially slows down high-throughput node execution. Enable this
   * for deployments that must survive host-level failures, at the cost of
   * write latency.
   */
  fsyncOnWrite?: boolean;
  /**
   * Which collections `fsyncOnWrite` actually applies to.
   *
   * Defaults to {@link DEFAULT_FSYNC_COLLECTIONS}: everything that is a
   * system of record or user-visible audit history, but NOT `metrics` or
   * `heartbeats`. Those two are derived observability data — nothing in the
   * engine makes a control-flow decision from them — and they account for
   * two of the three writes on the per-node hot path, so fsync'ing them
   * makes every node execution pay for durability nobody needs.
   *
   * Pass an explicit list to override, e.g. to fsync metrics too.
   */
  fsyncCollections?: readonly Collection[];
}

/**
 * 单个节点 metrics 的磁盘记录形态。
 *
 * 带上 instance 级字段（workflowId/createdAt/updatedAt）是为了让恢复时
 * 不依赖任何一个"主记录"文件就能把 InstanceMetrics 组装回来——否则删掉
 * 或损坏其中一个文件就会丢掉整个实例的 workflowId。
 */
interface PersistedNodeMetrics {
  instanceId: string;
  workflowId: string;
  createdAt: number;
  updatedAt: number;
  nodeId: string;
  metrics: NodeMetrics;
}

type Collection =
  | "instances"
  | "workflows"
  | "workflow-metadata"
  | "workflow-versions"
  | "waiting"
  | "metrics"
  | "events"
  | "heartbeats"
  | "dlq"
  | "webhooks"
  | "webhook-deliveries";

/**
 * 全量孤儿清扫的最小间隔。
 *
 * 正常路径已经精确删除，这只是兜底崩溃留下的孤儿文件，不需要每次清理都
 * readdir 一遍整个目录。
 */
const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * `FSYNC_ON_WRITE=true` 默认作用于哪些集合。
 *
 * 取舍很简单：**系统记录与用户可见的审计历史要 fsync，纯派生的可观测性
 * 数据不要**。
 *
 * 不在此列的只有 `metrics` 与 `heartbeats`：
 *  - metrics 是派生数据，引擎不会据此做任何控制流决策，唯一消费方是
 *    MetricsAggregator；而它占了每节点 3 次写入中的 2 次，fsync 它等于
 *    让每个节点执行都为没人需要的持久性买单（实测 fsync 下整个节点循环
 *    从 1,400 ops/s 掉到 35 ops/s）；
 *  - heartbeat 本就被明确定义为恢复提示而非事务状态（见 HeartbeatTracker
 *    的注释），且已被去抖到每 10s 一次。
 *
 * `events` **保留** fsync：它是用户可见的审计历史，默认把它降级为
 * best-effort 是那种会侵蚀信任的静默改动。需要的话可用 `fsyncCollections`
 * 显式调整。
 */
const DEFAULT_FSYNC_COLLECTIONS: readonly Collection[] = [
  "instances",
  "workflows",
  "workflow-metadata",
  "workflow-versions",
  "waiting",
  "events",
  "dlq",
  "webhooks",
  "webhook-deliveries",
];

/**
 * Durable single-process storage backed by one JSON file per record.
 *
 * This class implements `StorageProvider` directly and holds a private
 * `MemoryStorage` instance as its query layer (composition, not
 * inheritance). MemoryStorage remains the hot index and query
 * implementation. Files are the recovery boundary: every mutation is
 * written through a temp file and then atomically renamed into place. This
 * is intentionally not a distributed store, but it protects workflow state
 * from ordinary process restarts.
 *
 * By default writes are NOT fsync'd: the rename is atomic (readers never see
 * a half-written file), but the bytes can still live only in the page cache
 * until the OS flushes them, so an abrupt host crash or power loss can lose
 * the most recent writes even though callers already observed them succeed.
 * Pass `fsyncOnWrite: true` (or `FSYNC_ON_WRITE=true`, see AppConfig) to
 * trade write latency for surviving host-level failures too.
 *
 * ## Composition, not inheritance
 *
 * `LocalFileStorage` used to `extends MemoryStorage`. It is now a standalone
 * class that holds a private `MemoryStorage` (`this.memory`) as its query
 * layer and delegates every read/write to it. Three things this relies on:
 *
 *  - All in-memory reads/writes go through `this.memory`'s public methods
 *    (`saveInstance`, `queryInstances`, etc.) — there is no second Map of
 *    instances held here, so there is exactly one source of truth for what's
 *    "in memory".
 *  - The persistence path needs the already-cloned value that `MemoryStorage`
 *    just stored (to avoid a second deep clone before writing to disk), and
 *    a pre-mutation snapshot to roll back to on disk-write failure. Since
 *    `this.memory` is a concrete `MemoryStorage` (not the `StorageProvider`
 *    interface type), `LocalFileStorage` can call `MemoryStorage`-specific,
 *    non-interface methods such as `saveInstanceAndPeek` /
 *    `casUpdateInstanceAndPeek` / `saveHeartbeatAndPeek` /
 *    `updateNodeMetricsAndPeek` that return the stored clone directly. These
 *    are deliberately NOT part of `StorageProvider` — returning a live,
 *    mutable reference through the public interface would let engine code
 *    mutate an instance before CAS validation, corrupting in-memory state.
 *  - Cleanup receipts (`lastCleanedEventIds` etc.) used to be `protected`
 *    fields LocalFileStorage read directly as a subclass. They're now
 *    surfaced as return values via `cleanupStaleEventsWithIds` /
 *    `cleanupExpiredHeartbeatsWithIds` / `cleanupStaleInstancesWithIds` —
 *    again concrete `MemoryStorage` methods outside `StorageProvider`.
 */
export class LocalFileStorage implements StorageProvider {
  readonly directory: string;
  /** 内存查询层：组合而非继承，是本实例状态的唯一来源。 */
  private readonly memory: MemoryStorage;
  private readonly directories: Record<Collection, string>;
  private readonly fsyncOnWrite: boolean;
  /** fsyncOnWrite 实际生效的集合，见 {@link DEFAULT_FSYNC_COLLECTIONS}。 */
  private readonly fsyncCollections: ReadonlySet<Collection>;
  private readonly directoryFsyncQueues = new Map<string, Promise<void>>();
  private writeQueues = new Map<string, Promise<void>>();
  /**
   * 每个 key 最新的待写入值。写队列此前只做串行化、不做合并——同一条记录
   * 的 N 次快速更新会产生 N 次整文件重写，其中中间的 N-2 次在落盘前就已
   * 被更新的值取代，纯属浪费 I/O。
   */
  private pendingValues = new Map<string, unknown>();
  /**
   * 已排队但尚未开始执行的写操作。后续 persist() 可以直接 await 它而不必
   * 再排一个——它会取走 {@link pendingValues} 里的最新值。
   */
  private queuedWrites = new Map<string, Promise<void>>();
  /**
   * Tracks the latest in-memory mutation for each durable record. A failed
   * older write must never compensate over a newer mutation which has already
   * reached memory (and possibly disk).
   */
  private persistenceGenerations = new Map<string, number>();
  /**
   * 每个 key 当前这批未落盘写入中**最早**的回滚点。
   *
   * 并发写同一条记录且共享的落盘失败时，必须回滚到这批写入开始之前的状态，
   * 而不是最后一个调用方的快照——后者只会退回到倒数第二个值，让内存领先
   * 磁盘。落盘成功即清空。详见 {@link persistOrRollback}。
   */
  private rollbackTargets = new Map<string, () => Promise<void>>();
  /** 每个集合上次做全量孤儿清扫的时间，见 {@link sweepOrphans}。 */
  private lastOrphanSweep = new Map<Collection, number>();
  /** cleanupStaleInstances 触发的异步文件清理，见 {@link whenIdle}。 */
  private pendingFileCleanup: Promise<void> = Promise.resolve();
  private deadLetterEntries = new Map<string, unknown>();
  private webhookEntries = new Map<string, unknown>();
  private webhookDeliveryEntries = new Map<string, unknown>();
  private connected = false;

  constructor(options: LocalFileStorageOptions | string) {
    this.memory = new MemoryStorage();
    this.directory = typeof options === "string" ? options : options.directory;
    this.fsyncOnWrite =
      typeof options === "string" ? false : (options.fsyncOnWrite ?? false);
    this.fsyncCollections = new Set(
      typeof options === "string"
        ? DEFAULT_FSYNC_COLLECTIONS
        : (options.fsyncCollections ?? DEFAULT_FSYNC_COLLECTIONS),
    );
    this.directories = {
      instances: path.join(this.directory, "instances"),
      workflows: path.join(this.directory, "workflows"),
      "workflow-metadata": path.join(this.directory, "workflow-metadata"),
      "workflow-versions": path.join(this.directory, "workflow-versions"),
      waiting: path.join(this.directory, "waiting"),
      metrics: path.join(this.directory, "metrics"),
      events: path.join(this.directory, "events"),
      heartbeats: path.join(this.directory, "heartbeats"),
      dlq: path.join(this.directory, "dlq"),
      webhooks: path.join(this.directory, "webhooks"),
      "webhook-deliveries": path.join(this.directory, "webhook-deliveries"),
    };
  }

  async connect(): Promise<void> {
    for (const directory of Object.values(this.directories)) {
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.mkdir(path.join(directory, "corrupt"), {
        recursive: true,
      });
    }

    await this.memory.connect();

    // instances 先恢复：updateNodeMetrics 会从实例里推导 workflowId，
    // 恢复路径虽然走的是 saveInstanceMetrics 不触及那一步，但保持这个
    // 顺序可以免去一个隐含的依赖。
    await this.restoreCollection("instances", async (id, value) =>
      this.memory.saveInstance(this.restoreInstance(value, id)),
    );

    // 其余集合写入互不相交的内存 Map，可以并行恢复。此前它们是 11 次
    // 串行 await，几万条记录时 connect() 本身就会成为可用规模的天花板。
    await Promise.all([
      this.restoreCollection("workflows", async (_id, value) =>
        this.memory.saveWorkflow(value as WorkflowDefinition),
      ),
      this.restoreCollection("workflow-metadata", async (_id, value) =>
        this.memory.saveWorkflowWithMetadata(value as StoredWorkflow),
      ),
      // workflow-versions 的回放必须串行：saveWorkflowVersion 对嵌套 Map
      // 做读-改-写，并发会丢版本。
      this.restoreCollection(
        "workflow-versions",
        async (_id, value) =>
          this.memory.saveWorkflowVersion(value as StoredWorkflowVersion),
        true,
      ),
      this.restoreCollection("waiting", async (_id, value) =>
        this.memory.saveEventWaitingState(value as EventWaitingState),
      ),
      this.restoreMetrics(),
      this.restoreCollection("events", async (_id, value) =>
        this.memory.saveEvent(this.restoreEvent(value as EventRecord)),
      ),
      this.restoreCollection("heartbeats", async (_id, value) =>
        this.memory.saveHeartbeat(value as HeartbeatState),
      ),
      this.restoreCollection("dlq", async (id, value) => {
        this.deadLetterEntries.set(id, value);
      }),
      this.restoreCollection("webhooks", async (id, value) => {
        this.webhookEntries.set(id, value);
      }),
      this.restoreCollection("webhook-deliveries", async (id, value) => {
        this.webhookDeliveryEntries.set(id, value);
      }),
    ]);
    this.connected = true;
    Logger.info(
      "system",
      "storage",
      `Local file storage restored from ${this.directory}`,
    );
  }

  async saveInstance(instance: WorkflowInstance): Promise<void> {
    // 借用 MemoryStorage 写入后返回的那份引用当"写入前"快照的对照，
    // 以及待写入磁盘的值——省掉持久化路径里额外的 loadInstance 深拷贝。
    // 详见 MemoryStorage.saveInstanceAndPeek 的可见性警告。
    const previous = this.memory.getInstanceRef(instance.instanceId);
    const stored = await this.memory.saveInstanceAndPeek(instance);
    await this.persistOrRollback(
      "instances",
      instance.instanceId,
      stored,
      async () => {
        if (previous) await this.memory.saveInstance(previous);
        else await this.memory.deleteInstance(instance.instanceId);
      },
    );
  }

  async casUpdateInstance(instance: WorkflowInstance): Promise<boolean> {
    const previous = this.memory.getInstanceRef(instance.instanceId);
    const { updated, stored } =
      await this.memory.casUpdateInstanceAndPeek(instance);
    if (updated) {
      await this.persistOrRollback(
        "instances",
        instance.instanceId,
        stored,
        async () => {
          // The CAS already committed the new version in memory (this.memory
          // mutates its Map synchronously); if the disk write fails, force
          // the in-memory copy back to the pre-CAS value so a live read and
          // a restart-recovered read can't permanently disagree.
          if (previous) await this.memory.saveInstance(previous);
        },
      );
    }
    return updated;
  }

  async loadInstance(instanceId: string): Promise<WorkflowInstance | null> {
    return this.memory.loadInstance(instanceId);
  }

  async deleteInstance(instanceId: string): Promise<void> {
    await this.memory.deleteInstance(instanceId);
    await this.removeFile("instances", instanceId);
  }

  async listInstances(): Promise<string[]> {
    return this.memory.listInstances();
  }

  async queryInstances(
    params: InstanceQueryParams,
  ): Promise<{ instances: WorkflowInstance[]; total: number }> {
    return this.memory.queryInstances(params);
  }

  async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    const previous = await this.memory.loadWorkflow(workflow.id);
    await this.memory.saveWorkflow(workflow);
    if (this.isJsonSerializable(workflow)) {
      await this.persistOrRollback(
        "workflows",
        workflow.id,
        workflow,
        async () => {
          if (previous) await this.memory.saveWorkflow(previous);
          else await this.memory.deleteWorkflow(workflow.id);
        },
      );
    } else {
      Logger.warn(
        "system",
        "storage",
        `Workflow ${workflow.id} contains functions and was not persisted to disk`,
      );
    }
  }

  async loadWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
    return this.memory.loadWorkflow(workflowId);
  }

  async listWorkflows(): Promise<string[]> {
    return this.memory.listWorkflows();
  }

  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.memory.deleteWorkflow(workflowId);
    await this.removeFile("workflows", workflowId);
    await this.removeFile("workflow-metadata", workflowId);
    const versions = await this.listFiles("workflow-versions");
    await Promise.all(
      versions
        .filter((id) => id.startsWith(`${workflowId}__`))
        .map((id) => this.removeFile("workflow-versions", id)),
    );
  }

  async saveEventWaitingState(state: EventWaitingState): Promise<void> {
    const previous = await this.memory.loadEventWaitingState(
      state.instanceId,
      state.nodeId,
    );
    await this.memory.saveEventWaitingState(state);
    await this.persistOrRollback(
      "waiting",
      `${state.instanceId}__${state.nodeId}`,
      state,
      async () => {
        if (previous) await this.memory.saveEventWaitingState(previous);
        else
          await this.memory.deleteEventWaitingState(
            state.instanceId,
            state.nodeId,
          );
      },
    );
  }

  async loadEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<EventWaitingState | null> {
    return this.memory.loadEventWaitingState(instanceId, nodeId);
  }

  async loadAllEventWaitingStates(): Promise<EventWaitingState[]> {
    return this.memory.loadAllEventWaitingStates();
  }

  async deleteEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<void> {
    await this.memory.deleteEventWaitingState(instanceId, nodeId);
    await this.removeFile("waiting", `${instanceId}__${nodeId}`);
  }

  async saveWorkflowWithMetadata(workflow: StoredWorkflow): Promise<void> {
    const previous = await this.memory.loadWorkflowWithMetadata(workflow.id);
    await this.memory.saveWorkflowWithMetadata(workflow);
    if (this.isJsonSerializable(workflow.definition)) {
      await this.persistOrRollback(
        "workflow-metadata",
        workflow.id,
        workflow,
        async () => {
          if (previous) await this.memory.saveWorkflowWithMetadata(previous);
        },
      );
    }
  }

  async loadWorkflowWithMetadata(
    workflowId: string,
  ): Promise<StoredWorkflow | null> {
    return this.memory.loadWorkflowWithMetadata(workflowId);
  }

  async listWorkflowsWithMetadata(): Promise<StoredWorkflow[]> {
    return this.memory.listWorkflowsWithMetadata();
  }

  async saveWorkflowVersion(version: StoredWorkflowVersion): Promise<void> {
    const previous = await this.memory.loadWorkflowVersion(
      version.id,
      version.version,
    );
    await this.memory.saveWorkflowVersion(version);
    if (this.isJsonSerializable(version.definition)) {
      await this.persistOrRollback(
        "workflow-versions",
        `${version.id}__${version.version}`,
        version,
        async () => {
          if (previous) await this.memory.saveWorkflowVersion(previous);
        },
      );
    }
  }

  async loadWorkflowVersion(
    workflowId: string,
    version: number,
  ): Promise<StoredWorkflowVersion | null> {
    return this.memory.loadWorkflowVersion(workflowId, version);
  }

  async listWorkflowVersions(workflowId: string): Promise<number[]> {
    return this.memory.listWorkflowVersions(workflowId);
  }

  async saveInstanceMetrics(metrics: InstanceMetrics): Promise<void> {
    const previous = this.memory.peekInstanceMetricsForOwner(
      metrics.instanceId,
    );
    await this.memory.saveInstanceMetricsAndPeek(metrics);
    // 扇出成每节点一个文件，与 updateNodeMetrics 的布局保持一致。
    // 只在恢复和测试中调用，不是热路径。
    const nodeIds = Object.keys(metrics.nodeMetrics ?? {});
    await Promise.all(
      nodeIds.map((nodeId) =>
        this.persistOrRollback(
          "metrics",
          this.nodeMetricsId(metrics.instanceId, nodeId),
          this.nodeMetricsRecord(metrics, nodeId),
          async () => {
            if (previous) await this.memory.saveInstanceMetrics(previous);
          },
        ),
      ),
    );
  }

  async loadInstanceMetrics(
    instanceId: string,
  ): Promise<InstanceMetrics | null> {
    return this.memory.loadInstanceMetrics(instanceId);
  }

  /**
   * 只写入单个节点的 metrics 文件。
   *
   * 此前这里重写整份 `metrics/<instanceId>.json`——包含该实例所有其他节点的
   * metrics——来记录一个节点的变化，累计写入量因此是 Θ(nodes²)：100 个节点
   * 的工作流要写 1.55MB 才存下 15KB 的真实数据（见
   * src/benchmarks/storage-writes.test.ts 的基线）。
   *
   * 改为 `metrics/<instanceId>__<nodeId>.json` 后每次写入是 O(1)。
   * 内存形态与公开 API 不变：MemoryStorage 仍持有完整的 InstanceMetrics，
   * loadInstanceMetrics 仍返回组装好的整份记录，只有磁盘布局变了。
   */
  async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    const previous = this.memory.peekInstanceMetricsForOwner(instanceId);
    const current = await this.memory.updateNodeMetricsAndPeek(
      instanceId,
      nodeId,
      metrics,
    );
    await this.persistOrRollback(
      "metrics",
      this.nodeMetricsId(instanceId, nodeId),
      current ? this.nodeMetricsRecord(current, nodeId) : undefined,
      async () => {
        if (previous) await this.memory.saveInstanceMetrics(previous);
        else await this.memory.deleteInstanceMetrics(instanceId);
      },
    );
  }

  async deleteInstanceMetrics(instanceId: string): Promise<void> {
    const existing = this.memory.peekInstanceMetricsForOwner(instanceId);
    await this.memory.deleteInstanceMetrics(instanceId);
    const nodeIds = Object.keys(existing?.nodeMetrics ?? {});
    await Promise.all(
      nodeIds.map((nodeId) =>
        this.removeFile("metrics", this.nodeMetricsId(instanceId, nodeId)),
      ),
    );
    // 同时清掉可能残留的旧版整实例文件（升级前写下的布局）。
    await this.removeFile("metrics", instanceId);
  }

  async saveEvent(event: EventRecord): Promise<void> {
    // 借用 MemoryStorage 写入后返回的那份引用当"写入前"快照的对照，
    // 以及待写入磁盘的值——省掉持久化路径里额外的 loadEvent 深拷贝。
    // 详见 MemoryStorage.saveInstanceAndPeek 的可见性警告。
    const previous = this.memory.getEventRef(event.id);
    const stored = await this.memory.saveEventAndPeek(event);
    await this.persistOrRollback("events", event.id, stored, async () => {
      if (previous) await this.memory.saveEvent(previous);
      else await this.memory.deleteEvent(event.id);
    });
  }

  async loadEvent(eventId: string): Promise<EventRecord | null> {
    return this.memory.loadEvent(eventId);
  }

  async queryEvents(
    params: EventQueryParams,
  ): Promise<{ events: EventRecord[]; total: number }> {
    return this.memory.queryEvents(params);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.memory.deleteEvent(eventId);
    await this.removeFile("events", eventId);
  }

  async saveHeartbeat(state: HeartbeatState): Promise<void> {
    // Map 直接按 key 取，不再 loadAllHeartbeats()——那会把系统里**每一条**
    // heartbeat 都深拷贝一遍，只为找出其中一条的前值。
    const previous = this.memory.getHeartbeatRef(state.heartbeatKey);
    await this.memory.saveHeartbeatAndPeek(state);
    await this.persistOrRollback(
      "heartbeats",
      state.heartbeatKey,
      state,
      async () => {
        if (previous) await this.memory.saveHeartbeat(previous);
        else await this.memory.deleteHeartbeat(state.instanceId, state.nodeId);
      },
    );
  }

  async loadAllHeartbeats(): Promise<HeartbeatState[]> {
    return this.memory.loadAllHeartbeats();
  }

  async deleteHeartbeat(instanceId: string, nodeId: string): Promise<void> {
    await this.memory.deleteHeartbeat(instanceId, nodeId);
    await this.removeFile("heartbeats", `${instanceId}:${nodeId}`);
  }

  async cleanupStaleEvents(retentionDays: number): Promise<number> {
    const { count, ids } =
      await this.memory.cleanupStaleEventsWithIds(retentionDays);
    // 精确删除刚被清理掉的那些记录的文件。
    //
    // 此前这里要 queryEvents({pageSize: 1亿}) 物化并深拷贝整个事件库、
    // 排序、再和 readdir 的结果求差集——一次清理的代价与**存量**成正比，
    // 而不是与删除量成正比。孤儿文件交给下面的低频清扫兜底。
    await this.removeFilesConcurrently("events", ids);
    await this.sweepOrphans("events", (id) => this.memory.hasEventInMemory(id));
    return count;
  }

  async cleanupExpiredHeartbeats(): Promise<number> {
    const { count, ids } = await this.memory.cleanupExpiredHeartbeatsWithIds();
    await this.removeFilesConcurrently("heartbeats", ids);
    await this.sweepOrphans("heartbeats", (id) =>
      this.memory.hasHeartbeatFileKeyInMemory(id),
    );
    return count;
  }

  cleanupStaleInstances(maxAgeMs: number): number {
    const { count, ids } = this.memory.cleanupStaleInstancesWithIds(maxAgeMs);
    // 接口是同步的（返回 number），这里只能异步收尾。但不能让这个 promise
    // 彻底脱管：close() 需要等它结束，否则关闭过程可能和删文件抢跑；测试
    // 也需要一个可等待的句柄，而不是靠 sleep 猜时间。
    this.pendingFileCleanup = this.removeStaleInstanceFiles(ids).catch(
      (error: unknown) => {
        Logger.error(
          "system",
          "cleanup",
          "Failed to remove stale instance files",
          error instanceof Error ? error.stack : String(error),
        );
      },
    );
    return count;
  }

  /**
   * 等待 {@link cleanupStaleInstances} 触发的异步文件清理结束。
   *
   * 供 close() 与测试使用——清理本身是同步接口的异步收尾，没有这个句柄
   * 就只能靠 sleep 去猜它什么时候跑完。
   */
  async whenIdle(): Promise<void> {
    await this.pendingFileCleanup;
    await Promise.all(this.writeQueues.values());
  }

  async close(): Promise<void> {
    // 先等异步文件清理收尾，避免关闭过程与它抢跑
    await this.pendingFileCleanup;
    await Promise.all(this.writeQueues.values());
    this.connected = false;
    await this.memory.close();
  }

  async saveDeadLetterEntry(entry: unknown): Promise<void> {
    const id = (entry as { id?: string }).id;
    if (!id) throw new Error("Dead-letter entry requires an id");
    this.deadLetterEntries.set(id, entry);
    await this.persist("dlq", id, entry);
  }

  async loadAllDeadLetterEntries(): Promise<unknown[]> {
    return Array.from(this.deadLetterEntries.values());
  }

  async deleteDeadLetterEntry(id: string): Promise<void> {
    this.deadLetterEntries.delete(id);
    await this.removeFile("dlq", id);
  }

  async saveWebhookEntry(entry: unknown): Promise<void> {
    const id = (entry as { id?: string }).id;
    if (!id) throw new Error("Webhook entry requires an id");
    this.webhookEntries.set(id, entry);
    await this.persist("webhooks", id, entry);
  }

  async loadAllWebhookEntries(): Promise<unknown[]> {
    return Array.from(this.webhookEntries.values());
  }

  async deleteWebhookEntry(id: string): Promise<void> {
    this.webhookEntries.delete(id);
    await this.removeFile("webhooks", id);
  }

  async saveWebhookDeliveryEntry(entry: unknown): Promise<void> {
    const id = (entry as { id?: string }).id;
    if (!id) throw new Error("Webhook delivery entry requires an id");
    this.webhookDeliveryEntries.set(id, entry);
    await this.persist("webhook-deliveries", id, entry);
  }

  async loadAllWebhookDeliveryEntries(): Promise<unknown[]> {
    return Array.from(this.webhookDeliveryEntries.values());
  }

  async deleteWebhookDeliveryEntry(id: string): Promise<void> {
    this.webhookDeliveryEntries.delete(id);
    await this.removeFile("webhook-deliveries", id);
  }

  private async removeStaleInstanceFiles(
    cleanedIds: readonly string[],
  ): Promise<void> {
    // 内存侧刚删掉的实例，文件精确删除即可——不需要再 readdir 整个目录
    // 并逐个 loadInstance（那会把每个实例都深拷贝一遍）。
    await this.removeFilesConcurrently("instances", cleanedIds);
    await this.sweepOrphans(
      "instances",
      (id) => this.memory.getInstanceRef(id) != null,
    );
  }

  /** 并发删除一批文件，替代此前逐个 await 的串行 unlink。 */
  private async removeFilesConcurrently(
    collection: Collection,
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await mapWithConcurrency([...ids], async (id) => {
      await this.removeFile(collection, id);
    });
  }

  /**
   * 低频孤儿清扫：删掉磁盘上有、内存里已经没有的文件。
   *
   * 精确删除覆盖了正常路径，但崩溃可能在"内存已删、文件未删"之间留下孤儿。
   * 这里按 {@link ORPHAN_SWEEP_INTERVAL_MS} 的节奏兜底，而不是每次清理都
   * 全量 readdir 一遍。
   */
  private async sweepOrphans(
    collection: Collection,
    isLive: (id: string) => boolean,
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastOrphanSweep.get(collection) ?? 0;
    if (now - last < ORPHAN_SWEEP_INTERVAL_MS) return;
    this.lastOrphanSweep.set(collection, now);

    const orphans = (await this.listFiles(collection)).filter(
      (id) => !isLive(id),
    );
    if (orphans.length === 0) return;
    await this.removeFilesConcurrently(collection, orphans);
    Logger.debug(
      "system",
      "cleanup",
      `Swept ${orphans.length} orphaned ${collection} file(s)`,
    );
  }

  /**
   * 恢复 metrics。
   *
   * 两种磁盘布局都要认：
   *  - 新布局 `<instanceId>__<nodeId>.json`，每个文件一个节点；
   *  - 旧布局 `<instanceId>.json`，一个文件装整份 InstanceMetrics。
   *
   * 旧文件只读不改写——升级后它们会随各自节点的下一次 updateNodeMetrics
   * 自然被新布局取代，deleteInstanceMetrics 也会把它们一并清掉。
   *
   * 先把所有记录在内存里合并成完整的 InstanceMetrics，最后一次性
   * saveInstanceMetrics；逐条 save 会让每条记录都触发一次全量 clone。
   */
  private async restoreMetrics(): Promise<void> {
    const merged = new Map<string, InstanceMetrics>();

    const ensure = (
      instanceId: string,
      workflowId: string,
      createdAt: number,
      updatedAt: number,
    ): InstanceMetrics => {
      const existing = merged.get(instanceId);
      if (existing) {
        // 保留最早的 createdAt 与最晚的 updatedAt
        existing.createdAt = Math.min(existing.createdAt, createdAt);
        existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
        if (!existing.workflowId && workflowId)
          existing.workflowId = workflowId;
        return existing;
      }
      const fresh: InstanceMetrics = {
        instanceId,
        workflowId,
        nodeMetrics: {},
        createdAt,
        updatedAt,
      };
      merged.set(instanceId, fresh);
      return fresh;
    };

    await this.restoreCollection("metrics", async (id, value) => {
      const split = this.splitNodeMetricsId(id);
      if (!split) {
        // 旧布局：整份 InstanceMetrics
        const legacy = value as InstanceMetrics;
        const target = ensure(
          legacy.instanceId || id,
          legacy.workflowId ?? "",
          Number(legacy.createdAt) || Date.now(),
          Number(legacy.updatedAt) || Date.now(),
        );
        Object.assign(target.nodeMetrics, legacy.nodeMetrics ?? {});
        return;
      }

      const record = value as PersistedNodeMetrics;
      const target = ensure(
        record.instanceId || split.instanceId,
        record.workflowId ?? "",
        Number(record.createdAt) || Date.now(),
        Number(record.updatedAt) || Date.now(),
      );
      target.nodeMetrics[record.nodeId || split.nodeId] = record.metrics;
    });

    for (const metrics of merged.values()) {
      await this.memory.saveInstanceMetrics(metrics);
    }
  }

  /**
   * @param serialReplay 回放阶段是否必须串行。
   *
   * 绝大多数集合的回放是 `map.set(互不相同的 key, clone(value))`，彼此独立，
   * 可以并发。唯一的例外是 `workflow-versions`——它对嵌套 Map 做读-改-写
   * （见 MemoryStorage.saveWorkflowVersion），并发会丢版本。
   */
  private async restoreCollection(
    collection: Collection,
    restore: (id: string, value: unknown) => Promise<void>,
    serialReplay = false,
  ): Promise<void> {
    const ids = await this.listFiles(collection);

    // 读取与解析以受限并发进行：此前是逐个 await readFile，启动延迟等于
    // N × 系统调用往返，几万条记录时会让 connect() 卡上几分钟。
    type ReadResult =
      | { ok: true; id: string; value: unknown }
      | { ok: false; id: string; error: unknown };

    const concurrency = getRestoreConcurrency();
    const results = await mapWithConcurrency<string, ReadResult>(
      ids,
      async (id) => {
        try {
          const value = JSON.parse(
            await fs.promises.readFile(this.filePath(collection, id), "utf8"),
          );
          return { ok: true, id, value };
        } catch (error) {
          // 读取/解析失败才隔离——那是真正损坏的字节。
          // 这里不直接隔离，留到串行阶段，避免并发 rename 互相干扰。
          return { ok: false, id, error };
        }
      },
      concurrency,
    );

    // 隔离串行执行：并发 rename 会互相干扰。
    const corrupt = results.filter((result) => !result.ok);
    for (const result of corrupt) {
      await this.quarantine(
        collection,
        result.id,
        (result as { error: unknown }).error,
      );
    }

    const healthy = results.filter(
      (result): result is { ok: true; id: string; value: unknown } => result.ok,
    );

    // restore 回调抛错是**我们的 bug**，不是数据损坏。若一并隔离，
    // 一条完全合法的记录会被 rename 进 corrupt/ 而永久丢失。
    // 这里只记录并跳过，文件留在原地等修好的版本读取。
    const replayOne = async (result: {
      id: string;
      value: unknown;
    }): Promise<void> => {
      try {
        await restore(result.id, result.value);
      } catch (error) {
        Logger.error(
          "system",
          "storage",
          `Failed to restore ${collection} record ${result.id}; leaving the file in place`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    };

    if (serialReplay) {
      for (const result of healthy) await replayOne(result);
    } else {
      await mapWithConcurrency(healthy, replayOne, concurrency);
    }
  }

  private restoreInstance(value: unknown, id: string): WorkflowInstance {
    const instance = value as WorkflowInstance;
    return {
      ...instance,
      instanceId: instance.instanceId || id,
      createdAt: new Date(instance.createdAt),
      updatedAt: new Date(instance.updatedAt),
      history: (instance.history ?? []).map((entry) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
      })),
    };
  }

  private restoreEvent(event: EventRecord): EventRecord {
    return { ...event, timestamp: Number(event.timestamp) };
  }

  private async persist(
    collection: Collection,
    id: string,
    value: unknown,
  ): Promise<void> {
    if (!this.connected) return;
    if (value === null || value === undefined) return;
    const key = this.filePath(collection, id);

    // 把本次的值登记为该 key 的最新待写入值。若已有一个写操作在排队，
    // 它执行时会取走这里的最新值——中间那些已经过期的值就此被跳过，
    // 不再各自触发一次整文件重写。
    this.pendingValues.set(key, value);

    // 已有排队中（尚未开始执行）的写操作时，直接复用它：它必然会写入
    // 我们刚登记的值或更新的值，因此 await 它满足本次调用的持久化语义。
    //
    // 注意这**不是**持久性窗口：调用方依然要等到"包含自己的值或更严格
    // 更新的值"被 rename 落盘后才返回。被跳过的中间值只是从未被写过，
    // 这与"更新的那次写先发生"在崩溃语义上不可区分。
    const queued = this.queuedWrites.get(key);
    if (queued) {
      await queued;
      return;
    }

    // fsync 按集合决定：系统记录与审计历史要，纯派生的 metrics/heartbeats
    // 不要。见 DEFAULT_FSYNC_COLLECTIONS 的取舍说明。
    const shouldFsync =
      this.fsyncOnWrite && this.fsyncCollections.has(collection);

    const operation = async () => {
      // 进入执行阶段：本次写操作不再接受新的合并，后续调用要另起一个。
      this.queuedWrites.delete(key);
      const pending = this.pendingValues.get(key);
      this.pendingValues.delete(key);
      if (pending === undefined) return;

      const temp = `${key}.${process.pid}.${Date.now()}.tmp`;
      // 不做缩进：每次节点流转都会整体重写实例文件，2 空格缩进会把
      // I/O 放大 2-3 倍而没有任何运行时收益（需要可读性时用 jq）。
      const contents = JSON.stringify(pending);

      if (!shouldFsync) {
        // 默认路径：不需要 fsync 时用 writeFile 一次性完成，不额外打开/
        // 持有文件句柄，保持当前的写入开销不变。
        await fs.promises.writeFile(temp, contents, "utf8");
      } else {
        // fsyncOnWrite 路径：需要一个打开的句柄才能在 rename 之前调用
        // handle.sync()，把临时文件内容刷到磁盘——rename 的原子性只保证
        // "看到新文件就是完整的"，不保证内容已经落盘，主机级崩溃/断电时
        // 内容仍可能只停留在页缓存里。
        const handle = await fs.promises.open(temp, "w");
        try {
          await handle.writeFile(contents, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
      }

      await fs.promises.rename(temp, key);

      if (shouldFsync) {
        // rename 本身是目录元数据的变更，同样需要刷盘才能在断电后存活，
        // 否则重启后可能看到旧文件、新文件，或目录项丢失。
        await this.fsyncDirectory(path.dirname(key));
      }
    };
    const previous = this.writeQueues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.writeQueues.set(key, current);
    // 登记为"排队中"，让紧随其后的 persist() 能合并进来。operation 一旦
    // 开始执行就会把自己从这里摘掉（见上），因此合并只发生在真正还没
    // 落盘的窗口内。
    this.queuedWrites.set(key, current);
    try {
      await current;
    } finally {
      if (this.writeQueues.get(key) === current) {
        this.writeQueues.delete(key);
      }
      if (this.queuedWrites.get(key) === current) {
        this.queuedWrites.delete(key);
      }
    }
  }

  /**
   * Persist to disk after an in-memory write already landed, rolling the
   * in-memory state back to `rollback()` if the disk write fails. Every
   * MemoryStorage mutator commits to its Map synchronously before
   * LocalFileStorage gets a chance to persist, so a failed `persist()` would
   * otherwise leave memory ahead of disk with no way to reconcile them (a
   * restart would recover the older, correct-for-disk state while the live
   * process kept serving the newer one). `rollback` should restore the
   * in-memory collection to what it held before the mutation — typically a
   * `this.memory.saveX(previousValue)`/`this.memory.deleteX(...)` call — and
   * the original disk-write error is always rethrown so callers still see
   * the failure.
   */
  private async persistOrRollback(
    collection: Collection,
    id: string,
    value: unknown,
    rollback: () => Promise<void>,
  ): Promise<void> {
    const key = this.filePath(collection, id);
    const generation = (this.persistenceGenerations.get(key) ?? 0) + 1;
    this.persistenceGenerations.set(key, generation);

    // 记住"本批失败中最早的那个回滚点"。
    //
    // 并发写同一条记录时，每个调用方都在 await 之前就领走了自己的代号，
    // 因此 N 个并发写会拿到代号 1..N。若它们共享的那次落盘失败，只有代号
    // N 与当前代号相等——但代号 1..N-1 的调用方**也**已经把各自的值提交
    // 进内存了，回滚到代号 N 的快照只会退回到 N-1 写入的值，而磁盘上还是
    // 这批写入之前的内容。内存就此领先磁盘，正是本方法要防的情况。
    //
    // 只保留最早的那个快照，失败时回滚到它，内存才能真正回到"这批写入从
    // 未发生"的状态，与磁盘一致。成功落盘后清掉，下一批重新开始。
    if (!this.rollbackTargets.has(key)) {
      this.rollbackTargets.set(key, rollback);
    }

    try {
      await this.persist(collection, id, value);
      // 本次（或合并后更新的那次）已经落盘，之前排队的快照都不再需要。
      this.rollbackTargets.delete(key);
    } catch (error) {
      // 只有最新的调用方负责执行回滚：更早的调用方若也回滚一次，会把
      // 已经正确的内存状态反复写回同一个值，纯属多余。
      const isNewest = this.persistenceGenerations.get(key) === generation;
      if (isNewest) {
        const target = this.rollbackTargets.get(key) ?? rollback;
        this.rollbackTargets.delete(key);
        await target();
      }
      Logger.error(
        "system",
        "storage",
        `Failed to persist ${collection}/${id} to disk${isNewest ? "; rolled back in-memory state" : "; a newer mutation remains in memory"}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * fsync a directory's metadata after a rename into it. Coalesces concurrent
   * calls for the same directory into one fsync rather than one per write.
   */
  private async fsyncDirectory(directory: string): Promise<void> {
    const pending = this.directoryFsyncQueues.get(directory);
    if (pending) {
      await pending;
      return;
    }
    const operation = (async () => {
      const handle = await fs.promises.open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    })();
    this.directoryFsyncQueues.set(directory, operation);
    try {
      await operation;
    } finally {
      if (this.directoryFsyncQueues.get(directory) === operation) {
        this.directoryFsyncQueues.delete(directory);
      }
    }
  }

  private async removeFile(collection: Collection, id: string): Promise<void> {
    const key = this.filePath(collection, id);
    try {
      await fs.promises.unlink(key);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  /**
   * metrics 记录的磁盘 id：`<instanceId>__<nodeId>`。
   *
   * 沿用 workflow-versions 已有的 `__` 分隔约定。instanceId 与 nodeId 会先
   * 各自 encodeURIComponent，因此 id 本身含 `__` 也不会产生歧义
   * （encodeURIComponent 不转义 `_`，但下面的 split 取第一个 `__` 之前/之后，
   * 而真实 id 里的 `__` 会原样保留在两侧任一段——见 splitNodeMetricsId 的
   * 处理：以最后一个 `__` 为界，nodeId 不允许再含 `__` 的情况已被编码消解）。
   */
  private nodeMetricsId(instanceId: string, nodeId: string): string {
    return `${encodeURIComponent(instanceId)}__${encodeURIComponent(nodeId)}`;
  }

  /**
   * 拆解 metrics 文件 id。返回 null 表示这是旧版的整实例记录
   * （升级前写下的 `metrics/<instanceId>.json`）。
   */
  private splitNodeMetricsId(
    id: string,
  ): { instanceId: string; nodeId: string } | null {
    const separator = id.indexOf("__");
    if (separator === -1) return null;
    try {
      return {
        instanceId: decodeURIComponent(id.slice(0, separator)),
        nodeId: decodeURIComponent(id.slice(separator + 2)),
      };
    } catch {
      return null;
    }
  }

  /** 单个节点的磁盘记录：带上 instance 级字段，便于恢复时组装。 */
  private nodeMetricsRecord(
    metrics: InstanceMetrics,
    nodeId: string,
  ): PersistedNodeMetrics | undefined {
    const node = metrics.nodeMetrics?.[nodeId];
    if (!node) return undefined;
    return {
      instanceId: metrics.instanceId,
      workflowId: metrics.workflowId,
      createdAt: metrics.createdAt,
      updatedAt: metrics.updatedAt,
      nodeId,
      metrics: node,
    };
  }

  private filePath(collection: Collection, id: string): string {
    return path.join(this.directories[collection], `${this.safeId(id)}.json`);
  }

  private safeId(id: string): string {
    return encodeURIComponent(id);
  }

  /**
   * decodeURIComponent 对含裸 `%` 的文件名会抛 URIError。该调用发生在
   * restoreCollection 的 for...of 可迭代表达式里——在任何 per-record
   * try 之前——一个坏文件名就会让整个 connect() 崩掉。这里单独兜住。
   */
  private decodeId(name: string): string | null {
    try {
      return decodeURIComponent(name);
    } catch {
      return null;
    }
  }

  private async listFiles(collection: Collection): Promise<string[]> {
    const entries = await fs.promises.readdir(this.directories[collection], {
      withFileTypes: true,
    });

    const ids: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      const id = this.decodeId(entry.name.slice(0, -5));
      if (id === null) {
        Logger.warn(
          "system",
          "storage",
          `Skipping ${collection} file with an undecodable name`,
          { fileName: entry.name },
        );
        continue;
      }
      ids.push(id);
    }
    return ids;
  }

  private async quarantine(
    collection: Collection,
    id: string,
    error: unknown,
  ): Promise<void> {
    const source = this.filePath(collection, id);
    const target = path.join(
      this.directories[collection],
      "corrupt",
      `${this.safeId(id)}-${Date.now()}.json`,
    );
    try {
      await fs.promises.rename(source, target);
    } catch {
      // Best effort: startup should continue even if quarantine fails.
    }
    Logger.error(
      "system",
      "storage",
      `Quarantined corrupt ${collection} record ${id}`,
      error instanceof Error ? error.stack : String(error),
    );
  }

  private isJsonSerializable(value: unknown): boolean {
    const seen = new WeakSet<object>();
    const inspect = (current: unknown): boolean => {
      if (typeof current === "function" || typeof current === "symbol") {
        return false;
      }
      if (current === null || typeof current !== "object") {
        return true;
      }
      if (seen.has(current)) return false;
      seen.add(current);
      return Object.values(current).every(inspect);
    };

    try {
      return inspect(value) && JSON.stringify(value) !== undefined;
    } catch {
      return false;
    }
  }
}
