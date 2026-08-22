// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import instanceRoutes from "../instances";

function makeInstance(
  overrides: Partial<WorkflowInstance> & { instanceId: string },
): WorkflowInstance {
  return {
    workflowId: "order-processing",
    currentNodes: [],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as WorkflowInstance;
}

function createApp(engine: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).engine = engine;
    next();
  });
  app.use("/", instanceRoutes);
  return app;
}

function createAppWithStorage(
  engine: Record<string, unknown>,
  storage: Record<string, unknown>,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).engine = engine;
    (req as any).storage = storage;
    next();
  });
  app.use("/", instanceRoutes);
  return app;
}

function createEngine(instances: WorkflowInstance[]) {
  const map = new Map(instances.map((i) => [i.instanceId, i]));
  return {
    listInstances: vi.fn(() => [...map.keys()]),
    getInstance: vi.fn((id: string) => map.get(id)),
    pauseInstance: vi.fn(async (id: string) => map.has(id)),
    resumeInstance: vi.fn(async (id: string) => map.has(id)),
    cancelInstance: vi.fn(async (id: string) => map.has(id)),
  };
}

describe("POST /search", () => {
  it("should filter, sort, paginate and aggregate", async () => {
    const engine = createEngine([
      makeInstance({
        instanceId: "i1",
        status: "running",
        searchAttributes: { amount: 500 },
      }),
      makeInstance({
        instanceId: "i2",
        status: "completed",
        searchAttributes: { amount: 2000 },
      }),
      makeInstance({
        instanceId: "i3",
        status: "running",
        searchAttributes: { amount: 3000 },
      }),
    ]);
    const app = createApp(engine);

    const res = await request(app)
      .post("/search")
      .send({
        filters: [
          { field: "searchAttributes.amount", operator: "gt", value: 1000 },
        ],
        sort: [{ field: "searchAttributes.amount", order: "desc" }],
        page: 1,
        pageSize: 10,
      })
      .expect(200);

    expect(res.body.data.instances.map((i: any) => i.instanceId)).toEqual([
      "i3",
      "i2",
    ]);
    expect(res.body.data.pagination.totalCount).toBe(2);
    expect(res.body.data.aggregations.byStatus).toEqual({
      running: 1,
      completed: 1,
    });
  });

  it("should return 400 for invalid filter operator", async () => {
    const engine = createEngine([makeInstance({ instanceId: "i1" })]);
    const app = createApp(engine);

    await request(app)
      .post("/search")
      .send({
        filters: [{ field: "status", operator: "regex", value: ".*" }],
      })
      .expect(400);
  });
});

describe("POST /batch/:operation", () => {
  it("should cancel instances in batch with partial success", async () => {
    const engine = createEngine([
      makeInstance({ instanceId: "i1" }),
      makeInstance({ instanceId: "i2" }),
    ]);
    const app = createApp(engine);

    const res = await request(app)
      .post("/batch/cancel")
      .send({ ids: ["i1", "i2", "missing"] })
      .expect(200);

    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(1);
    expect(engine.cancelInstance).toHaveBeenCalledTimes(3);
  });

  it("should pause and resume in batch", async () => {
    const engine = createEngine([makeInstance({ instanceId: "i1" })]);
    const app = createApp(engine);

    const pauseRes = await request(app)
      .post("/batch/pause")
      .send({ ids: ["i1"] })
      .expect(200);
    expect(pauseRes.body.data.succeeded).toBe(1);

    const resumeRes = await request(app)
      .post("/batch/resume")
      .send({ ids: ["i1"] })
      .expect(200);
    expect(resumeRes.body.data.succeeded).toBe(1);
  });

  it("should reject unknown operations", async () => {
    const engine = createEngine([]);
    const app = createApp(engine);
    await request(app)
      .post("/batch/explode")
      .send({ ids: ["i1"] })
      .expect(400);
  });

  it("should reject oversized batches", async () => {
    const engine = createEngine([]);
    const app = createApp(engine);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    await request(app).post("/batch/cancel").send({ ids }).expect(400);
  });

  it("should reject missing ids", async () => {
    const engine = createEngine([]);
    const app = createApp(engine);
    await request(app).post("/batch/cancel").send({}).expect(400);
  });

  it("should search persisted instances from storage when available", async () => {
    const persisted = makeInstance({
      instanceId: "persisted-1",
      status: "completed",
      searchAttributes: { amount: 2500 },
    });
    const engine = createEngine([]);
    const storage = {
      listInstances: vi.fn(async () => [persisted.instanceId]),
      loadInstance: vi.fn(async (id: string) =>
        id === persisted.instanceId ? persisted : null,
      ),
    };
    const app = createAppWithStorage(engine, storage);

    const res = await request(app)
      .post("/search")
      .send({
        filters: [
          { field: "searchAttributes.amount", operator: "gt", value: 1000 },
        ],
      })
      .expect(200);

    expect(res.body.data.instances.map((i: any) => i.instanceId)).toEqual([
      "persisted-1",
    ]);
    expect(engine.listInstances).not.toHaveBeenCalled();
    expect(storage.listInstances).toHaveBeenCalledTimes(1);
  });
});
