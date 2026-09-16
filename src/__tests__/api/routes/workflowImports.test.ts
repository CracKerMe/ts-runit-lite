// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../../storage/MemoryStorage";
import workflowRoutes from "../../../api/routes/workflows/index";

describe("Workflow public import routes", () => {
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

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
    engine.register.mockClear();
  });

  afterEach(async () => {
    await storage.close();
  });

  it("imports workflows from DSL", async () => {
    const app = buildApp();
    const response = await supertest(app)
      .post("/workflows/import/dsl")
      .send({
        dsl: [
          "id: dsl-import-test",
          "name: DSL Import Test",
          "startNode: start",
          "start:",
          "  type: action",
        ].join("\n"),
      });

    expect(response.status).toBe(201);
    expect(response.body.data.source).toBe("dsl");
    expect(response.body.data.workflow.id).toBe("dsl-import-test");
    expect(engine.register).toHaveBeenCalledTimes(1);

    const stored = await storage.loadWorkflowWithMetadata("dsl-import-test");
    expect(stored?.definition.name).toBe("DSL Import Test");
  });

  it("lists built-in workflow templates", async () => {
    const app = buildApp();
    const response = await supertest(app).get(
      "/workflows/templates?category=integration",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "http-callback",
          category: "integration",
        }),
      ]),
    );
  });

  it("imports workflows from a built-in template", async () => {
    const app = buildApp();
    const response = await supertest(app)
      .post("/workflows/import/template")
      .send({
        templateId: "http-callback",
        name: "Inbound Webhook",
        parameters: {
          callbackUrl: "https://example.com/hooks/inbound",
        },
        description: "Instantiated from built-in template",
        tags: ["template"],
      });

    expect(response.status).toBe(201);
    expect(response.body.data.source).toBe("template");
    expect(response.body.data.templateId).toBe("http-callback");
    expect(response.body.data.workflow.id).toBe("inbound-webhook");
    expect(
      response.body.data.workflow.definition.nodes.callback.config.url,
    ).toBe("https://example.com/hooks/inbound");
    expect(engine.register).toHaveBeenCalledTimes(1);

    const stored = await storage.loadWorkflowWithMetadata("inbound-webhook");
    expect(stored?.description).toBe("Instantiated from built-in template");
    expect(stored?.tags).toEqual(["template"]);
  });
});
