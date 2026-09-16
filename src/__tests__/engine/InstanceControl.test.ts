import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../bootstrap";
import type { AppContainer } from "../../container";
import { destroyContainer } from "../../container";
import type { WorkflowDefinition } from "../../model/Workflow";
import type { WorkflowEngine } from "../../engine/WorkflowEngine";

describe("Instance Control Operations", () => {
  let engine: WorkflowEngine;
  let container: AppContainer;

  beforeEach(async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    container = ctx.container;
  });

  afterEach(async () => {
    engine.destroy();
    await destroyContainer(container);
  });

  describe("retryNode", () => {
    it("should retry a failed node", async () => {
      let attemptCount = 0;
      const workflow: WorkflowDefinition = {
        id: "retry-test",
        name: "Retry Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => {
              attemptCount++;
              if (attemptCount === 1) {
                throw new Error("First attempt fails");
              }
              return { success: true, attempt: attemptCount };
            },
            next: ["task2"],
          },
          task2: {
            id: "task2",
            type: "action",
            action: async () => ({ completed: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("retry-test");

      // Wait for workflow to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("failed");

      // Retry the failed node
      await engine.retryNode(instanceId, "task1");

      // Wait for retry to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedInstance = engine.getInstance(instanceId);
      expect(updatedInstance?.status).toBe("completed");
      expect(attemptCount).toBe(2);
      expect(updatedInstance?.retries?.task1).toBe(1);
    });

    it("should throw error when retrying non-failed node", async () => {
      const workflow: WorkflowDefinition = {
        id: "retry-error-test",
        name: "Retry Error Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => ({ success: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("retry-error-test");

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to retry a successful node
      await expect(engine.retryNode(instanceId, "task1")).rejects.toThrow(
        "is not in a failed state",
      );
    });
  });

  describe("skipNode", () => {
    it("should skip a failed node and continue workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "skip-test",
        name: "Skip Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => {
              throw new Error("Task fails");
            },
            next: ["task2"],
          },
          task2: {
            id: "task2",
            type: "action",
            action: async () => ({ completed: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("skip-test");

      // Wait for workflow to fail
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("failed");

      // Skip the failed node with default output
      await engine.skipNode(instanceId, "task1", { skipped: true });

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedInstance = engine.getInstance(instanceId);
      expect(updatedInstance?.status).toBe("completed");

      // Check that the node was marked as skipped
      const skippedLog = updatedInstance?.history.find(
        (log) => log.nodeId === "task1" && log.status === "skipped",
      );
      expect(skippedLog).toBeDefined();
      expect(skippedLog?.data).toEqual({ skipped: true });
    });

    it("should throw error when skipping completed node", async () => {
      const workflow: WorkflowDefinition = {
        id: "skip-error-test",
        name: "Skip Error Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => ({ success: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("skip-error-test");

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to skip a completed node
      await expect(engine.skipNode(instanceId, "task1")).rejects.toThrow(
        "has already completed successfully",
      );
    });
  });

  describe("compensate", () => {
    it("should execute rollback nodes in reverse order", async () => {
      const executionOrder: string[] = [];

      const workflow: WorkflowDefinition = {
        id: "compensate-test",
        name: "Compensate Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => {
              executionOrder.push("task1");
              return { success: true };
            },
            rollbackTo: "rollback1",
            next: ["task2"],
          },
          task2: {
            id: "task2",
            type: "action",
            action: async () => {
              executionOrder.push("task2");
              return { success: true };
            },
            rollbackTo: "rollback2",
            next: [],
          },
          rollback1: {
            id: "rollback1",
            type: "rollback",
            action: async () => {
              executionOrder.push("rollback1");
              return { rolledBack: true };
            },
          },
          rollback2: {
            id: "rollback2",
            type: "rollback",
            action: async () => {
              executionOrder.push("rollback2");
              return { rolledBack: true };
            },
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("compensate-test");

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const instance = engine.getInstance(instanceId);
      expect(instance?.status).toBe("completed");
      expect(executionOrder).toEqual(["task1", "task2"]);

      // Trigger compensation
      await engine.compensate(instanceId, "Manual compensation");

      // Wait for compensation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedInstance = engine.getInstance(instanceId);
      expect(updatedInstance?.status).toBe("rollback");

      // Rollback should be in reverse order: task2's rollback first, then task1's
      expect(executionOrder).toEqual([
        "task1",
        "task2",
        "rollback2",
        "rollback1",
      ]);
    });

    it("should handle workflows with no rollback nodes", async () => {
      const workflow: WorkflowDefinition = {
        id: "no-rollback-test",
        name: "No Rollback Test",
        startNode: "task1",
        nodes: {
          task1: {
            id: "task1",
            type: "action",
            action: async () => ({ success: true }),
            next: [],
          },
        },
      };

      await engine.register(workflow);
      const instanceId = await engine.start("no-rollback-test");

      // Wait for workflow to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Trigger compensation (should do nothing)
      await engine.compensate(instanceId);

      const instance = engine.getInstance(instanceId);
      // Status should remain completed since no rollback was performed
      expect(instance?.status).toBe("completed");
    });
  });
});
