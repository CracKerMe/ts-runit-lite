// oxlint-disable no-explicit-any -- test file uses dynamic types
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { TaskNode } from "../../model/Workflow";
import { dispatchControlNode } from "../../engine/nodeDispatch/controlNodes";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeInstance(): WorkflowInstance {
  return {
    instanceId: "inst-1",
    workflowId: "wf-1",
    status: "running",
    currentNodes: ["waitForReceipt"],
    context: {},
    logs: [],
    retries: {},
  } as unknown as WorkflowInstance;
}

function makeWaitNode(config: Record<string, unknown>): TaskNode {
  return {
    id: "waitForReceipt",
    type: "wait",
    config,
    next: ["autoConfirm"],
  } as TaskNode;
}

function dispatch(
  node: TaskNode,
  instance: WorkflowInstance,
  storage?: unknown,
) {
  const onComplete = vi.fn();
  const promise = dispatchControlNode({
    node,
    instance,
    logEntry: { nodeId: node.id, timestamp: new Date(), status: "started" },
    startTime: Date.now(),
    onComplete,
    storage,
  } as any);
  return { promise, onComplete };
}

function makeStorage() {
  return {
    saveInstance: vi.fn().mockResolvedValue(undefined),
    updateNodeMetrics: vi.fn().mockResolvedValue(undefined),
  };
}

describe("durable wait — surviving a process restart", () => {
  // The suite runs with singleFork, so fake timers left installed here would
  // leak into every test file that runs after this one.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists the pinned deadline before sleeping", async () => {
    const storage = makeStorage();
    const instance = makeInstance();
    const node = makeWaitNode({ durationMs: 7 * DAY_MS });

    await dispatch(node, instance, storage).promise;

    // Persisted during dispatch, not after the wait fires — a crash mid-sleep
    // would otherwise lose the deadline.
    expect(storage.saveInstance).toHaveBeenCalled();
    const saved = storage.saveInstance.mock.calls[0][0] as WorkflowInstance;
    const pinned = saved.state?.nodes?.waitForReceipt?.deadline;
    expect(pinned).toBeTypeOf("number");
    expect(pinned! - Date.now()).toBeGreaterThan(6 * DAY_MS);
  });

  it("waits only the remaining time after a restart, not the full duration", async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const node = makeWaitNode({ durationMs: 7 * DAY_MS });

    // Simulate recovery: the instance was reloaded from storage carrying a
    // deadline pinned 6 days ago, and the engine re-enters the wait node.
    const recovered = makeInstance();
    recovered.state = {
      nodes: { waitForReceipt: { deadline: Date.now() + DAY_MS } },
    };

    const { onComplete } = dispatch(node, recovered, storage);

    // Not fired after 6 more days of the ORIGINAL duration...
    await vi.advanceTimersByTimeAsync(DAY_MS - 1000);
    expect(onComplete).not.toHaveBeenCalled();

    // ...but fires once the original deadline is reached.
    await vi.advanceTimersByTimeAsync(2000);
    expect(onComplete).toHaveBeenCalledWith(["autoConfirm"]);
  });

  it("fires immediately when the deadline passed while the process was down", async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const node = makeWaitNode({ durationMs: 7 * DAY_MS });

    const recovered = makeInstance();
    recovered.state = {
      nodes: { waitForReceipt: { deadline: Date.now() - DAY_MS } },
    };

    const { onComplete } = dispatch(node, recovered, storage);

    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledWith(["autoConfirm"]);
  });

  it("clears the pinned deadline once the wait fires", async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const instance = makeInstance();
    const node = makeWaitNode({ durationMs: 1000 });

    const { onComplete } = dispatch(node, instance, storage);
    await vi.advanceTimersByTimeAsync(1100);

    expect(onComplete).toHaveBeenCalled();
    // Re-entry (loop body / rollback revisit) must start a fresh wait rather
    // than completing instantly against a stale deadline.
    expect(instance.state?.nodes?.waitForReceipt?.deadline).toBeUndefined();
  });

  it("still completes when no storage is configured", async () => {
    vi.useFakeTimers();
    const instance = makeInstance();
    const node = makeWaitNode({ durationMs: 1000 });

    const { onComplete } = dispatch(node, instance, undefined);
    await vi.advanceTimersByTimeAsync(1100);

    expect(onComplete).toHaveBeenCalledWith(["autoConfirm"]);
  });

  it("does not let a storage failure block the wait", async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    storage.saveInstance.mockRejectedValue(new Error("disk full"));
    const instance = makeInstance();
    const node = makeWaitNode({ durationMs: 1000 });

    const { onComplete } = dispatch(node, instance, storage);
    await vi.advanceTimersByTimeAsync(1100);

    expect(onComplete).toHaveBeenCalledWith(["autoConfirm"]);
  });
});
