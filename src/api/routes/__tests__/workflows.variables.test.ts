// oxlint-disable no-explicit-any -- test file uses dynamic types
import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../../model/Workflow";
import { MemoryStorage } from "../../../storage/MemoryStorage";
import workflowRoutes from "../workflows/index";

describe("GET /workflows/:id/variables", () => {
  let storage: MemoryStorage;

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).storage = storage;
      next();
    });
    app.use("/workflows", workflowRoutes);
    return app;
  }

  const definition: WorkflowDefinition = {
    id: "var-wf",
    name: "Variable Workflow",
    startNode: "fetch",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" } },
    },
    nodes: {
      fetch: {
        id: "fetch",
        type: "http",
        config: { method: "GET", url: "https://example.com" },
        next: ["notify"],
        outputSchema: {
          type: "object",
          properties: { amount: { type: "number" } },
        },
      },
      notify: {
        id: "notify",
        type: "notification",
        config: { channel: "slack", target: "#ops", template: "done" },
      },
    },
  };

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
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

  it("returns context and node-output suggestions", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/workflows/var-wf/variables");

    expect(res.status).toBe(200);
    const expressions = res.body.data.variables.map((v: any) => v.expression);
    expect(expressions).toContain("${context.orderId}");
    expect(expressions).toContain("${fetch.output}");
    expect(expressions).toContain("${fetch.output.amount}");
    expect(expressions).toContain("${notify.output}");
  });

  it("scopes to ancestors with ?before=", async () => {
    const app = buildApp();
    const res = await supertest(app).get(
      "/workflows/var-wf/variables?before=notify",
    );

    const nodeIds = res.body.data.variables
      .filter((v: any) => v.source === "node-output")
      .map((v: any) => v.nodeId);
    expect(nodeIds).toContain("fetch");
    expect(nodeIds).not.toContain("notify");
  });

  it("404s for an unknown workflow", async () => {
    const app = buildApp();
    const res = await supertest(app).get("/workflows/does-not-exist/variables");
    expect(res.status).toBe(404);
  });
});
