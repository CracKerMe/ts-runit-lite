import crypto from "node:crypto";
import axios, { type AxiosRequestConfig } from "axios";
import { v4 as uuidv4 } from "uuid";
import { getDLQ } from "../dlq/index";
import type { HookPayload } from "../event/HookManager";
import { recordWebhookDeliveryCleanup } from "../metrics/index";
import type { StorageProvider } from "../storage/StorageProvider";
import { Logger } from "../utils/Logger";
import { EventHistoryManager } from "./EventHistory";
import type {
  Webhook,
  WebhookDelivery,
  WebhookDeliveryCleanupStatus,
  WebhookPayload,
} from "./types";

interface DeliveryQuery {
  webhookId?: string;
  event?: string;
  workflowId?: string;
  instanceId?: string;
  status?: WebhookDelivery["status"];
  limit?: number;
  offset?: number;
}

export class WebhookManager {
  private webhooks: Map<string, Webhook> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private deliveryTimers: Map<string, NodeJS.Timeout> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleanupInProgress = false;
  private storage: StorageProvider | null = null;
  private eventHistory: EventHistoryManager | null = null;
  private lastCleanupStatus: WebhookDeliveryCleanupStatus;
  private readonly MAX_DELIVERY_ATTEMPTS = 5;
  private readonly REQUEST_TIMEOUT_MS = 5000;
  private readonly MAX_RETRY_DELAY_MS = 30000;
  private readonly DELIVERY_RETENTION_DAYS = Number.parseInt(
    process.env.WEBHOOK_DELIVERY_RETENTION_DAYS ||
      process.env.EVENT_RETENTION_DAYS ||
      "30",
    10,
  );
  private readonly CLEANUP_INTERVAL_MS = Number.parseInt(
    process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS ||
      process.env.CLEANUP_INTERVAL_MS ||
      "3600000",
    10,
  );
  private readonly CLEANUP_LEADER_ONLY =
    process.env.WEBHOOK_DELIVERY_CLEANUP_LEADER_ONLY === "true";

  constructor(storage?: StorageProvider) {
    this.lastCleanupStatus = {
      running: false,
      mode: this.CLEANUP_LEADER_ONLY ? "leader_only" : "all_nodes",
      intervalMs: this.CLEANUP_INTERVAL_MS,
      retentionDays: this.DELIVERY_RETENTION_DAYS,
      leaderOnlyEnabled: this.CLEANUP_LEADER_ONLY,
    };

    if (storage) {
      this.storage = storage;
      this.eventHistory = new EventHistoryManager(storage);
      this.loadStateFromStorage().catch((err) => {
        Logger.error(
          "webhook",
          "system",
          "Failed to load webhook state from storage",
          err instanceof Error ? err.stack : String(err),
        );
      });
    }
  }

  private async loadStateFromStorage(): Promise<void> {
    await this.loadWebhooksFromStorage();
    await this.loadDeliveriesFromStorage();
    await this.cleanupExpiredDeliveries();
    this.resumePendingDeliveries();
  }

