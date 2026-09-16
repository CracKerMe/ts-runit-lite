// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import workflowsRoutes from "../../../api/routes/workflows/index";

describe("canary release routes", () => {
  function createApp(
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
    app.use("/", workflowsRoutes);
    return app;
  }

  it("starts canary release and returns release status", async () => {
    const storage = {
      loadWorkflowWithMetadata: vi.fn(async () => ({
        id: "wf-canary",
        name: "wf-canary",
        definition: {
          id: "wf-canary",
          name: "wf-canary",
          startNode: "start",
          nodes: { start: { id: "start", type: "action" } },
        },
        version: 2,
        publishedVersion: 1,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      })),
      listWorkflowVersions: vi.fn(async () => [1, 2]),
      saveWorkflowWithMetadata: vi.fn(async () => undefined),
    };
    const engine = {
      startCanaryRelease: vi.fn(async () => undefined),
      setReleasePolicy: vi.fn(),
      getCanaryStatus: vi.fn(async () => ({
        publishedVersion: 1,
        canaryVersion: 2,
        canaryPercent: 10,
      })),
    };
    const app = createApp(engine, storage);

    await request(app)
      .post("/wf-canary/publish")
      .send({ version: 2, canary: { percent: 10 } })
      .expect(200);

    const status = await request(app)
      .get("/wf-canary/release-status")
      .expect(200);
    expect(status.body.data.canaryVersion).toBe(2);
    expect(engine.startCanaryRelease).toHaveBeenCalled();
  });
});
