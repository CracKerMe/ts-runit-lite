import { describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { WorkflowRegistry } from "../../engine/WorkflowRegistry";

describe("WorkflowRegistry", () => {
  describe("register", () => {
    it("should register workflow", async () => {
      const registry = new WorkflowRegistry();
      const startWorkflow = vi.fn();

      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "start",
        nodes: {
          start: {
            id: "start",
            type: "action",
            action: async () => {},
            next: [],
          },
        },
      };

      await registry.register(workflow, startWorkflow);

      expect(registry.hasWorkflow("test-workflow")).toBe(true);
      expect(registry.getWorkflow("test-workflow")).toBe(workflow);
    });

    it("should list all registered workflows", async () => {
      const registry = new WorkflowRegistry();
      const startWorkflow = vi.fn();

      const workflow1: WorkflowDefinition = {
        id: "workflow1",
        name: "Workflow 1",
        startNode: "start",
        nodes: {},
      };

      const workflow2: WorkflowDefinition = {
        id: "workflow2",
        name: "Workflow 2",
        startNode: "start",
        nodes: {},
      };

      await registry.register(workflow1, startWorkflow);
      await registry.register(workflow2, startWorkflow);

      const ids = registry.listWorkflows();

      expect(ids).toHaveLength(2);
      expect(ids).toContain("workflow1");
      expect(ids).toContain("workflow2");
    });
  });

  describe("getWorkflow", () => {
    it("should return undefined for non-existent workflow", () => {
      const registry = new WorkflowRegistry();

      const workflow = registry.getWorkflow("non-existent");

      expect(workflow).toBeUndefined();
    });
  });

  describe("hasWorkflow", () => {
    it("should return false for non-existent workflow", () => {
      const registry = new WorkflowRegistry();

      expect(registry.hasWorkflow("non-existent")).toBe(false);
    });

    it("should return true for registered workflow", async () => {
      const registry = new WorkflowRegistry();
      const startWorkflow = vi.fn();

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test",
        startNode: "start",
        nodes: {},
      };

      await registry.register(workflow, startWorkflow);

      expect(registry.hasWorkflow("test")).toBe(true);
    });
  });
});
