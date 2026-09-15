import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../Workflow";
import {
  getNodeConfigJsonSchema,
  getWorkflowDefinitionJsonSchema,
  validateNodeConfig,
  WorkflowDefinitionSchema,
} from "../WorkflowSchema";

describe("WorkflowSchema", () => {
  it("accepts a workflow definition mixing declarative node types", () => {
    const definition: WorkflowDefinition = {
      id: "wf-1",
      name: "Order Processing",
      startNode: "fetch",
      nodes: {
        fetch: {
          id: "fetch",
          type: "http",
          config: { method: "GET", url: "https://api.example.com/orders/1" },
          next: ["route"],
        },
        route: {
          id: "route",
          type: "router",
          config: {
            routes: [
              { condition: "${fetch.output.amount > 1000}", target: "vip" },
            ],
            defaultTarget: "normal",
          },
        },
        vip: {
          id: "vip",
          type: "notification",
          config: { channel: "slack", target: "#vip", template: "vip order" },
        },
        normal: {
          id: "normal",
          type: "notification",
          config: {
            channel: "email",
            target: "ops@example.com",
            template: "order",
          },
        },
      },
    };

    const result = WorkflowDefinitionSchema.safeParse(definition);
    expect(result.success).toBe(true);
  });

  it("accepts action nodes without requiring config (closures aren't validated)", () => {
    const definition: WorkflowDefinition = {
      id: "wf-2",
      name: "Quickstart",
      startNode: "n1",
      nodes: {
        n1: { id: "n1", type: "action", next: [] },
      },
    };

    expect(WorkflowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it("rejects a workflow missing required top-level fields", () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: "no id or startNode",
      nodes: {},
    });
    expect(result.success).toBe(false);
  });

  describe("validateNodeConfig", () => {
    it("validates a valid http config", () => {
      const result = validateNodeConfig("http", {
        method: "POST",
        url: "https://example.com",
      });
      expect(result?.success).toBe(true);
    });

    it("rejects an http config missing a required field", () => {
      const result = validateNodeConfig("http", { method: "GET" });
      expect(result?.success).toBe(false);
    });

    it("rejects a loop config missing itemVariable/body", () => {
      const result = validateNodeConfig("loop", { collection: "${items}" });
      expect(result?.success).toBe(false);
    });

    it("returns null for node types without a declarative config schema", () => {
      expect(validateNodeConfig("action", {})).toBeNull();
      expect(validateNodeConfig("event", {})).toBeNull();
    });

    it("accepts a wait config with durationMs or until, or no config at all", () => {
      expect(validateNodeConfig("wait", {})?.success).toBe(true);
      expect(validateNodeConfig("wait", { durationMs: 5000 })?.success).toBe(
        true,
      );
      expect(
        validateNodeConfig("wait", { until: "2026-10-01T00:00:00Z" })?.success,
      ).toBe(true);
    });

    it("validates a valid join config", () => {
      const result = validateNodeConfig("join", {
        waitFor: ["a", "b"],
        mode: "all",
      });
      expect(result?.success).toBe(true);
    });

    it("rejects a join config with an empty waitFor", () => {
      const result = validateNodeConfig("join", { waitFor: [] });
      expect(result?.success).toBe(false);
    });

    it("validates a valid transform config", () => {
      const result = validateNodeConfig("transform", {
        output: { total: "${a.output.x + b.output.y}" },
      });
      expect(result?.success).toBe(true);
    });

    it("rejects a transform config with a non-string output field", () => {
      const result = validateNodeConfig("transform", {
        output: { total: 42 },
      });
      expect(result?.success).toBe(false);
    });
  });

  describe("JSON schema generation", () => {
    it("generates a draft-2020-12 schema with a TaskNode $def", () => {
      const schema = getWorkflowDefinitionJsonSchema();
      expect(schema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.$defs).toHaveProperty("TaskNode");
    });

    it("generates a typed per-node-type config schema for http", () => {
      const schema = getNodeConfigJsonSchema("http");
      expect(schema).not.toBeNull();
      expect(schema?.required).toContain("url");
      expect(schema?.required).toContain("method");
    });

    it("returns null config schema for action nodes", () => {
      expect(getNodeConfigJsonSchema("action")).toBeNull();
    });
  });
});
