import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../bootstrap";
import type { AppContainer } from "../../container";
import { destroyContainer } from "../../container";
import type { WorkflowDefinition } from "../../model/Workflow";
import { DataValidationError } from "../DataValidator";
import type { WorkflowEngine } from "../WorkflowEngine";

describe("Schema validation on engine.start", () => {
  let engine: WorkflowEngine;
  let container: AppContainer;
  const originalMode = process.env.SCHEMA_VALIDATION;

  const workflow: WorkflowDefinition = {
    id: "schema-validated-workflow",
    name: "Schema Validated Workflow",
    version: "1.0.0",
    startNode: "start",
    inputSchema: {
      type: "object",
      required: ["orderId", "amount"],
      properties: {
        orderId: { type: "string", pattern: "^ORD-\\d{6}$" },
        amount: { type: "number", minimum: 0 },
      },
    },
    nodes: {
      start: {
        id: "start",
        type: "action",
        action: async () => ({ done: true }),
        next: [],
      },
    },
  };

  beforeAll(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    container = ctx.container;
    await engine.register(workflow);
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.SCHEMA_VALIDATION;
    } else {
      process.env.SCHEMA_VALIDATION = originalMode;
    }
  });

  afterAll(async () => {
    engine.destroy();
    await destroyContainer(container);
  });

  it("strict mode should reject invalid input with DataValidationError", async () => {
    process.env.SCHEMA_VALIDATION = "strict";
    await expect(
      engine.start("schema-validated-workflow", {
        orderId: "BAD",
        amount: -5,
      }),
    ).rejects.toBeInstanceOf(DataValidationError);
  });

  it("strict mode should accept valid input", async () => {
    process.env.SCHEMA_VALIDATION = "strict";
    const instanceId = await engine.start("schema-validated-workflow", {
      orderId: "ORD-000001",
      amount: 100,
    });
    expect(instanceId).toBeTruthy();
  });

  it("warn mode should allow invalid input through", async () => {
    process.env.SCHEMA_VALIDATION = "warn";
    const instanceId = await engine.start("schema-validated-workflow", {
      orderId: "BAD",
      amount: -5,
    });
    expect(instanceId).toBeTruthy();
  });

  it("off mode (default) should skip validation", async () => {
    delete process.env.SCHEMA_VALIDATION;
    const instanceId = await engine.start("schema-validated-workflow", {});
    expect(instanceId).toBeTruthy();
  });
});
