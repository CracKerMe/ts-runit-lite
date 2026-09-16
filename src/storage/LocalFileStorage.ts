// oxlint-disable no-explicit-any -- local persistence stores workflow payloads with dynamic shapes
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
import { mapWithConcurrency } from "../utils/concurrency";
import { Logger } from "../utils/Logger";
import { MemoryStorage } from "./MemoryStorage";
import type {
  EventRecord,
  EventWaitingState,
  HeartbeatState,
  InstanceMetrics,
  NodeMetrics,
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
 * Durable single-process storage backed by one JSON file per record.
 *
 * MemoryStorage remains the hot index and query implementation. Files are the
 * recovery boundary: every mutation is written through a temp file and then
 * atomically renamed into place. This is intentionally not a distributed
 * store, but it protects workflow state from ordinary process restarts.
 *
 * By default writes are NOT fsync'd: the rename is atomic (readers never see
 * a half-written file), but the bytes can still live only in the page cache
 * until the OS flushes them, so an abrupt host crash or power loss can lose
 * the most recent writes even though callers already observed them succeed.
 * Pass `fsyncOnWrite: true` (or `FSYNC_ON_WRITE=true`, see AppConfig) to
 * trade write latency for surviving host-level failures too.
 */
export class LocalFileStorage extends MemoryStorage {
  readonly directory: string;
  private readonly directories: Record<Collection, string>;
  private readonly fsyncOnWrite: boolean;
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
  private deadLetterEntries = new Map<string, unknown>();
  private webhookEntries = new Map<string, unknown>();
  private webhookDeliveryEntries = new Map<string, unknown>();
  private connected = false;

