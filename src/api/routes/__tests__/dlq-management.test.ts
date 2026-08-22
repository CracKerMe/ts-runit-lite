// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeadLetterQueue } from "../../../dlq/DeadLetterQueue";
import dlqRoutes from "../dlq";

function createApp(dlq: DeadLetterQueue, engine: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).dlq = dlq;
    (req as any).engine = engine;
    next();
  });
  app.use("/", dlqRoutes);
  return app;
}

async function pushWorkflowEntry(
  dlq: DeadLetterQueue,
  workflowId = "order-flow",
): Promise<string> {
  return dlq.push({
    type: "workflow",
    payload: { context: { orderId: "ORD-1" } },
    error: "boom",
    retryCount: 0,
    workflowId,
  });
}

describe("DeadLetterQueue.updateStatus", () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  it("should update status and notes on an entry", async () => {
    const id = await pushWorkflowEntry(dlq);
    const ok = await dlq.updateStatus(id, "acknowledged", "手动确认");
    expect(ok).toBe(true);

    const entry = await dlq.get(id);
    expect(entry?.status).toBe("acknowledged");
    expect(entry?.notes).toBe("手动确认");
  });

  it("should return false for unknown entry", async () => {
    const ok = await dlq.updateStatus("nope", "acknowledged");
    expect(ok).toBe(false);
  });
});

describe("DLQ management routes", () => {
  let dlq: DeadLetterQueue;
  let engine: { start: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dlq = new DeadLetterQueue();
    engine = { start: vi.fn().mockResolvedValue("new-instance-1") };
  });

  it("PATCH /:id should update entry status", async () => {
    const id = await pushWorkflowEntry(dlq);
    const app = createApp(dlq, engine);

    const res = await request(app)
      .patch(`/${id}`)
      .send({ status: "acknowledged", notes: "data fixed" })
      .expect(200);

    expect(res.body.data.status).toBe("acknowledged");
    const entry = await dlq.get(id);
    expect(entry?.status).toBe("acknowledged");
    expect(entry?.notes).toBe("data fixed");
  });

  it("PATCH /:id should reject invalid status", async () => {
    const id = await pushWorkflowEntry(dlq);
    const app = createApp(dlq, engine);
    await request(app).patch(`/${id}`).send({ status: "bogus" }).expect(400);
  });

  it("PATCH /:id should 404 for unknown entry", async () => {
    const app = createApp(dlq, engine);
    await request(app)
      .patch("/unknown-id")
      .send({ status: "acknowledged" })
      .expect(404);
  });

  it("POST /batch/retry should retry entries with partial success", async () => {
    const id1 = await pushWorkflowEntry(dlq, "flow-a");
    const id2 = await pushWorkflowEntry(dlq, "flow-b");
    const app = createApp(dlq, engine);

    const res = await request(app)
      .post("/batch/retry")
      .send({ ids: [id1, id2, "missing-id"] })
      .expect(200);

    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.results).toHaveLength(3);
    expect(engine.start).toHaveBeenCalledTimes(2);

    const ok = res.body.data.results.filter((r: any) => r.ok);
    expect(ok.every((r: any) => r.newInstanceId === "new-instance-1")).toBe(
      true,
    );
  });

  it("POST /batch/retry should reject oversized batches", async () => {
    const app = createApp(dlq, engine);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    await request(app).post("/batch/retry").send({ ids }).expect(400);
  });

  it("POST /batch/retry should reject missing ids", async () => {
    const app = createApp(dlq, engine);
    await request(app).post("/batch/retry").send({}).expect(400);
  });

  it("POST /batch/delete should remove entries", async () => {
    const id1 = await pushWorkflowEntry(dlq);
    const id2 = await pushWorkflowEntry(dlq);
    const app = createApp(dlq, engine);

    const res = await request(app)
      .post("/batch/delete")
      .send({ ids: [id1, id2, "missing"] })
      .expect(200);

    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(await dlq.get(id1)).toBeNull();
    expect(await dlq.get(id2)).toBeNull();
  });

  it("POST /:id/retry should mark entry permanently_failed after max retries", async () => {
    const id = await pushWorkflowEntry(dlq);
    // Simulate an entry that has already exhausted retries (default max 5)
    for (let i = 0; i < 5; i++) {
      await dlq.incrementRetry(id);
    }

    const app = createApp(dlq, engine);
    await request(app).post(`/${id}/retry`).expect(429);

    const entry = await dlq.get(id);
    expect(entry?.status).toBe("permanently_failed");
    expect(engine.start).not.toHaveBeenCalled();
  });
});
