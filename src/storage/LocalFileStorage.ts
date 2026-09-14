// oxlint-disable no-explicit-any -- local persistence stores workflow payloads with dynamic shapes
import * as fs from "node:fs";
import * as path from "node:path";
import type { WorkflowInstance } from "../model/Instance";
import type { WorkflowDefinition } from "../model/Workflow";
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
 */
export class LocalFileStorage extends MemoryStorage {
  readonly directory: string;
  private readonly directories: Record<Collection, string>;
  private writeQueues = new Map<string, Promise<void>>();
  private deadLetterEntries = new Map<string, unknown>();
  private webhookEntries = new Map<string, unknown>();
  private webhookDeliveryEntries = new Map<string, unknown>();
  private connected = false;

  constructor(options: LocalFileStorageOptions | string) {
    super();
    this.directory = typeof options === "string" ? options : options.directory;
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
    await super.saveInstance(instance);
    await this.persist(
      "instances",
      instance.instanceId,
      await super.loadInstance(instance.instanceId),
    );
  }

  override async casUpdateInstance(
    instance: WorkflowInstance,
  ): Promise<boolean> {
    const updated = await super.casUpdateInstance(instance);
    if (updated) {
      await this.persist(
        "instances",
        instance.instanceId,
        await super.loadInstance(instance.instanceId),
      );
    }
    return updated;
  }

  override async deleteInstance(instanceId: string): Promise<void> {
    await super.deleteInstance(instanceId);
    await this.removeFile("instances", instanceId);
  }

  override async saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
    await super.saveWorkflow(workflow);
    if (this.isJsonSerializable(workflow)) {
      await this.persist("workflows", workflow.id, workflow);
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
    await super.saveEventWaitingState(state);
    await this.persist(
      "waiting",
      `${state.instanceId}__${state.nodeId}`,
      state,
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
    await super.saveWorkflowWithMetadata(workflow);
    if (this.isJsonSerializable(workflow.definition)) {
      await this.persist("workflow-metadata", workflow.id, workflow);
    }
  }

  override async saveWorkflowVersion(
    version: StoredWorkflowVersion,
  ): Promise<void> {
    await super.saveWorkflowVersion(version);
    if (this.isJsonSerializable(version.definition)) {
      await this.persist(
        "workflow-versions",
        `${version.id}__${version.version}`,
        version,
      );
    }
  }

  override async saveInstanceMetrics(metrics: InstanceMetrics): Promise<void> {
    await super.saveInstanceMetrics(metrics);
    await this.persist(
      "metrics",
      metrics.instanceId,
      await super.loadInstanceMetrics(metrics.instanceId),
    );
  }

  override async updateNodeMetrics(
    instanceId: string,
    nodeId: string,
    metrics: NodeMetrics,
  ): Promise<void> {
    await super.updateNodeMetrics(instanceId, nodeId, metrics);
    await this.persist(
      "metrics",
      instanceId,
      await super.loadInstanceMetrics(instanceId),
    );
  }

  override async saveEvent(event: EventRecord): Promise<void> {
    await super.saveEvent(event);
    await this.persist("events", event.id, await super.loadEvent(event.id));
  }

  override async deleteEvent(eventId: string): Promise<void> {
    await super.deleteEvent(eventId);
    await this.removeFile("events", eventId);
  }

  override async saveHeartbeat(state: HeartbeatState): Promise<void> {
    await super.saveHeartbeat(state);
    await this.persist("heartbeats", state.heartbeatKey, state);
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
    for (const id of await this.listFiles(collection)) {
      // 读取/解析失败才隔离——那是真正损坏的字节。
      let value: unknown;
      try {
        value = JSON.parse(
          await fs.promises.readFile(this.filePath(collection, id), "utf8"),
        );
      } catch (error) {
        await this.quarantine(collection, id, error);
        continue;
      }

      // restore 回调抛错是**我们的 bug**，不是数据损坏。若一并隔离，
      // 一条完全合法的记录会被 rename 进 corrupt/ 而永久丢失。
      // 这里只记录并跳过，文件留在原地等修好的版本读取。
      try {
        await restore(id, value);
      } catch (error) {
        Logger.error(
          "system",
          "storage",
          `Failed to restore ${collection} record ${id}; leaving the file in place`,
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
      await fs.promises.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
      await fs.promises.rename(temp, key);
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
