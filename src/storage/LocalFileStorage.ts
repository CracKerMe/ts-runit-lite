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
   * Tracks the latest in-memory mutation for each durable record. A failed
   * older write must never compensate over a newer mutation which has already
   * reached memory (and possibly disk).
   */
  private persistenceGenerations = new Map<string, number>();
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
    await this.restoreCollection("metrics", async (_id, value) =>
      super.saveInstanceMetrics(value as InstanceMetrics),
    );
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
    const previous = await super.loadInstance(instance.instanceId);
    await super.saveInstance(instance);
    await this.persistOrRollback(
      "instances",
      instance.instanceId,
      await super.loadInstance(instance.instanceId),
      async () => {
        if (previous) await super.saveInstance(previous);
        else await super.deleteInstance(instance.instanceId);
      },
    );
  }

  override async casUpdateInstance(
    instance: WorkflowInstance,
  ): Promise<boolean> {
    const previous = await super.loadInstance(instance.instanceId);
    const updated = await super.casUpdateInstance(instance);
    if (updated) {
      await this.persistOrRollback(
        "instances",
        instance.instanceId,
        await super.loadInstance(instance.instanceId),
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
    const previous = await super.loadInstanceMetrics(metrics.instanceId);
    await super.saveInstanceMetrics(metrics);
    await this.persistOrRollback(
      "metrics",
      metrics.instanceId,
      await super.loadInstanceMetrics(metrics.instanceId),
      async () => {
        if (previous) await super.saveInstanceMetrics(previous);
      },
    );
  }

  override async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    const previous = await super.loadInstanceMetrics(instanceId);
    await super.updateNodeMetrics(instanceId, nodeId, metrics);
    await this.persistOrRollback(
      "metrics",
      instanceId,
      await super.loadInstanceMetrics(instanceId),
      async () => {
        if (previous) await super.saveInstanceMetrics(previous);
      },
    );
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
    const operation = async () => {
      const temp = `${key}.${process.pid}.${Date.now()}.tmp`;
      // 不做缩进：每次节点流转都会整体重写实例文件，2 空格缩进会把
      // I/O 放大 2-3 倍而没有任何运行时收益（需要可读性时用 jq）。
      const contents = JSON.stringify(value);

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
    try {
      await current;
    } finally {
      if (this.writeQueues.get(key) === current) {
        this.writeQueues.delete(key);
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
    try {
      await this.persist(collection, id, value);
    } catch (error) {
      // A later mutation has superseded this write. Its state is the only
      // valid live state to retain, so rolling back to this operation's old
      // snapshot would reintroduce a memory/disk split.
      if (this.persistenceGenerations.get(key) === generation) {
        await rollback();
      }
      Logger.error(
        "system",
        "storage",
        `Failed to persist ${collection}/${id} to disk${this.persistenceGenerations.get(key) === generation ? "; rolled back in-memory state" : "; a newer mutation remains in memory"}`,
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
