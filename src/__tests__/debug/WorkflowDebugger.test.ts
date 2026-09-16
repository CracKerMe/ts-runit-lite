import { beforeEach, describe, expect, it, vi } from "vitest";
import { BreakpointManager } from "../../debug/BreakpointManager";
import { WorkflowDebugger } from "../../debug/WorkflowDebugger";

describe("BreakpointManager", () => {
  it("should match breakpoints by instance and node", () => {
    const manager = new BreakpointManager();
    const breakpoint = manager.add("instance-1", "node-1");

    expect(manager.shouldBreak("instance-1", "node-1")).toEqual(breakpoint);
    expect(manager.shouldBreak("instance-1", "node-2")).toBeNull();
  });

  it("should evaluate conditions against context", () => {
    const manager = new BreakpointManager();
    manager.add("instance-1", "node-1", "context.amount > 100");

    expect(
      manager.shouldBreak("instance-1", "node-1", { amount: 50 }),
    ).toBeNull();
    expect(
      manager.shouldBreak("instance-1", "node-1", { amount: 150 })?.hitCount,
    ).toBe(1);
  });
});

describe("WorkflowDebugger", () => {
  let debugger_: WorkflowDebugger;

  beforeEach(() => {
    debugger_ = new WorkflowDebugger();
  });

  it("should attach to instance", () => {
    debugger_.attach("test-instance");

    const snapshot = debugger_.getSnapshot();
    expect(snapshot.instanceId).toBe("test-instance");
    expect(snapshot.state).toBe("idle");
  });

  it("should add and remove breakpoints", () => {
    debugger_.attach("test-instance");
    const breakpoint = debugger_.addBreakpoint("node-1");

    expect(breakpoint.nodeId).toBe("node-1");
    expect(debugger_.getSnapshot().breakpoints).toHaveLength(1);

    debugger_.removeBreakpoint(breakpoint.id);
    expect(debugger_.getSnapshot().breakpoints).toHaveLength(0);
  });

  it("should track call stack", () => {
    debugger_.attach("test-instance");
    debugger_.onNodeEnter("test-instance", "node-1", {});
    debugger_.onNodeEnter("test-instance", "node-2", {});

    const snapshot = debugger_.getSnapshot();
    expect(snapshot.callStack).toEqual(["node-1", "node-2"]);
    expect(snapshot.currentNodeId).toBe("node-2");

    debugger_.onNodeExit("test-instance", "node-2");
    expect(debugger_.getSnapshot().currentNodeId).toBe("node-1");
  });

  it("should pause on breakpoint", () => {
    debugger_.attach("test-instance");
    debugger_.addBreakpoint("node-1");
    const onPaused = vi.fn();
    debugger_.on("paused", onPaused);

    debugger_.onNodeEnter("test-instance", "node-1", {});

    expect(onPaused).toHaveBeenCalledTimes(1);
    expect(debugger_.getState()).toBe("paused");
  });

  it("should ignore nodes from other instances", () => {
    debugger_.attach("test-instance");
    debugger_.addBreakpoint("node-1");

    debugger_.onNodeEnter("other-instance", "node-1", {});

    expect(debugger_.getSnapshot().callStack).toEqual([]);
    expect(debugger_.getState()).toBe("idle");
  });
});