  constructor(options: LocalFileStorageOptions | string) {
    super();
    this.directory = typeof options === "string" ? options : options.directory;
    this.fsyncOnWrite =
      typeof options === "string" ? false : (options.fsyncOnWrite ?? false);
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

  override async connect(): Promise<void> {
    for (const directory of Object.values(this.directories)) {
      await fs.promises.mkdir(directory, { recursive: true });
      await fs.promises.mkdir(path.join(directory, "corrupt"), {
        recursive: true,
      });
    }

    await super.connect();
    await this.restoreCollection("instances", async (id, value) =>
      super.saveInstance(this.restoreInstance(value, id)),
    );
    await this.restoreCollection("workflows", async (_id, value) =>
      super.saveWorkflow(value as WorkflowDefinition),
    );
    await this.restoreCollection("workflow-metadata", async (_id, value) =>
      super.saveWorkflowWithMetadata(value as StoredWorkflow),
    );
    await this.restoreCollection("workflow-versions", async (_id, value) =>
      super.saveWorkflowVersion(value as StoredWorkflowVersion),
    );
    await this.restoreCollection("waiting", async (_id, value) =>
      super.saveEventWaitingState(value as EventWaitingState),
    );
    await this.restoreMetrics();
    await this.restoreCollection("events", async (_id, value) =>
      super.saveEvent(this.restoreEvent(value as EventRecord)),
    );
    await this.restoreCollection("heartbeats", async (_id, value) =>
      super.saveHeartbeat(value as HeartbeatState),
    );
    await this.restoreCollection("dlq", async (id, value) => {
      this.deadLetterEntries.set(id, value);
    });
    await this.restoreCollection("webhooks", async (id, value) => {
      this.webhookEntries.set(id, value);
    });
    await this.restoreCollection("webhook-deliveries", async (id, value) => {
      this.webhookDeliveryEntries.set(id, value);
    });
    this.connected = true;
    Logger.info(
      "system",
      "storage",
      `Local file storage restored from ${this.directory}`,
    );
  }

  override async saveInstance(instance: WorkflowInstance): Promise<void> {
    // peekInstance 借用存储中的引用而不是再克隆一份：Map 条目永远整体
    // 替换，所以这份引用是一个稳定的"写入前"快照。回滚路径 super.saveInstance
    // 会在写回时重新深拷贝，因此调用方之后修改自己的对象也污染不到它。
    const previous = this.peekInstance(instance.instanceId);
    await super.saveInstance(instance);
    await this.persistOrRollback(
      "instances",
      instance.instanceId,
      // 存完直接借用 Map 里的那份 clone，省掉第二次 loadInstance。
      this.peekInstance(instance.instanceId),
      async () => {
        if (previous) await super.saveInstance(previous);
        else await super.deleteInstance(instance.instanceId);
      },
    );
  }

  override async casUpdateInstance(
    instance: WorkflowInstance,
  ): Promise<boolean> {
    const previous = this.peekInstance(instance.instanceId);
    const updated = await super.casUpdateInstance(instance);
    if (updated) {
      await this.persistOrRollback(
        "instances",
        instance.instanceId,
        // CAS 成功后 Map 里就是刚写入的新版本，直接借用，不再 load 一次。
        this.peekInstance(instance.instanceId),
        async () => {
          // The CAS already committed the new version in memory (super
          // mutates its Map synchronously); if the disk write fails, force
          // the in-memory copy back to the pre-CAS value so a live read and
          // a restart-recovered read can't permanently disagree.
          if (previous) await super.saveInstance(previous);
        },
      );
    }
    return updated;
  }

  override async deleteInstance(instanceId: string): Promise<void> {
    await super.deleteInstance(instanceId);
    await this.removeFile("instances", instanceId);
  }

  override async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    const previous = await super.loadWorkflow(workflow.id);
    await super.saveWorkflow(workflow);
    if (this.isJsonSerializable(workflow)) {
      await this.persistOrRollback(
        "workflows",
        workflow.id,
        workflow,
        async () => {
          if (previous) await super.saveWorkflow(previous);
          else await super.deleteWorkflow(workflow.id);
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

  override async deleteWorkflow(workflowId: string): Promise<void> {
    await super.deleteWorkflow(workflowId);
    await this.removeFile("workflows", workflowId);
    await this.removeFile("workflow-metadata", workflowId);
    const versions = await this.listFiles("workflow-versions");
    await Promise.all(
      versions
        .filter((id) => id.startsWith(`${workflowId}__`))
        .map((id) => this.removeFile("workflow-versions", id)),
    );
  }

  override async saveEventWaitingState(
    state: EventWaitingState,
  ): Promise<void> {
    const previous = await super.loadEventWaitingState(
      state.instanceId,
      state.nodeId,
    );
    await super.saveEventWaitingState(state);
    await this.persistOrRollback(
      "waiting",
      `${state.instanceId}__${state.nodeId}`,
      state,
      async () => {
        if (previous) await super.saveEventWaitingState(previous);
        else
          await super.deleteEventWaitingState(state.instanceId, state.nodeId);
      },
    );
  }

  override async deleteEventWaitingState(
    instanceId: string,
    nodeId: string,
  ): Promise<void> {
    await super.deleteEventWaitingState(instanceId, nodeId);
    await this.removeFile("waiting", `${instanceId}__${nodeId}`);
  }

  override async saveWorkflowWithMetadata(
    workflow: StoredWorkflow,
  ): Promise<void> {
    const previous = await super.loadWorkflowWithMetadata(workflow.id);
    await super.saveWorkflowWithMetadata(workflow);
    if (this.isJsonSerializable(workflow.definition)) {
      await this.persistOrRollback(
        "workflow-metadata",
        workflow.id,
        workflow,
        async () => {
          if (previous) await super.saveWorkflowWithMetadata(previous);
        },
      );
    }
  }

  override async saveWorkflowVersion(
    version: StoredWorkflowVersion,
  ): Promise<void> {
    const previous = await super.loadWorkflowVersion(
      version.id,
      version.version,
    );
    await super.saveWorkflowVersion(version);
    if (this.isJsonSerializable(version.definition)) {
      await this.persistOrRollback(
        "workflow-versions",
        `${version.id}__${version.version}`,
        version,
        async () => {
          if (previous) await super.saveWorkflowVersion(previous);
        },
      );
    }
  }

  override async saveInstanceMetrics(metrics: InstanceMetrics): Promise<void> {
    const previous = this.peekInstanceMetrics(metrics.instanceId);
    await super.saveInstanceMetrics(metrics);
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
            if (previous) await super.saveInstanceMetrics(previous);
          },
        ),
      ),
    );
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
  override async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    const previous = this.peekInstanceMetrics(instanceId);
    await super.updateNodeMetrics(instanceId, nodeId, metrics);
    const current = this.peekInstanceMetrics(instanceId);
    await this.persistOrRollback(
      "metrics",
      this.nodeMetricsId(instanceId, nodeId),
      current ? this.nodeMetricsRecord(current, nodeId) : undefined,
      async () => {
        if (previous) await super.saveInstanceMetrics(previous);
        else await super.deleteInstanceMetrics(instanceId);
      },
    );
  }

  override async deleteInstanceMetrics(instanceId: string): Promise<void> {
    const existing = this.peekInstanceMetrics(instanceId);
    await super.deleteInstanceMetrics(instanceId);
    const nodeIds = Object.keys(existing?.nodeMetrics ?? {});
    await Promise.all(
      nodeIds.map((nodeId) =>
        this.removeFile("metrics", this.nodeMetricsId(instanceId, nodeId)),
      ),
    );
    // 同时清掉可能残留的旧版整实例文件（升级前写下的布局）。
    await this.removeFile("metrics", instanceId);
  }

