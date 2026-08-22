// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { TaskNode, WorkflowDefinition } from "../../model/Workflow";
import { mergeParallelResults, ParallelExecutor } from "../ParallelExecutor";

describe("ParallelExecutor", () => {
  describe("executeParallel", () => {
    it("should return empty result for empty node list", async () => {
      const executor = new ParallelExecutor(async () => []);
      const result = await executor.executeParallel(
        [],
        { nodes: {} } as WorkflowDefinition,
        {} as WorkflowInstance,
      );
      expect(result.allSucceeded).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.nextNodes).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should execute single node directly", async () => {
      const executeNode = vi.fn().mockResolvedValue(["next-node"]);
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: { "single-node": { id: "single-node", type: "action" } },
        startNode: "single-node",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["single-node"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["single-node"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].nodeId).toBe("single-node");
      expect(result.results[0].success).toBe(true);
      expect(executeNode).toHaveBeenCalledTimes(1);
    });

    it("should execute multiple nodes in parallel", async () => {
      const executeNode = vi
        .fn()
        .mockImplementation((node: TaskNode) =>
          Promise.resolve([`${node.id}-next`]),
        );
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: {
          "node-1": { id: "node-1", type: "action" },
          "node-2": { id: "node-2", type: "action" },
          "node-3": { id: "node-3", type: "action" },
        },
        startNode: "node-1",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["node-1", "node-2", "node-3"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["node-1", "node-2", "node-3"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(executeNode).toHaveBeenCalledTimes(3);
    });

    it("should handle node not found error", async () => {
      const executeNode = vi.fn();
      const executor = new ParallelExecutor(executeNode);
      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: {},
        startNode: "missing",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["missing-node"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["missing-node"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("Node not found");
    });

    it("should handle execution errors", async () => {
      const executeNode = vi
        .fn()
        .mockResolvedValueOnce(["next-1"])
        .mockRejectedValueOnce(new Error("Execution failed"))
        .mockResolvedValueOnce(["next-3"]);
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: {
          "node-1": { id: "node-1", type: "action" },
          "node-2": { id: "node-2", type: "action" },
          "node-3": { id: "node-3", type: "action" },
        },
        startNode: "node-1",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["node-1", "node-2", "node-3"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["node-1", "node-2", "node-3"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe("Execution failed");
    });

    it("should collect next nodes from all successful executions", async () => {
      const executeNode = vi
        .fn()
        .mockResolvedValueOnce(["next-1"])
        .mockRejectedValueOnce(new Error("Execution failed"))
        .mockResolvedValueOnce(["next-3"]);
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: {
          "node-1": { id: "node-1", type: "action" },
          "node-2": { id: "node-2", type: "action" },
          "node-3": { id: "node-3", type: "action" },
        },
        startNode: "node-1",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["node-1", "node-2", "node-3"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["node-1", "node-2", "node-3"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe("Execution failed");
    });

    it("should collect next nodes from all successful executions", async () => {
      const executeNode = vi
        .fn()
        .mockImplementation((node: TaskNode) =>
          Promise.resolve([`${node.id}-next`]),
        );
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: {
          "node-1": { id: "node-1", type: "action" },
          "node-2": { id: "node-2", type: "action" },
        },
        startNode: "node-1",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["node-1", "node-2"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await executor.executeParallel(
        ["node-1", "node-2"],
        workflow,
        instance,
      );

      expect(result.allSucceeded).toBe(true);
      expect(result.nextNodes).toContain("node-1-next");
      expect(result.nextNodes).toContain("node-2-next");
    });

    it("should track execution duration", async () => {
      const executeNode = vi.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return ["next"];
      });
      const executor = new ParallelExecutor(executeNode);

      const workflow: WorkflowDefinition = {
        id: "test",
        name: "Test Workflow",
        nodes: { "slow-node": { id: "slow-node", type: "action" } },
        startNode: "slow-node",
      };
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: ["slow-node"],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = await executor.executeParallel(
        ["slow-node"],
        workflow,
        instance,
      );

      expect(result.results[0].duration).toBeGreaterThanOrEqual(30);
    });
  });

  describe("handlePartialFailure", () => {
    it("should fail fast when strategy is fail-fast and there are errors", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: false,
        results: [
          { nodeId: "node-1", success: true },
          { nodeId: "node-2", success: false },
        ],
        nextNodes: ["next-1"],
        errors: [new Error("Failed")],
      };

      const handled = executor.handlePartialFailure(result, "fail-fast");

      expect(handled.shouldContinue).toBe(false);
      expect(handled.nextNodes).toHaveLength(0);
    });

    it("should continue when fail-fast and all succeed", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: true,
        results: [
          { nodeId: "node-1", success: true },
          { nodeId: "node-2", success: true },
        ],
        nextNodes: ["next-1", "next-2"],
        errors: [],
      };

      const handled = executor.handlePartialFailure(result, "fail-fast");

      expect(handled.shouldContinue).toBe(true);
      expect(handled.nextNodes).toEqual(["next-1", "next-2"]);
    });

    it("should continue when strategy is continue and some succeed", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: false,
        results: [
          { nodeId: "node-1", success: true },
          { nodeId: "node-2", success: false },
        ],
        nextNodes: ["next-1"],
        errors: [new Error("Failed")],
      };

      const handled = executor.handlePartialFailure(result, "continue");

      expect(handled.shouldContinue).toBe(true);
      expect(handled.nextNodes).toEqual(["next-1"]);
    });

    it("should not continue when continue strategy and all fail", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: false,
        results: [
          { nodeId: "node-1", success: false },
          { nodeId: "node-2", success: false },
        ],
        nextNodes: [],
        errors: [new Error("Failed"), new Error("Failed too")],
      };

      const handled = executor.handlePartialFailure(result, "continue");

      expect(handled.shouldContinue).toBe(false);
    });

    it("should always continue when strategy is ignore-errors", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: false,
        results: [
          { nodeId: "node-1", success: false },
          { nodeId: "node-2", success: false },
        ],
        nextNodes: [],
        errors: [new Error("Failed")],
      };

      const handled = executor.handlePartialFailure(result, "ignore-errors");

      expect(handled.shouldContinue).toBe(true);
    });

    it("should default to fail-fast behavior", () => {
      const executor = new ParallelExecutor(async () => []);
      const result: any = {
        allSucceeded: false,
        results: [{ nodeId: "node-1", success: false }],
        nextNodes: [],
        errors: [new Error("Failed")],
      };

      const handled = executor.handlePartialFailure(result);

      expect(handled.shouldContinue).toBe(false);
    });
  });

  describe("mergeParallelResults", () => {
    it("should merge results into instance context", () => {
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: [],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const results = [
        {
          nodeId: "node-1",
          success: true,
          nextNodes: ["next"],
          duration: 100,
        },
        {
          nodeId: "node-2",
          success: false,
          nextNodes: [],
          duration: 50,
          error: new Error("Failed"),
        },
      ];

      mergeParallelResults(instance, results as any);

      expect(instance.context.__parallelResults).toBeDefined();
      expect(instance.context.__parallelResults["node-1"]).toEqual({
        success: true,
        duration: 100,
        error: undefined,
      });
      expect(instance.context.__parallelResults["node-2"]).toEqual({
        success: false,
        duration: 50,
        error: "Failed",
      });
    });

    it("should handle empty results", () => {
      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test",
        currentNodes: [],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mergeParallelResults(instance, []);

      expect(instance.context.__parallelResults).toEqual({});
    });
  });
});
