import { describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import { notificationManager } from "../../notification/index";
import { TaskExecutor } from "../../engine/TaskExecutor";

describe("TaskExecutor - Routing Nodes", () => {
  describe("condition node", () => {
    it("should execute condition node and route to true branch", async () => {
      const node: TaskNode = {
        id: "condition-1",
        type: "condition",
        config: {
          condition: "value > 10",
          trueBranch: "node-true",
          falseBranch: "node-false",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 15 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-true"]);
      expect(instance.state?.nodes?.["condition-1"]?.output).toEqual({
        result: true,
        branch: "true",
      });
    });

    it("should execute condition node and route to false branch", async () => {
      const node: TaskNode = {
        id: "condition-2",
        type: "condition",
        config: {
          condition: "value > 10",
          trueBranch: "node-true",
          falseBranch: "node-false",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 5 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-false"]);
      expect(instance.state?.nodes?.["condition-2"]?.output).toEqual({
        result: false,
        branch: "false",
      });
    });

    it("should handle invalid condition syntax errors", async () => {
      const node: TaskNode = {
        id: "condition-3",
        type: "condition",
        config: {
          condition: "invalid syntax >>>",
          trueBranch: "node-true",
          falseBranch: "node-false",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toContain(
        "Condition evaluation failed",
      );
    });

    it("should handle undefined values gracefully (evaluates to false)", async () => {
      const node: TaskNode = {
        id: "condition-4",
        type: "condition",
        config: {
          condition: "nonexistent.property > 10",
          trueBranch: "node-true",
          falseBranch: "node-false",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: {},
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      // Undefined values should evaluate to false, not throw errors
      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-false"]);
      expect(instance.state?.nodes?.["condition-4"]?.output).toEqual({
        result: false,
        branch: "false",
      });
    });
  });

  describe("router node", () => {
    it("should execute router node and route to first matching condition", async () => {
      const node: TaskNode = {
        id: "router-1",
        type: "router",
        config: {
          routes: [
            { condition: "value < 10", target: "node-small" },
            { condition: "value < 50", target: "node-medium" },
            { condition: "value < 100", target: "node-large" },
          ],
          defaultTarget: "node-default",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 25 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-medium"]);
      expect(instance.state?.nodes?.["router-1"]?.output).toEqual({
        matchedRoute: 1,
        target: "node-medium",
      });
    });

    it("should route to default target when no conditions match", async () => {
      const node: TaskNode = {
        id: "router-2",
        type: "router",
        config: {
          routes: [
            { condition: "value < 10", target: "node-small" },
            { condition: "value < 50", target: "node-medium" },
          ],
          defaultTarget: "node-default",
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 100 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-default"]);
      expect(instance.state?.nodes?.["router-2"]?.output).toEqual({
        matchedRoute: -1,
        target: "node-default",
      });
    });

    it("should respect route priority", async () => {
      const node: TaskNode = {
        id: "router-3",
        type: "router",
        config: {
          routes: [
            {
              condition: "value > 0",
              target: "node-low-priority",
              priority: 10,
            },
            {
              condition: "value > 0",
              target: "node-high-priority",
              priority: 1,
            },
          ],
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 5 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-high-priority"]);
      const routerOutput = instance.state?.nodes?.["router-3"]?.output as {
        target?: string;
      };
      expect(routerOutput?.target).toBe("node-high-priority");
    });

    it("should handle router errors when no routes match and no default", async () => {
      const node: TaskNode = {
        id: "router-4",
        type: "router",
        config: {
          routes: [{ condition: "value < 10", target: "node-small" }],
          // No default target
        },
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { value: 100 },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      await TaskExecutor.execute(node, instance, onComplete, onError);

      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalled();
      expect(onError.mock.calls[0][0].message).toContain(
        "No routes matched and no default target",
      );
    });
  });

  describe("notification node", () => {
    it("should execute notification node and continue to next nodes", async () => {
      const send = vi
        .spyOn(notificationManager, "send")
        .mockResolvedValue({ ok: true, channel: "slack" });

      const node: TaskNode = {
        id: "notification-1",
        type: "notification",
        config: {
          channel: "slack",
          target: "#ops",
          template: "实例 {{context.orderId}} 已完成",
        },
        next: ["node-2"],
      };

      const instance: WorkflowInstance = {
        instanceId: "test-instance",
        workflowId: "test-workflow",
        currentNodes: [],
        status: "running",
        context: { orderId: "ORD-1" },
        state: { nodes: {} },
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const onComplete = vi.fn();
      const onError = vi.fn();

      try {
        await TaskExecutor.execute(node, instance, onComplete, onError);
      } finally {
        send.mockRestore();
      }

      expect(onError).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledWith(["node-2"]);
      expect(instance.state?.nodes?.["notification-1"]?.output).toEqual({
        ok: true,
        channel: "slack",
      });
    });
  });
});
