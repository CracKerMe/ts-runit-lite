// oxlint-disable no-explicit-any -- test file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { WorkflowDefinition } from "../../model/Workflow";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { hookManager } from "../../event/HookManager";
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

/** 快速重试策略：避免测试因指数退避而变慢。 */
const FAST_RETRY = {
  initialInterval: 1,
  backoffCoefficient: 1,
  maximumAttempts: 3,
};

describe("ExecutionOrchestrator – retry path", () => {
  let storage: MemoryStorage;
  let instanceManager: InstanceManager;
  let orchestrator: ExecutionOrchestrator;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
    instanceManager = new InstanceManager(storage);
    orchestrator = new ExecutionOrchestrator(instanceManager);
  });

  it("should execute downstream nodes exactly once when an upstream node is retried", async () => {
    // 回归守卫：重试若丢失 autoAdvance:false，onComplete 会递归调用
    // execute() 推进下游，而外层批次循环仍挂起——下游被执行两次。
    const instance = makeInstance("inst-retry-once", "wf-retry", "flaky");
    await storage.saveInstance(instance);
    (instanceManager as any).instances.set("inst-retry-once", instance);

    const downstreamCalls: string[] = [];
    let flakyAttempts = 0;

    const wf: WorkflowDefinition = {
      id: "wf-retry",
      name: "wf-retry",
      startNode: "flaky",
      nodes: {
        flaky: {
          id: "flaky",
          type: "action",
          retryPolicy: FAST_RETRY,
          action: async () => {
            flakyAttempts++;
            if (flakyAttempts === 1) throw new Error("transient failure");
            return { ok: true };
          },
          next: ["downstream"],
        },
        downstream: {
          id: "downstream",
          type: "action",
          action: async () => {
            downstreamCalls.push("downstream");
            return {};
          },
          next: ["terminal"],
        },
        terminal: {
          id: "terminal",
          type: "action",
          action: async () => {
            downstreamCalls.push("terminal");
            return {};
          },
          next: [],
        },
      },
    };

    await orchestrator.execute(instance, wf);

    expect(flakyAttempts).toBe(2);
    expect(downstreamCalls).toEqual(["downstream", "terminal"]);
    expect(instance.status).toBe("completed");
  });

  it("should emit workflow.completed exactly once when a node is retried", async () => {
    const instance = makeInstance("inst-retry-hook", "wf-retry-hook", "flaky");
    await storage.saveInstance(instance);
    (instanceManager as any).instances.set("inst-retry-hook", instance);

    const emitSpy = vi.spyOn(hookManager, "emit");
    let attempts = 0;

    const wf: WorkflowDefinition = {
      id: "wf-retry-hook",
      name: "wf-retry-hook",
      startNode: "flaky",
      nodes: {
        flaky: {
          id: "flaky",
          type: "action",
          retryPolicy: FAST_RETRY,
          action: async () => {
            attempts++;
            if (attempts === 1) throw new Error("transient failure");
            return {};
          },
          next: ["tail"],
        },
        tail: {
          id: "tail",
          type: "action",
          action: async () => ({}),
          next: [],
        },
      },
    };

    await orchestrator.execute(instance, wf);
    // 让所有 void hookManager.emit(...) 的微任务落地
    await new Promise((r) => setTimeout(r, 0));

    const completedEvents = emitSpy.mock.calls.filter(
      (call) => (call[0] as any)?.event === "workflow.completed",
    );
    expect(completedEvents).toHaveLength(1);

    emitSpy.mockRestore();
  });

  it("should reject and leave no pending timers when every retry fails", async () => {
    const instance = makeInstance("inst-retry-exhaust", "wf-exhaust", "always");
    await storage.saveInstance(instance);
    (instanceManager as any).instances.set("inst-retry-exhaust", instance);

    let attempts = 0;
    const wf: WorkflowDefinition = {
      id: "wf-exhaust",
      name: "wf-exhaust",
      startNode: "always",
      nodes: {
        always: {
          id: "always",
          type: "action",
          retryPolicy: { ...FAST_RETRY, maximumAttempts: 2 },
          action: async () => {
            attempts++;
            throw new Error("permanent failure");
          },
          next: [],
        },
      },
    };

    await expect(orchestrator.execute(instance, wf)).rejects.toThrow(
      "permanent failure",
    );

    // 重试次数受 maximumAttempts 约束，不会无限重试
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(3);
    expect(instance.status).toBe("failed");
  });

  it("should honour failureNext after retries are exhausted", async () => {
    const instance = makeInstance("inst-retry-fallback", "wf-fallback", "main");
    await storage.saveInstance(instance);
    (instanceManager as any).instances.set("inst-retry-fallback", instance);

    const calls: string[] = [];
    const wf: WorkflowDefinition = {
      id: "wf-fallback",
      name: "wf-fallback",
      startNode: "main",
      nodes: {
        main: {
          id: "main",
          type: "action",
          retryPolicy: { ...FAST_RETRY, maximumAttempts: 2 },
          action: async () => {
            calls.push("main");
            throw new Error("always fails");
          },
          next: [],
          failureNext: ["fallback"],
        },
        fallback: {
          id: "fallback",
          type: "action",
          action: async () => {
            calls.push("fallback");
            return {};
          },
          next: [],
        },
      },
    };

    await orchestrator.execute(instance, wf);

    // fallback 只应执行一次，不因重试路径重复推进
    expect(calls.filter((c) => c === "fallback")).toHaveLength(1);
    expect(instance.status).toBe("completed");
  });
});