  override async saveEvent(event: EventRecord): Promise<void> {
    const previous = await super.loadEvent(event.id);
    await super.saveEvent(event);
    await this.persistOrRollback(
      "events",
      event.id,
      await super.loadEvent(event.id),
      async () => {
        if (previous) await super.saveEvent(previous);
        else await super.deleteEvent(event.id);
      },
    );
  }

  override async deleteEvent(eventId: string): Promise<void> {
    await super.deleteEvent(eventId);
    await this.removeFile("events", eventId);
  }

  override async saveHeartbeat(state: HeartbeatState): Promise<void> {
    const previous = (await super.loadAllHeartbeats()).find(
      (hb) => hb.heartbeatKey === state.heartbeatKey,
    );
    await super.saveHeartbeat(state);
    await this.persistOrRollback(
      "heartbeats",
      state.heartbeatKey,
      state,
      async () => {
        if (previous) await super.saveHeartbeat(previous);
        else await super.deleteHeartbeat(state.instanceId, state.nodeId);
      },
    );
  }

  override async deleteHeartbeat(
    instanceId: string,
    nodeId: string,
  ): Promise<void> {
    await super.deleteHeartbeat(instanceId, nodeId);
    await this.removeFile("heartbeats", `${instanceId}:${nodeId}`);
  }

  override async cleanupStaleEvents(retentionDays: number): Promise<number> {
    const deleted = await super.cleanupStaleEvents(retentionDays);
    const retained = await super.queryEvents({
      page: 1,
      pageSize: 100_000_000,
    });
    const retainedIds = new Set(retained.events.map((event) => event.id));
    for (const id of await this.listFiles("events")) {
      if (!retainedIds.has(id)) await this.removeFile("events", id);
    }
    return deleted;
  }

  override async cleanupExpiredHeartbeats(): Promise<number> {
    const deleted = await super.cleanupExpiredHeartbeats();
    const retained = new Set(
      (await super.loadAllHeartbeats()).map(
        (heartbeat) => `${heartbeat.instanceId}:${heartbeat.nodeId}`,
      ),
    );
    for (const id of await this.listFiles("heartbeats")) {
      if (!retained.has(id)) await this.removeFile("heartbeats", id);
    }
    return deleted;
  }

  override cleanupStaleInstances(maxAgeMs: number): number {
    const cleaned = super.cleanupStaleInstances(maxAgeMs);
    void this.removeStaleInstanceFiles(maxAgeMs);
    return cleaned;
  }

  override async close(): Promise<void> {
    await Promise.all(this.writeQueues.values());
    this.connected = false;
    await super.close();
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

  private async removeStaleInstanceFiles(maxAgeMs: number): Promise<void> {
    const threshold = Date.now() - maxAgeMs;
    const files = await this.listFiles("instances");
    for (const id of files) {
      const instance = await super.loadInstance(id);
      if (!instance) await this.removeFile("instances", id);
      else if (
        (instance.updatedAt?.getTime?.() ?? 0) < threshold &&
        ["completed", "failed"].includes(instance.status)
      ) {
        await this.removeFile("instances", id);
      }
    }
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
      await super.saveInstanceMetrics(metrics);
    }
  }

  private async restoreCollection(
    collection: Collection,
    restore: (id: string, value: unknown) => Promise<void>,
  ): Promise<void> {
    const ids = await this.listFiles(collection);

    // 读取与解析以受限并发进行：此前是逐个 await readFile，启动延迟等于
    // N × 系统调用往返，几万条记录时会让 connect() 卡上几分钟。
    type ReadResult =
      | { ok: true; id: string; value: unknown }
      | { ok: false; id: string; error: unknown };

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
    );

    // 恢复本身保持串行：restore 回调会写入共享的内存索引，
    // 并发执行会引入顺序依赖和竞态。
    for (const result of results) {
      if (!result.ok) {
        await this.quarantine(collection, result.id, result.error);
        continue;
      }

      // restore 回调抛错是**我们的 bug**，不是数据损坏。若一并隔离，
      // 一条完全合法的记录会被 rename 进 corrupt/ 而永久丢失。
      // 这里只记录并跳过，文件留在原地等修好的版本读取。
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

      if (!this.fsyncOnWrite) {
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

      if (this.fsyncOnWrite) {
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
   * `super.saveX(previousValue)`/`super.deleteX(...)` call — and the original
   * disk-write error is always rethrown so callers still see the failure.
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
