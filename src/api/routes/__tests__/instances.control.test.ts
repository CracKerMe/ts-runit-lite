import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../../bootstrap";
import type { AppContainer } from "../../../container";
import { destroyContainer } from "../../../container";
import type { WorkflowEngineV2 } from "../../../engine/WorkflowEngineV2";
import type { WorkflowDefinition } from "../../../model/Workflow";

/**
 * Instance Control API Tests
 * Tests for retry, skip, compensate, and node status endpoints
 */

describe("Instance Control API", () => {
  let engine: WorkflowEngineV2;
  let container: AppContainer;

  beforeAll(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    container = ctx.container;
  });

  afterAll(async () => {
    engine.destroy();
    await destroyContainer(container);
  });

  describe("retryNode", () => {
    it("should retry a failed node", async () => {
      let attemptCount = 0;

      const workflow: WorkflowDefinition = {
        id: "retry-test-workflow",
        name: "Retry Test Workflow",
        version: "1.0.0",
        startNode: "failingNode",
        nodes: {
          failingNode: {
            id: "failingNode",
            type: "action",
            action: async () => {
              attemptCount++;
              if (attemptCount === 1) {
                throw new Error("First attempt fails");
              }
              return { success: true, attemptCount };
            },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("retry-test-workflow", {});

      // Wait for initial execution to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("failed");

      // Retry the failed node
      await engine.retryNode(instanceId, "failingNode");

      // Wait for retry to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedInstance = engine.getInstance(instanceId);
      expect(updatedInstance?.status).toBe("completed");
      expect(attemptCount).toBe(2);
    });

    it("should throw error when retrying non-existent instance", async () => {
      await expect(
        engine.retryNode("non-existent-instance", "someNode"),
      ).rejects.toThrow("Instance non-existent-instance not found");
    });

    it("should throw error when retrying non-existent node", async () => {
      const workflow: WorkflowDefinition = {
        id: "simple-workflow",
        name: "Simple Workflow",
        version: "1.0.0",
        startNode: "start",
        nodes: {
          start: {
            id: "start",
            type: "action",
            action: async () => ({ done: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("simple-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(
        engine.retryNode(instanceId, "non-existent-node"),
      ).rejects.toThrow("Node non-existent-node not found");
    });

    it("should throw error when retrying node not in failed state", async () => {
      const workflow: WorkflowDefinition = {
        id: "success-workflow",
        name: "Success Workflow",
        version: "1.0.0",
        startNode: "successNode",
        nodes: {
          successNode: {
            id: "successNode",
            type: "action",
            action: async () => ({ success: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("success-workflow", {});

      // Wait for execution to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      await expect(engine.retryNode(instanceId, "successNode")).rejects.toThrow(
        "not in a failed state",
      );
    });
  });

  describe("skipNode", () => {
    it("should skip a failed node and continue workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "skip-test-workflow",
        name: "Skip Test Workflow",
        version: "1.0.0",
        startNode: "failingNode",
        nodes: {
          failingNode: {
            id: "failingNode",
            type: "action",
            action: async () => {
              throw new Error("This node always fails");
            },
            next: ["nextNode"],
          },
          nextNode: {
            id: "nextNode",
            type: "action",
            action: async () => ({ completed: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("skip-test-workflow", {});

      // Wait for initial execution to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("failed");

      // Skip the failed node with default output
      await engine.skipNode(instanceId, "failingNode", { skipped: true });

      // Wait for workflow to continue
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedInstance = engine.getInstance(instanceId);
      expect(updatedInstance?.status).toBe("completed");

      // Check that the node was marked as skipped
      const skippedLog = updatedInstance?.history.find(
        (log) => log.nodeId === "failingNode" && log.status === "skipped",
      );
      expect(skippedLog).toBeDefined();
    });

    it("should skip node with null default output", async () => {
      const workflow: WorkflowDefinition = {
        id: "skip-null-workflow",
        name: "Skip Null Workflow",
        version: "1.0.0",
        startNode: "failingNode",
        nodes: {
          failingNode: {
            id: "failingNode",
            type: "action",
            action: async () => {
              throw new Error("Fails");
            },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("skip-null-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Skip without providing default output
      await engine.skipNode(instanceId, "failingNode");

      await new Promise((resolve) => setTimeout(resolve, 50));

      const instance = engine.getInstance(instanceId);
      const skippedLog = instance?.history.find(
        (log) => log.nodeId === "failingNode" && log.status === "skipped",
      );
      expect(skippedLog?.data).toBeNull();
    });

    it("should throw error when skipping already completed node", async () => {
      const workflow: WorkflowDefinition = {
        id: "completed-workflow",
        name: "Completed Workflow",
        version: "1.0.0",
        startNode: "completedNode",
        nodes: {
          completedNode: {
            id: "completedNode",
            type: "action",
            action: async () => ({ done: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("completed-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 100));

      await expect(
        engine.skipNode(instanceId, "completedNode"),
      ).rejects.toThrow("already completed successfully");
    });
  });

  describe("compensate", () => {
    it("should execute rollback nodes in reverse order", async () => {
      const executionOrder: string[] = [];

      const workflow: WorkflowDefinition = {
        id: "compensate-workflow",
        name: "Compensate Workflow",
        version: "1.0.0",
        startNode: "step1",
        nodes: {
          step1: {
            id: "step1",
            type: "action",
            action: async () => {
              executionOrder.push("step1");
              return { done: true };
            },
            rollbackTo: "rollback1",
            next: ["step2"],
          },
          rollback1: {
            id: "rollback1",
            type: "rollback",
            action: async () => {
              executionOrder.push("rollback1");
              return { rolledBack: true };
            },
            next: [],
          },
          step2: {
            id: "step2",
            type: "action",
            action: async () => {
              executionOrder.push("step2");
              return { done: true };
            },
            rollbackTo: "rollback2",
            next: [],
          },
          rollback2: {
            id: "rollback2",
            type: "rollback",
            action: async () => {
              executionOrder.push("rollback2");
              return { rolledBack: true };
            },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("compensate-workflow", {});

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("completed");

      // Trigger compensation
      await engine.compensate(instanceId, "Testing compensation");

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify rollback nodes were executed in reverse order
      const rollbackIndex1 = executionOrder.indexOf("rollback2");
      const rollbackIndex2 = executionOrder.indexOf("rollback1");

      expect(rollbackIndex1).toBeGreaterThan(-1);
      expect(rollbackIndex2).toBeGreaterThan(-1);
      expect(rollbackIndex1).toBeLessThan(rollbackIndex2);
    });

    it("should handle compensation with no rollback nodes", async () => {
      const workflow: WorkflowDefinition = {
        id: "no-rollback-workflow",
        name: "No Rollback Workflow",
        version: "1.0.0",
        startNode: "step1",
        nodes: {
          step1: {
            id: "step1",
            type: "action",
            action: async () => ({ done: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("no-rollback-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not throw error even without rollback nodes
      await expect(engine.compensate(instanceId)).resolves.not.toThrow();
    });

    it("should throw error for non-existent instance", async () => {
      await expect(engine.compensate("non-existent-instance")).rejects.toThrow(
        "Instance non-existent-instance not found",
      );
    });
  });

  describe("getInstance (node status)", () => {
    it("should return node execution history", async () => {
      const workflow: WorkflowDefinition = {
        id: "history-workflow",
        name: "History Workflow",
        version: "1.0.0",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            action: async () => ({ result: "success" }),
            next: ["node2"],
          },
          node2: {
            id: "node2",
            type: "action",
            action: async () => ({ result: "done" }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("history-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 150));

      const instance = engine.getInstance(instanceId);

      expect(instance).toBeDefined();
      expect(instance?.history.length).toBeGreaterThan(0);

      // Check node1 execution
      const node1History = instance?.history.filter(
        (log) => log.nodeId === "node1",
      );
      expect(node1History?.length).toBeGreaterThan(0);
      expect(node1History?.[0].status).toBe("success");
    });

    it("should track retry count", async () => {
      let attemptCount = 0;

      const workflow: WorkflowDefinition = {
        id: "retry-count-workflow",
        name: "Retry Count Workflow",
        version: "1.0.0",
        startNode: "retryNode",
        nodes: {
          retryNode: {
            id: "retryNode",
            type: "action",
            action: async () => {
              attemptCount++;
              if (attemptCount === 1) {
                throw new Error("First attempt fails");
              }
              return { success: true, attemptCount };
            },
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("retry-count-workflow", {});

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify initial failure
      let instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("failed");

      // Retry once - should succeed
      await engine.retryNode(instanceId, "retryNode");
      await new Promise((resolve) => setTimeout(resolve, 100));

      instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("completed");
      expect(instance?.retries?.retryNode).toBe(1);
      expect(attemptCount).toBe(2);
    });
  });
});
