// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import webhookRoutes from "../../api/routes/webhooks";

vi.mock("../../utils/Logger", () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function buildApp(webhookManager: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).webhookManager = webhookManager;
    next();
  });
  app.use("/webhooks", webhookRoutes);
  return app;
}

describe("webhook delivery management routes", () => {
  let webhookManager: Record<string, unknown>;

  beforeEach(() => {
    webhookManager = {
      getAllWebhooks: vi.fn().mockReturnValue([]),
      getCleanupStatus: vi.fn().mockReturnValue({
        running: false,
        mode: "leader_only",
        intervalMs: 1000,
        retentionDays: 30,
        leaderOnlyEnabled: true,
        lastResult: "success",
      }),
      retryDeliveries: vi.fn().mockResolvedValue([
        { id: "d1", status: "pending" },
        { id: "d2", status: "pending" },
      ]),
      cleanupExpiredDeliveries: vi.fn().mockResolvedValue(3),
    };
  });

  it("retries deliveries in batch", async () => {
    const app = buildApp(webhookManager);

    const res = await supertest(app).post("/webhooks/deliveries/retry").send({
      workflowId: "wf-1",
      status: "dead_lettered",
    });

    expect(res.status).toBe(200);
    expect(webhookManager.retryDeliveries).toHaveBeenCalledWith({
      webhookId: undefined,
      event: undefined,
      workflowId: "wf-1",
      instanceId: undefined,
      status: "dead_lettered",
    });
    expect(res.body.data.count).toBe(2);
  });

  it("cleans up expired deliveries on demand", async () => {
    const app = buildApp(webhookManager);

    const res = await supertest(app).post("/webhooks/deliveries/cleanup");

    expect(res.status).toBe(200);
    expect(webhookManager.cleanupExpiredDeliveries).toHaveBeenCalled();
    expect(res.body.data.removed).toBe(3);
  });

  it("returns cleanup status", async () => {
    const app = buildApp(webhookManager);

    const res = await supertest(app).get("/webhooks/deliveries/cleanup/status");

    expect(res.status).toBe(200);
    expect(webhookManager.getCleanupStatus).toHaveBeenCalled();
    expect(res.body.data.mode).toBe("leader_only");
    expect(res.body.data.lastResult).toBe("success");
  });
});
