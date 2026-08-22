import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadLetterQueue, setDLQ } from "../../dlq/index";
import { getMetrics } from "../../metrics/index";
import { WebhookManager } from "../WebhookManager";

vi.mock("axios");
vi.mock("../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("WebhookManager deliveries", () => {
  const originalCleanupInterval =
    process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS;
  const originalCleanupLeaderOnly =
    process.env.WEBHOOK_DELIVERY_CLEANUP_LEADER_ONLY;

  beforeEach(() => {
    vi.useFakeTimers();
    setDLQ(new DeadLetterQueue());
    process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS = "1000";
    delete process.env.WEBHOOK_DELIVERY_CLEANUP_LEADER_ONLY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    if (originalCleanupInterval === undefined) {
      delete process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS;
    } else {
      process.env.WEBHOOK_DELIVERY_CLEANUP_INTERVAL_MS =
        originalCleanupInterval;
    }

    if (originalCleanupLeaderOnly === undefined) {
      delete process.env.WEBHOOK_DELIVERY_CLEANUP_LEADER_ONLY;
    } else {
      process.env.WEBHOOK_DELIVERY_CLEANUP_LEADER_ONLY =
        originalCleanupLeaderOnly;
    }
  });

  it("retries failed deliveries and marks success on a later attempt", async () => {
    vi.mocked(axios.post)
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({ status: 200 });

    const manager = new WebhookManager();
    const webhook = await manager.createWebhook({
      name: "orders",
      url: "https://example.com/webhook",
      events: ["order.created"],
    });

    await manager.triggerEvent("order.created", { orderId: "o-1" });
    await vi.runOnlyPendingTimersAsync();

    let delivery = manager.listDeliveries().deliveries[0];
    expect(delivery.webhookId).toBe(webhook.id);
    expect(delivery.status).toBe("retry_scheduled");
    expect(delivery.attemptCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);

    delivery = manager.listDeliveries().deliveries[0];
    expect(delivery.status).toBe("success");
    expect(delivery.attemptCount).toBe(2);
    expect(delivery.lastStatusCode).toBe(200);
  });

  it("moves exhausted deliveries to DLQ", async () => {
    vi.mocked(axios.post).mockRejectedValue(
      new Error("downstream unavailable"),
    );

    const dlq = new DeadLetterQueue();
    setDLQ(dlq);

    const manager = new WebhookManager();
    await manager.createWebhook({
      name: "billing",
      url: "https://example.com/billing",
      events: ["invoice.failed"],
    });

    await manager.triggerEvent("invoice.failed", {
      invoiceId: "inv-1",
      workflowId: "wf-1",
      instanceId: "inst-1",
    });

    for (let i = 0; i < 5; i++) {
      await vi.runOnlyPendingTimersAsync();
      await vi.advanceTimersByTimeAsync(30_000);
    }

    const delivery = manager.listDeliveries().deliveries[0];
    expect(delivery.status).toBe("dead_lettered");
    expect(delivery.dlqEntryId).toBeTruthy();

    const entry = await dlq.get(delivery.dlqEntryId as string);
    expect(entry?.type).toBe("event");
    expect(entry?.payload.deliveryId).toBe(delivery.id);
  });

  it("filters deliveries by workflow and instance identifiers", async () => {
    vi.mocked(axios.post).mockResolvedValue({ status: 200 });

    const manager = new WebhookManager();
    await manager.createWebhook({
      name: "orders",
      url: "https://example.com/orders",
      events: ["order.created"],
    });

    await manager.triggerEvent("order.created", {
      workflowId: "wf-a",
      instanceId: "inst-a",
    });
    await manager.triggerEvent("order.created", {
      workflowId: "wf-b",
      instanceId: "inst-b",
    });
    await vi.runAllTimersAsync();

    expect(
      manager.listDeliveries({ workflowId: "wf-a" }).deliveries,
    ).toHaveLength(1);
    expect(
      manager.listDeliveries({ instanceId: "inst-b" }).deliveries,
    ).toHaveLength(1);
  });

  it("cleans up expired terminal delivery records", async () => {
    vi.mocked(axios.post).mockResolvedValue({ status: 200 });
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));

    const manager = new WebhookManager();
    await manager.createWebhook({
      name: "cleanup",
      url: "https://example.com/cleanup",
      events: ["cleanup.event"],
    });

    await manager.triggerEvent("cleanup.event", {});
    await vi.runAllTimersAsync();
    expect(manager.listDeliveries().deliveries).toHaveLength(1);

    vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
    const removed = await manager.cleanupExpiredDeliveries();

    expect(removed).toBe(1);
    expect(manager.listDeliveries().deliveries).toHaveLength(0);
  });

  it("runs webhook delivery cleanup on a background interval", async () => {
    vi.mocked(axios.post).mockResolvedValue({ status: 200 });
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));

    const manager = new WebhookManager();
    await manager.createWebhook({
      name: "cleanup-scheduler",
      url: "https://example.com/cleanup-scheduler",
      events: ["cleanup.scheduler"],
    });

    await manager.triggerEvent("cleanup.scheduler", {});
    await vi.runAllTimersAsync();
    expect(manager.listDeliveries().deliveries).toHaveLength(1);

    vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
    manager.startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    expect(manager.listDeliveries().deliveries).toHaveLength(0);
    manager.destroy();
  });

  it("stops background cleanup when destroyed", async () => {
    const cleanupSpy = vi.spyOn(
      WebhookManager.prototype,
      "cleanupExpiredDeliveries",
    );
    const manager = new WebhookManager();

    manager.startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    manager.destroy();
    await vi.advanceTimersByTimeAsync(5000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
  });

  it("reports cleanup status and metrics after a scheduled run", async () => {
    vi.mocked(axios.post).mockResolvedValue({ status: 200 });
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));

    const manager = new WebhookManager();
    await manager.createWebhook({
      name: "cleanup-observe",
      url: "https://example.com/cleanup-observe",
      events: ["cleanup.observe"],
    });

    await manager.triggerEvent("cleanup.observe", {});
    await vi.runAllTimersAsync();

    vi.setSystemTime(new Date("2026-08-15T00:00:00.000Z"));
    manager.startCleanupScheduler();
    await vi.advanceTimersByTimeAsync(1000);

    const status = manager.getCleanupStatus();
    expect(status.lastResult).toBe("success");
    expect(status.lastRemovedCount).toBe(1);
    expect(status.lastRunAt).toBeDefined();
    expect(status.lastSuccessAt).toBeDefined();

    const metrics = getMetrics();
    expect(metrics).toContain("webhook_delivery_cleanup_runs_total");
    expect(metrics).toContain("webhook_delivery_cleanup_removed_total");
    expect(metrics).toContain('result="success"');

    manager.destroy();
  });
});
