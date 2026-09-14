// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hookManager } from "../../event/HookManager";
import type { WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import { SubworkflowExecutor } from "../SubworkflowExecutor";

function makeParentInstance(
  overrides: Partial<WorkflowInstance> = {},
): WorkflowInstance {
  return {
    instanceId: "parent-instance",
    workflowId: "parent",
    currentNodes: ["subworkflow-node"],
    status: "running",
    context: {},
    state: { nodes: {} },
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("SubworkflowExecutor", () => {
  let executor: SubworkflowExecutor;
  let startWorkflow: any;
  let getInstanceStatus: any;

  beforeEach(() => {
    startWorkflow = vi.fn();
    getInstanceStatus = vi.fn();
    executor = new SubworkflowExecutor(startWorkflow, getInstanceStatus);
  });

  describe("execute", () => {
    it("should throw error when subworkflowId is missing", async () => {
      const node: TaskNode = { id: "subworkflow-node", type: "subworkflow" };
      await expect(
        executor.execute(node, makeParentInstance()),
      ).rejects.toThrow("Subworkflow node missing subworkflowId");
    });

    it("should start subworkflow without waiting (fire-and-forget)", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: false,
      };
      const instance = makeParentInstance({ context: { inputData: "test" } });
      startWorkflow.mockResolvedValue("child-instance-123");

      const result = await executor.execute(node, instance);

      expect(startWorkflow).toHaveBeenCalledWith(
        "child-workflow",
        expect.objectContaining({
          __parentInstanceId: "parent-instance",
          __parentWorkflowId: "parent",
        }),
        "parent-instance",
      );
      expect(result.instanceId).toBe("child-instance-123");
      expect(result.status).toBe("running");
      expect(instance.state?.nodes?.["subworkflow-node"]?.output).toEqual({
        instanceId: "child-instance-123",
        status: "running",
      });
    });

    it("should start subworkflow with input mapping", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: false,
        subworkflowInput: {
          childParam: "parent.inputData",
          literalValue: "$literal:hello",
        },
      };
      const instance = makeParentInstance({
        context: { inputData: "test-value" },
      });
      startWorkflow.mockResolvedValue("child-instance-456");

      await executor.execute(node, instance);

      expect(startWorkflow).toHaveBeenCalledWith(
        "child-workflow",
        expect.objectContaining({
          childParam: "test-value",
          literalValue: "hello",
        }),
        "parent-instance",
      );
    });

    it("should resolve immediately when early-check finds completed instance", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-789");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-789",
        status: "completed",
        context: { result: "success" },
      });

      const result = await executor.execute(node, makeParentInstance());

      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ result: "success" });
    });

    it("should resolve immediately when early-check finds failed instance", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-fail");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-fail",
        status: "failed",
      });

      const result = await executor.execute(node, makeParentInstance());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("failed");
    });

    it("should resolve immediately when early-check finds cancelled instance", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-cancelled");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-cancelled",
        status: "cancelled",
      });

      const result = await executor.execute(node, makeParentInstance());

      expect(result.status).toBe("failed");
      expect(result.error).toContain("cancelled");
    });

    it("should return failed when subworkflow instance not found", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-missing");
      getInstanceStatus.mockReturnValue(undefined);

      const result = await executor.execute(node, makeParentInstance());

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Subworkflow instance not found");
    });

    it("should timeout when no completion event arrives", async () => {
      vi.useFakeTimers();
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
        timeout: 500,
      };
      startWorkflow.mockResolvedValue("child-instance-timeout");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-timeout",
        status: "running",
      });

      const promise = executor.execute(node, makeParentInstance());
      await vi.advanceTimersByTimeAsync(600);
      const result = await promise;

      vi.useRealTimers();
      expect(result.status).toBe("failed");
      expect(result.error).toContain("timeout");
    }, 15000);

    it("should wait for workflow.completed event when instance is still running", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-polling");
      // Early check returns running – must wait for event
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-polling",
        status: "running",
        context: { val: 1 },
      });

      const promise = executor.execute(node, makeParentInstance());

      // Emit the completion event asynchronously
      await Promise.resolve();
      hookManager.emit({
        event: "workflow.completed",
        instanceId: "child-instance-polling",
        workflowId: "child-workflow",
        timestamp: new Date().toISOString(),
      });

      const result = await promise;
      expect(result.status).toBe("completed");
    });

    it("should resolve with failed when workflow.failed event arrives", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      startWorkflow.mockResolvedValue("child-instance-ev-fail");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-ev-fail",
        status: "running",
      });

      const promise = executor.execute(node, makeParentInstance());

      await Promise.resolve();
      hookManager.emit({
        event: "workflow.failed",
        instanceId: "child-instance-ev-fail",
        workflowId: "child-workflow",
        timestamp: new Date().toISOString(),
        data: { error: "downstream error" },
      });

      const result = await promise;
      expect(result.status).toBe("failed");
      expect(result.error).toBe("downstream error");
    });

    it("should store output in parent instance state", async () => {
      const node: TaskNode = {
        id: "subworkflow-node",
        type: "subworkflow",
        subworkflowId: "child-workflow",
        waitForCompletion: true,
      };
      const parentInstance = makeParentInstance();
      startWorkflow.mockResolvedValue("child-instance-output");
      getInstanceStatus.mockReturnValue({
        instanceId: "child-instance-output",
        status: "completed",
        context: { outputValue: 42 },
      });

      await executor.execute(node, parentInstance);

      expect(parentInstance.state?.nodes?.["subworkflow-node"]?.output).toEqual(
        {
          instanceId: "child-instance-output",
          status: "completed",
          output: { outputValue: 42 },
        },
      );
    });
  });

  describe("depth limiting", () => {
    const node: TaskNode = {
      id: "subworkflow-node",
      type: "subworkflow",
      subworkflowId: "child-workflow",
      waitForCompletion: false,
    };

    it("should stamp an incrementing depth onto the child context", async () => {
      startWorkflow.mockResolvedValue("child-1");

      await executor.execute(node, makeParentInstance());
      expect(startWorkflow).toHaveBeenCalledWith(
        "child-workflow",
        expect.objectContaining({ __subworkflowDepth: 1 }),
        "parent-instance",
      );

      await executor.execute(
        node,
        makeParentInstance({ context: { __subworkflowDepth: 4 } }),
      );
      expect(startWorkflow).toHaveBeenLastCalledWith(
        "child-workflow",
        expect.objectContaining({ __subworkflowDepth: 5 }),
        "parent-instance",
      );
    });

    it("should reject beyond the depth limit without starting an instance", async () => {
      // 回归守卫：此前没有任何深度限制，自引用的子工作流会一路递归到
      // maxInstances 才抛错，期间已创建并落盘上万实例。
      const previous = process.env.MAX_SUBWORKFLOW_DEPTH;
      process.env.MAX_SUBWORKFLOW_DEPTH = "3";

      try {
        startWorkflow.mockResolvedValue("child-x");

        // depth 3 仍然允许
        await executor.execute(
          node,
          makeParentInstance({ context: { __subworkflowDepth: 2 } }),
        );
        expect(startWorkflow).toHaveBeenCalledTimes(1);

        // depth 4 超限：抛错且不得启动子实例
        startWorkflow.mockClear();
        await expect(
          executor.execute(
            node,
            makeParentInstance({ context: { __subworkflowDepth: 3 } }),
          ),
        ).rejects.toThrow("Subworkflow depth limit exceeded (3)");

        expect(startWorkflow).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.MAX_SUBWORKFLOW_DEPTH;
        else process.env.MAX_SUBWORKFLOW_DEPTH = previous;
      }
    });

    it("should terminate a self-referencing subworkflow chain", async () => {
      const previous = process.env.MAX_SUBWORKFLOW_DEPTH;
      process.env.MAX_SUBWORKFLOW_DEPTH = "5";

      try {
        // 模拟引擎：每次 startWorkflow 都用子 context 再次进入同一节点
        let started = 0;
        startWorkflow.mockImplementation(
          async (_id: string, context: Record<string, any>) => {
            started++;
            const child = makeParentInstance({
              instanceId: `child-${started}`,
              context,
            });
            await executor.execute(node, child);
            return `child-${started}`;
          },
        );

        await expect(
          executor.execute(node, makeParentInstance()),
        ).rejects.toThrow("Subworkflow depth limit exceeded (5)");

        // 递归在第 5 层被截断，而不是一路跑到 maxInstances
        expect(started).toBe(5);
      } finally {
        if (previous === undefined) delete process.env.MAX_SUBWORKFLOW_DEPTH;
        else process.env.MAX_SUBWORKFLOW_DEPTH = previous;
      }
    });
  });
});