  private async loadWebhooksFromStorage(): Promise<void> {
    if (!this.storage?.loadAllWebhookEntries) return;

    try {
      const entries = await this.storage.loadAllWebhookEntries();

      for (const raw of entries) {
        const webhook = raw as Webhook;
        webhook.createdAt = new Date(webhook.createdAt);
        webhook.updatedAt = new Date(webhook.updatedAt);
        if (webhook.lastSuccess) {
          webhook.lastSuccess = new Date(webhook.lastSuccess);
        }
        this.webhooks.set(webhook.id, webhook);
      }

      Logger.info(
        "webhook",
        "system",
        `Loaded ${entries.length} webhooks from storage`,
      );
    } catch (error) {
      Logger.error(
        "webhook",
        "system",
        "Failed to load webhooks from storage",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeDelivery(delivery: WebhookDelivery): WebhookDelivery {
    return {
      ...delivery,
      createdAt: new Date(delivery.createdAt),
      updatedAt: new Date(delivery.updatedAt),
      lastAttemptAt: delivery.lastAttemptAt
        ? new Date(delivery.lastAttemptAt)
        : undefined,
      nextAttemptAt: delivery.nextAttemptAt
        ? new Date(delivery.nextAttemptAt)
        : undefined,
    };
  }

  private async loadDeliveriesFromStorage(): Promise<void> {
    if (!this.storage?.loadAllWebhookDeliveryEntries) return;

    try {
      const entries = await this.storage.loadAllWebhookDeliveryEntries();

      for (const raw of entries) {
        const delivery = this.normalizeDelivery(raw as WebhookDelivery);
        this.deliveries.set(delivery.id, delivery);
      }

      Logger.info(
        "webhook",
        "system",
        `Loaded ${entries.length} webhook deliveries from storage`,
      );
    } catch (error) {
      Logger.error(
        "webhook",
        "system",
        "Failed to load webhook deliveries from storage",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private resumePendingDeliveries(): void {
    for (const delivery of this.deliveries.values()) {
      if (
        delivery.status === "pending" ||
        delivery.status === "retry_scheduled"
      ) {
        this.scheduleDelivery(delivery);
      }
    }
  }

  private async saveWebhookToStorage(webhook: Webhook): Promise<void> {
    await this.storage?.saveWebhookEntry?.(webhook);
  }

  private async removeWebhookFromStorage(id: string): Promise<void> {
    await this.storage?.deleteWebhookEntry?.(id);
  }

  private async saveDelivery(delivery: WebhookDelivery): Promise<void> {
    this.deliveries.set(delivery.id, delivery);
    await this.storage?.saveWebhookDeliveryEntry?.(delivery);
    // 此处原本每次状态流转都触发一次全量 cleanupExpiredDeliveries()
    // 扫描（一次投递要经历 pending→retry→…→failed 多次流转），
    // 而 startCleanupScheduler 的小时级定时器已经覆盖了保留策略。
  }

  private isTerminalDeliveryStatus(status: WebhookDelivery["status"]): boolean {
    return ["success", "failed", "dead_lettered"].includes(status);
  }

  private async deleteDelivery(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) {
      return;
    }

    const timer = this.deliveryTimers.get(deliveryId);
    if (timer) {
      clearTimeout(timer);
      this.deliveryTimers.delete(deliveryId);
    }

    this.deliveries.delete(deliveryId);
    await this.storage?.deleteWebhookDeliveryEntry?.(deliveryId);
  }

  async cleanupExpiredDeliveries(): Promise<number> {
    const retentionMs = this.DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    const expiredIds = Array.from(this.deliveries.values())
      .filter(
        (delivery) =>
          this.isTerminalDeliveryStatus(delivery.status) &&
          delivery.updatedAt.getTime() < cutoff,
      )
      .map((delivery) => delivery.id);

    if (expiredIds.length === 0) {
      return 0;
    }

    for (const deliveryId of expiredIds) {
      await this.deleteDelivery(deliveryId);
    }

    Logger.info(
      "webhook",
      "cleanup",
      `Removed ${expiredIds.length} expired webhook delivery records`,
      {
        retentionDays: this.DELIVERY_RETENTION_DAYS,
      },
    );

    return expiredIds.length;
  }

  getCleanupStatus(): WebhookDeliveryCleanupStatus {
    return {
      ...this.lastCleanupStatus,
      lastRunAt: this.lastCleanupStatus.lastRunAt
        ? new Date(this.lastCleanupStatus.lastRunAt)
        : undefined,
      lastSuccessAt: this.lastCleanupStatus.lastSuccessAt
        ? new Date(this.lastCleanupStatus.lastSuccessAt)
        : undefined,
    };
  }

  startCleanupScheduler(): void {
    if (this.cleanupTimer || this.CLEANUP_INTERVAL_MS <= 0) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.runScheduledCleanup();
    }, this.CLEANUP_INTERVAL_MS);

    Logger.info(
      "webhook",
      "cleanup",
      `Webhook delivery cleanup scheduled every ${this.CLEANUP_INTERVAL_MS}ms`,
      {
        retentionDays: this.DELIVERY_RETENTION_DAYS,
      },
    );
  }

  stopCleanupScheduler(): void {
    if (!this.cleanupTimer) {
      return;
    }

    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    Logger.info(
      "webhook",
      "cleanup",
      "Webhook delivery cleanup scheduler stopped",
    );
  }

  private async runScheduledCleanup(): Promise<void> {
    const startedAt = Date.now();
    const mode = this.lastCleanupStatus.mode;

    if (this.shouldSkipCleanupOnFollower()) {
      this.lastCleanupStatus = {
        ...this.lastCleanupStatus,
        lastRunAt: new Date(),
        lastResult: "skipped",
        lastDurationMs: Date.now() - startedAt,
        lastRemovedCount: 0,
        lastError: undefined,
      };
      recordWebhookDeliveryCleanup(
        "skipped",
        mode,
        (Date.now() - startedAt) / 1000,
        0,
      );
      Logger.debug(
        "webhook",
        "cleanup",
        "Skipping webhook delivery cleanup on non-leader node",
      );
      return;
    }

    if (this.cleanupInProgress) {
      Logger.warn(
        "webhook",
        "cleanup",
        "Skipping webhook delivery cleanup because a previous run is still in progress",
      );
      return;
    }

    this.cleanupInProgress = true;
    this.lastCleanupStatus = {
      ...this.lastCleanupStatus,
      running: true,
    };

    try {
      const removed = await this.cleanupExpiredDeliveries();
      const durationMs = Date.now() - startedAt;
      this.lastCleanupStatus = {
        ...this.lastCleanupStatus,
        running: false,
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        lastResult: "success",
        lastDurationMs: durationMs,
        lastRemovedCount: removed,
        lastError: undefined,
      };
      recordWebhookDeliveryCleanup("success", mode, durationMs / 1000, removed);
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.lastCleanupStatus = {
        ...this.lastCleanupStatus,
        running: false,
        lastRunAt: new Date(),
        lastResult: "failed",
        lastDurationMs: durationMs,
        lastRemovedCount: 0,
        lastError: error instanceof Error ? error.message : String(error),
      };
      recordWebhookDeliveryCleanup("failed", mode, durationMs / 1000, 0);
      Logger.error(
        "webhook",
        "cleanup",
        "Scheduled webhook delivery cleanup failed",
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.cleanupInProgress = false;
      this.lastCleanupStatus = {
        ...this.lastCleanupStatus,
        running: false,
      };
    }
  }

  private shouldSkipCleanupOnFollower(): boolean {
    // Single-process, in-memory deployment only — there is no follower to skip.
    return false;
  }

  async createWebhook(
    webhookData: Omit<Webhook, "id" | "createdAt" | "updatedAt" | "isActive">,
  ): Promise<Webhook> {
    const id = uuidv4();
    const now = new Date();

    const webhook: Webhook = {
      id,
      ...webhookData,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      failedAttempts: 0,
    };

    this.webhooks.set(id, webhook);
    await this.saveWebhookToStorage(webhook);

    Logger.info(
      "webhook",
      "system",
      `Created webhook ${id} for events: ${webhook.events.join(", ")}`,
    );
    return webhook;
  }

  async updateWebhook(
    id: string,
    data: Partial<Webhook>,
  ): Promise<Webhook | null> {
    const webhook = this.webhooks.get(id);
    if (!webhook) return null;

    const updatedWebhook: Webhook = {
      ...webhook,
      ...data,
      id: webhook.id,
      updatedAt: new Date(),
    };

    this.webhooks.set(id, updatedWebhook);
    await this.saveWebhookToStorage(updatedWebhook);
    return updatedWebhook;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    const exists = this.webhooks.has(id);
    if (!exists) return false;

    this.webhooks.delete(id);
    await this.removeWebhookFromStorage(id);
    return true;
  }

  getAllWebhooks(): Webhook[] {
    return Array.from(this.webhooks.values());
  }

  getWebhook(id: string): Webhook | undefined {
    return this.webhooks.get(id);
  }

  listDeliveries(query: DeliveryQuery = {}): {
    deliveries: WebhookDelivery[];
    total: number;
  } {
    let deliveries = Array.from(this.deliveries.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    if (query.webhookId) {
      deliveries = deliveries.filter(
        (item) => item.webhookId === query.webhookId,
      );
    }
    if (query.event) {
      deliveries = deliveries.filter((item) => item.event === query.event);
    }
    if (query.workflowId) {
      deliveries = deliveries.filter(
        (item) => item.workflowId === query.workflowId,
      );
    }
    if (query.instanceId) {
      deliveries = deliveries.filter(
        (item) => item.instanceId === query.instanceId,
      );
    }
    if (query.status) {
      deliveries = deliveries.filter((item) => item.status === query.status);
    }

    const total = deliveries.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 100;

    return {
      deliveries: deliveries.slice(offset, offset + limit),
      total,
    };
  }

  getDelivery(id: string): WebhookDelivery | undefined {
    return this.deliveries.get(id);
  }

  async retryDelivery(id: string): Promise<WebhookDelivery> {
    const delivery = this.deliveries.get(id);
    if (!delivery) {
      throw new Error(`Webhook delivery not found: ${id}`);
    }

    const nextDelivery: WebhookDelivery = {
      ...delivery,
      status: "pending",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
      lastError: undefined,
      dlqEntryId: undefined,
    };

    await this.saveDelivery(nextDelivery);
    this.scheduleDelivery(nextDelivery);
    return nextDelivery;
  }

  async retryDeliveries(
    query: Omit<DeliveryQuery, "limit" | "offset"> = {},
  ): Promise<WebhookDelivery[]> {
    const deliveries = this.listDeliveries({
      ...query,
      limit: Number.MAX_SAFE_INTEGER,
      offset: 0,
    }).deliveries;

    const retriable = deliveries.filter((delivery) =>
      ["failed", "dead_lettered"].includes(delivery.status),
    );

    const retried: WebhookDelivery[] = [];
    for (const delivery of retriable) {
      retried.push(await this.retryDelivery(delivery.id));
    }

    return retried;
  }

  async triggerEvent(
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const payload: HookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
      instanceId: data?.instanceId as string | undefined,
      workflowId: data?.workflowId as string | undefined,
      traceId: data?.traceId as string | undefined,
    };

    await this.triggerHook(payload, "api");
  }

  async triggerHook(
    payload: HookPayload,
    source: "api" | "system" | "webhook" = "system",
  ): Promise<void> {
    const timestamp = payload.timestamp || new Date().toISOString();
    const normalizedPayload: WebhookPayload = {
      ...payload,
      timestamp,
    };

    let eventId: string | undefined;
    if (this.eventHistory) {
      eventId = await this.eventHistory.recordEvent(
        normalizedPayload.event,
        normalizedPayload,
        source,
        normalizedPayload.instanceId,
      );
    }

    const relevantWebhooks = Array.from(this.webhooks.values()).filter(
      (webhook) =>
        webhook.isActive && webhook.events.includes(normalizedPayload.event),
    );

    if (relevantWebhooks.length === 0) {
      return;
    }

    await Promise.all(
      relevantWebhooks.map((webhook) =>
        this.enqueueDelivery(webhook, normalizedPayload, source, eventId),
      ),
    );
  }

  private async enqueueDelivery(
    webhook: Webhook,
    payload: WebhookPayload,
    source: "api" | "system" | "webhook",
    eventId?: string,
  ): Promise<void> {
    const now = new Date();
    const delivery: WebhookDelivery = {
      id: uuidv4(),
      webhookId: webhook.id,
      event: payload.event,
      eventId,
      workflowId: payload.workflowId,
      instanceId: payload.instanceId,
      source,
      payload: structuredClone(payload),
      status: "pending",
      attemptCount: 0,
      maxAttempts: this.MAX_DELIVERY_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
    };

    await this.saveDelivery(delivery);
    this.scheduleDelivery(delivery);
  }

  private scheduleDelivery(delivery: WebhookDelivery): void {
    const existingTimer = this.deliveryTimers.get(delivery.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const dueAt = delivery.nextAttemptAt?.getTime() ?? Date.now();
    const delay = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
      this.deliveryTimers.delete(delivery.id);
      this.processDelivery(delivery.id).catch((error) => {
        Logger.error(
          "webhook",
          delivery.webhookId,
          `Failed to process delivery ${delivery.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    }, delay);

    this.deliveryTimers.set(delivery.id, timer);
  }

  private computeRetryDelay(attemptCount: number): number {
    const retryDelay = 2 ** Math.max(0, attemptCount - 1) * 1000;
    return Math.min(retryDelay, this.MAX_RETRY_DELAY_MS);
  }

  private async processDelivery(deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery) return;

    const webhook = this.webhooks.get(delivery.webhookId);
    if (!webhook || !webhook.isActive) {
      const skippedDelivery: WebhookDelivery = {
        ...delivery,
        status: "failed",
        updatedAt: new Date(),
        lastError: webhook ? "Webhook is inactive" : "Webhook not found",
      };
      await this.saveDelivery(skippedDelivery);
      return;
    }

    const startTime = Date.now();
    let payload = structuredClone(delivery.payload);

    try {
      if (webhook.secret) {
        payload = {
          ...payload,
          signature: this.createSignature(payload, webhook.secret),
        };
      }

      const config: AxiosRequestConfig = {
        headers: {
          "Content-Type": "application/json",
          ...webhook.headers,
        },
        timeout: this.REQUEST_TIMEOUT_MS,
      };

      const response = await axios.post(webhook.url, payload, config);
      const responseTime = Date.now() - startTime;

      await this.updateWebhook(webhook.id, {
        failedAttempts: 0,
        lastSuccess: new Date(),
      });

      const nextDelivery: WebhookDelivery = {
        ...delivery,
        payload,
        status: "success",
        attemptCount: delivery.attemptCount + 1,
        updatedAt: new Date(),
        lastAttemptAt: new Date(),
        nextAttemptAt: undefined,
        lastStatusCode: response.status,
        lastError: undefined,
        lastResponseTime: responseTime,
      };
      await this.saveDelivery(nextDelivery);

      if (this.eventHistory && delivery.eventId) {
        await this.eventHistory.recordWebhookDelivery(
          delivery.eventId,
          webhook.id,
          "success",
          {
            statusCode: response.status,
            responseTime,
          },
        );
      }
    } catch (error: unknown) {
      const attemptCount = delivery.attemptCount + 1;
      const responseTime = Date.now() - startTime;
      const statusCode =
        error instanceof Error && "response" in error
          ? ((error.response as Record<string, unknown>)?.status as
              | number
              | undefined)
          : undefined;
      const msg = error instanceof Error ? error.message : String(error);

      await this.updateWebhook(webhook.id, {
        failedAttempts: attemptCount,
        lastFailure: msg,
      });

      if (this.eventHistory && delivery.eventId) {
        await this.eventHistory.recordWebhookDelivery(
          delivery.eventId,
          webhook.id,
          "failed",
          {
            statusCode,
            responseTime,
            errorMessage: msg,
          },
        );
      }

      if (attemptCount < delivery.maxAttempts) {
        const retryDelayMs = this.computeRetryDelay(attemptCount);
        const retryDelivery: WebhookDelivery = {
          ...delivery,
          status: "retry_scheduled",
          attemptCount,
          updatedAt: new Date(),
          lastAttemptAt: new Date(),
          nextAttemptAt: new Date(Date.now() + retryDelayMs),
          lastStatusCode: statusCode,
          lastError: msg,
          lastResponseTime: responseTime,
        };
        await this.saveDelivery(retryDelivery);
        this.scheduleDelivery(retryDelivery);
        return;
      }

      const dlqEntryId = await getDLQ().push({
        type: "event",
        payload: {
          webhookId: webhook.id,
          deliveryId: delivery.id,
          payload,
          eventId: delivery.eventId,
        },
        error: msg,
        retryCount: attemptCount,
        workflowId: payload.workflowId,
        instanceId: payload.instanceId,
        metadata: {
          event: payload.event,
          source: delivery.source,
          statusCode,
        },
      });

      const failedDelivery: WebhookDelivery = {
        ...delivery,
        payload,
        status: "dead_lettered",
        attemptCount,
        updatedAt: new Date(),
        lastAttemptAt: new Date(),
        nextAttemptAt: undefined,
        lastStatusCode: statusCode,
        lastError: msg,
        lastResponseTime: responseTime,
        dlqEntryId,
      };
      await this.saveDelivery(failedDelivery);
    }
  }

  private createSignature(payload: WebhookPayload, secret: string): string {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(JSON.stringify(payload.data));
    return hmac.digest("hex");
  }

  async testWebhook(id: string): Promise<boolean> {
    const webhook = this.webhooks.get(id);
    if (!webhook) return false;

    const testPayload: WebhookPayload = {
      event: "test_event",
      timestamp: new Date().toISOString(),
      data: {
        message: "This is a test webhook from TS Workflow Engine",
        timestamp: Date.now(),
      },
    };

    await this.enqueueDelivery(webhook, testPayload, "api");
    return true;
  }

  destroy(): void {
    this.stopCleanupScheduler();

    for (const timer of this.deliveryTimers.values()) {
      clearTimeout(timer);
    }

    this.deliveryTimers.clear();
  }
}
