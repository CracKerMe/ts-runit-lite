// oxlint-disable no-explicit-any -- test file uses dynamic types
import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "../../../model/Workflow";
import { MemoryStorage } from "../../../storage/MemoryStorage";
import workflowRoutes from "../../../api/routes/workflows/index";

describe("GET/PUT /workflows/:id/graph", () => {
  let storage: MemoryStorage;
  const engine = {
    register: vi.fn().mockResolvedValue(undefined),
  };

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).storage = storage;
      (req as any).engine = engine;
      next();
    });
    app.use("/workflows", workflowRoutes);
    return app;
  }

  const definition: WorkflowDefinition = {
    id: "graph-wf",
    name: "Graph Workflow",
    startNode: "route",
    nodes: {
      route: {
        id: "route",
        type: "router",
        config: {
          routes: [{ condition: "${type === 'vip'}", target: "vip" }],
          defaultTarget: "normal",
        },
      },
      vip: { id: "vip", type: "action", next: [] },
      normal: { id: "normal", type: "action", next: [] },
    },
  };

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
    engine.register.mockClear();
    await storage.saveWorkflowWithMetadata({
      id: definition.id,
      name: definition.name,
      definition,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  it("GET returns a nodes[]/edges[] view with router routes represented as edges", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/workflows/graph-wf/graph");

    expect(res.status).toBe(200);
    expect(res.body.data.nodes).toHaveLength(3);
    expect(res.body.data.edges).toContainEqual(
      expect.objectContaining({
        source: "route",
        target: "vip",
        kind: "router-route",
        label: "${type === 'vip'}",
      }),
    );
    expect(res.body.data.edges).toContainEqual(
      expect.objectContaining({
        source: "route",
        target: "normal",
        kind: "router-default",
      }),
    );
    const routeNode = res.body.data.nodes.find((n: any) => n.id === "route");
    expect(routeNode.data.config).toEqual({});
  });

  it("GET 404s for an unknown workflow", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/workflows/does-not-exist/graph");
    expect(res.status).toBe(404);
  });

  it("PUT writes edges back into the native format and round-trips through GET", async () => {
    const app = buildApp();

    const getRes = await supertest(app).get("/workflows/graph-wf/graph");
    const graph = getRes.body.data;

    // Add a brand-new router route via the graph shape only.
    graph.edges.push({
      id: "new-edge",
      source: "route",
      target: "normal",
      kind: "router-route",
      label: "${type === 'guest'}",
    });

    const putRes = await supertest(app)
      .put("/workflows/graph-wf/graph")
      .send(graph);

    expect(putRes.status).toBe(200);
    expect(engine.register).toHaveBeenCalledTimes(1);
    const registeredDefinition = engine.register.mock
      .calls[0][0] as WorkflowDefinition;
    const routerConfig = registeredDefinition.nodes.route.config as {
      routes: Array<{ condition: string; target: string }>;
    };
    expect(routerConfig.routes).toEqual(
      expect.arrayContaining([
        { condition: "${type === 'vip'}", target: "vip" },
        { condition: "${type === 'guest'}", target: "normal" },
      ]),
    );

    const stored = await storage.loadWorkflowWithMetadata("graph-wf");
    const storedRouterConfig = stored?.definition.nodes.route.config as
      | { routes: unknown[] }
      | undefined;
    expect(storedRouterConfig?.routes).toHaveLength(2);
  });

  it("PUT rejects a body that isn't a nodes[]/edges[] graph", async () => {
    const app = buildApp();
    const res = await supertest(app)
      .put("/workflows/graph-wf/graph")
      .send({ not: "a graph" });

    expect(res.status).toBe(400);
  });
});
