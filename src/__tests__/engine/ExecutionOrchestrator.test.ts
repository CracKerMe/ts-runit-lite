// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { WorkflowDefinition } from "../../model/Workflow";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { ExecutionOrchestrator } from "../../engine/ExecutionOrchestrator";
import { InstanceManager } from "../../engine/InstanceManager";

function makeInstance(
  id: string,
  workflowId: string,
  startNode: string,
): WorkflowInstance {
  return {
    instanceId: id,
    workflowId,
    currentNodes: [startNode],
    status: "pending",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    retries: {},
    state: { nodes: {} },
  };
}

function singleActionWorkflow(
  id: string,
  action: (inst: WorkflowInstance) => Promise<any>,
): WorkflowDefinition {
  return {
    id,
    name: id,
    startNode: "node-1",
    nodes: {
      "node-1": {
        id: "node-1",
        type: "action",
        action,
        next: [],
      },
    },
  };
}

describe("ExecutionOrchestrator", () => {
  let storage: MemoryStorage;
  let instanceManager: InstanceManager;
  let orchestrator: ExecutionOrchestrator;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
    instanceManager = new InstanceManager(storage);
  });

  // ── execute - success path ─────────────────────────────────────────────────

  describe("execute – success", () => {
    it("should transition instance from pending to running", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-1", "wf-1", "node-1");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-1", instance);

      const wf = singleActionWorkflow("wf-1", async () => ({ ok: true }));
      await orchestrator.execute(instance, wf);

      expect(["running", "completed"]).toContain(instance.status);
    });

    it("should mark workflow as completed when all nodes finish", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-complete", "wf-c", "node-1");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-complete", instance);

      const wf = singleActionWorkflow("wf-c", async () => ({ done: true }));
      await orchestrator.execute(instance, wf);

      expect(instance.status).toBe("completed");
    });

    it("should populate instance state with node output", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-out", "wf-out", "node-1");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-out", instance);

      const wf = singleActionWorkflow("wf-out", async () => ({
        result: "hello",
      }));
      await orchestrator.execute(instance, wf);

      expect(instance.state?.nodes?.["node-1"]?.output).toEqual({
        result: "hello",
      });
    });
  });

  // ── execute - failureNext path ─────────────────────────────────────────────

  describe("execute – failureNext", () => {
    it("should route to failureNext when node action throws", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-fail-next", "wf-fn", "step-1");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-fail-next", instance);

      const fallbackCalled = { val: false };
      const wf: WorkflowDefinition = {
        id: "wf-fn",
        name: "wf-fn",
        startNode: "step-1",
        nodes: {
          "step-1": {
            id: "step-1",
            type: "action",
            action: async () => {
              throw new Error("step-1 failed");
            },
            next: [],
            failureNext: ["fallback"],
          },
          fallback: {
            id: "fallback",
            type: "action",
            action: async () => {
              fallbackCalled.val = true;
              return {};
            },
            next: [],
          },
        },
      };

      await orchestrator.execute(instance, wf);
      expect(fallbackCalled.val).toBe(true);
    });
  });

  // ── execute - default error path ───────────────────────────────────────────

  describe("execute – default failure", () => {
    it("should set instance status to failed when node throws with no failureNext", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-err", "wf-err", "bad-node");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-err", instance);

      const wf: WorkflowDefinition = {
        id: "wf-err",
        name: "wf-err",
        startNode: "bad-node",
        nodes: {
          "bad-node": {
            id: "bad-node",
            type: "action",
            action: async () => {
              throw new Error("unhandled error");
            },
            next: [],
          },
        },
      };

      await expect(orchestrator.execute(instance, wf)).rejects.toThrow(
        "unhandled error",
      );
      expect(instance.status).toBe("failed");
    });
  });

  // ── execute - lease check ──────────────────────────────────────────────────

  describe("execute – ensureLease", () => {
    it("should throw when lease is lost", async () => {
      const ensureLease = vi.fn().mockResolvedValue(false);
      orchestrator = new ExecutionOrchestrator(
        instanceManager,
        undefined,
        ensureLease,
      );
      const instance = makeInstance("inst-lease", "wf-lease", "node-1");
      (instanceManager as any).instances.set("inst-lease", instance);

      const wf = singleActionWorkflow("wf-lease", async () => ({}));
      await expect(orchestrator.execute(instance, wf)).rejects.toThrow(
        "Instance lease lost",
      );
    });
  });

  // ── rollback ───────────────────────────────────────────────────────────────

  describe("rollback", () => {
    it("should throw when rollback target node does not exist", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-rb", "wf-rb", "start");
      (instanceManager as any).instances.set("inst-rb", instance);

      const wf: WorkflowDefinition = {
        id: "wf-rb",
        name: "wf-rb",
        startNode: "start",
        nodes: {
          start: {
            id: "start",
            type: "action",
            action: async () => ({}),
            next: [],
          },
        },
      };

      await expect(
        orchestrator.rollback(instance, wf, "nonexistent-node"),
      ).rejects.toThrow("Target node nonexistent-node not found");
    });

    it("should return false when max retries exceeded", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance: WorkflowInstance = {
        ...makeInstance("inst-max-retry", "wf-mr", "node-1"),
        retries: { "node-1": 5 },
      };
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-max-retry", instance);

      const wf = singleActionWorkflow("wf-mr", async () => ({}));
      const result = await orchestrator.rollback(instance, wf, "node-1", 2);
      expect(result).toBe(false);
      expect(instance.status).toBe("failed");
    });

    it("should return true and re-execute when within max retries", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-rb-ok", "wf-rb-ok", "node-1");
      instance.retries = { "node-1": 1 };
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-rb-ok", instance);

      const wf = singleActionWorkflow("wf-rb-ok", async () => ({ done: true }));
      const result = await orchestrator.rollback(instance, wf, "node-1", 3);
      expect(result).toBe(true);
    });
  });

  // ── rollback-typed nodes reached via normal execution ──────────────────────

  describe("execute – rollback-typed node", () => {
    it("should execute a rollback node's action instead of throwing 'Unsupported task type'", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const instance = makeInstance("inst-rollback-node", "wf-rn", "start");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-rollback-node", instance);

      const compensationCalled = { val: false };
      const wf: WorkflowDefinition = {
        id: "wf-rn",
        name: "wf-rn",
        startNode: "start",
        nodes: {
          start: {
            id: "start",
            type: "action",
            action: async () => {
              throw new Error("start failed");
            },
            next: [],
            rollbackTo: "compensate",
          },
          compensate: {
            id: "compensate",
            type: "rollback",
            action: async () => {
              compensationCalled.val = true;
              return { compensated: true };
            },
            next: [],
          },
        },
      };

      await orchestrator.execute(instance, wf);
      expect(compensationCalled.val).toBe(true);
      expect(instance.status).toBe("completed");
    });
  });

  // ── loop body with subworkflow type ─────────────────────────────────────────

  describe("execute – loop body of type subworkflow", () => {
    it("should invoke SubworkflowExecutor for a subworkflow-typed loop body instead of throwing 'Unsupported task type'", async () => {
      const startWorkflow = vi.fn().mockResolvedValue("child-instance-id");
      orchestrator = new ExecutionOrchestrator(
        instanceManager,
        undefined,
        undefined,
        undefined,
        startWorkflow,
      );
      const instance = makeInstance("inst-loop-sub", "wf-loop-sub", "loop-1");
      instance.context = { items: ["a", "b"] };
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-loop-sub", instance);

      const wf: WorkflowDefinition = {
        id: "wf-loop-sub",
        name: "wf-loop-sub",
        startNode: "loop-1",
        nodes: {
          "loop-1": {
            id: "loop-1",
            type: "loop",
            config: {
              collection: "items",
              itemVariable: "item",
              body: "sub-1",
            },
            next: [],
          },
          "sub-1": {
            id: "sub-1",
            type: "subworkflow",
            subworkflowId: "child-workflow",
            waitForCompletion: false,
            next: [],
          },
        },
      };

      await orchestrator.execute(instance, wf);

      expect(startWorkflow).toHaveBeenCalledTimes(2);
      expect(instance.status).toBe("completed");
    });
  });

  // ── two-node chain ─────────────────────────────────────────────────────────

  describe("execute – multi-node chain", () => {
    it("should execute nodes in sequence", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const order: string[] = [];
      const instance = makeInstance("inst-chain", "wf-chain", "step-a");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-chain", instance);

      const wf: WorkflowDefinition = {
        id: "wf-chain",
        name: "wf-chain",
        startNode: "step-a",
        nodes: {
          "step-a": {
            id: "step-a",
            type: "action",
            action: async () => {
              order.push("a");
              return {};
            },
            next: ["step-b"],
          },
          "step-b": {
            id: "step-b",
            type: "action",
            action: async () => {
              order.push("b");
              return {};
            },
            next: [],
          },
        },
      };

      await orchestrator.execute(instance, wf);
      expect(order).toEqual(["a", "b"]);
      expect(instance.status).toBe("completed");
    });

    it("should execute all nodes in the current batch exactly once before advancing", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const order: string[] = [];
      const instance: WorkflowInstance = {
        ...makeInstance("inst-batch", "wf-batch", "step-a"),
        currentNodes: ["step-a", "step-b"],
      };
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-batch", instance);

      const wf: WorkflowDefinition = {
        id: "wf-batch",
        name: "wf-batch",
        startNode: "step-a",
        nodes: {
          "step-a": {
            id: "step-a",
            type: "action",
            action: async () => {
              order.push("a");
              return {};
            },
            next: ["join"],
          },
          "step-b": {
            id: "step-b",
            type: "action",
            action: async () => {
              order.push("b");
              return {};
            },
            next: ["join"],
          },
          join: {
            id: "join",
            type: "action",
            action: async () => {
              order.push("join");
              return {};
            },
            next: [],
          },
        },
      };

      await orchestrator.execute(instance, wf);

      expect(order).toEqual(["a", "b", "join"]);
      expect(instance.status).toBe("completed");
    });

    it("should complete a long linear workflow without recursive re-entry", async () => {
      orchestrator = new ExecutionOrchestrator(instanceManager);
      const stepCount = 250;
      const order: string[] = [];
      const instance = makeInstance("inst-long", "wf-long", "step-0");
      await storage.saveInstance(instance);
      (instanceManager as any).instances.set("inst-long", instance);

      const nodes: WorkflowDefinition["nodes"] = {};
      for (let i = 0; i < stepCount; i++) {
        nodes[`step-${i}`] = {
          id: `step-${i}`,
          type: "action",
          action: async () => {
            order.push(`step-${i}`);
            return {};
          },
          next: i === stepCount - 1 ? [] : [`step-${i + 1}`],
        };
      }

      await orchestrator.execute(instance, {
        id: "wf-long",
        name: "wf-long",
        startNode: "step-0",
        nodes,
      });

      expect(order).toHaveLength(stepCount);
      expect(order[0]).toBe("step-0");
      expect(order.at(-1)).toBe(`step-${stepCount - 1}`);
      expect(instance.status).toBe("completed");
    });
  });
});
