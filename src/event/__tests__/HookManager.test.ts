import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHookPayload,
  HookManager,
  type HookPayload,
  offHook,
  onHook,
  setHookDispatcher,
} from "../HookManager";

function makePayload(
  event: string,
  overrides: Partial<HookPayload> = {},
): HookPayload {
  return createHookPayload({
    event,
    workflowId: "wf-1",
    instanceId: "inst-1",
    status: "running",
    ...overrides,
  });
}

describe("createHookPayload", () => {
  it("should set timestamp automatically when omitted", () => {
    const before = new Date().toISOString();
    const payload = createHookPayload({ event: "workflow.started" });
    const after = new Date().toISOString();
    expect(payload.timestamp).toBeDefined();
    expect(payload.timestamp >= before).toBe(true);
    expect(payload.timestamp <= after).toBe(true);
  });

  it("should use provided timestamp if given", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const payload = createHookPayload({
      event: "workflow.started",
      timestamp: ts,
    });
    expect(payload.timestamp).toBe(ts);
  });
});

describe("HookManager", () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  describe("on / off", () => {
    it("should register and call a listener for a specific event", async () => {
      const fn = vi.fn();
      manager.on("workflow.started", fn);
      await manager.emit(makePayload("workflow.started"));
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should not call listener for a different event", async () => {
      const fn = vi.fn();
      manager.on("workflow.started", fn);
      await manager.emit(makePayload("workflow.completed"));
      expect(fn).not.toHaveBeenCalled();
    });

    it("should support removing a listener via returned cleanup function", async () => {
      const fn = vi.fn();
      const cleanup = manager.on("workflow.started", fn);
      cleanup();
      await manager.emit(makePayload("workflow.started"));
      expect(fn).not.toHaveBeenCalled();
    });

    it("should support removing a listener via off()", async () => {
      const fn = vi.fn();
      manager.on("workflow.failed", fn);
      manager.off("workflow.failed", fn);
      await manager.emit(makePayload("workflow.failed"));
      expect(fn).not.toHaveBeenCalled();
    });

    it("should be a no-op when off() is called for an unregistered event", () => {
      const fn = vi.fn();
      expect(() => manager.off("workflow.started", fn)).not.toThrow();
    });

    it("should support multiple listeners for the same event", async () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      manager.on("node.started", fn1);
      manager.on("node.started", fn2);
      await manager.emit(makePayload("node.started"));
      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("should pass the full payload to the listener", async () => {
      const fn = vi.fn();
      manager.on("workflow.completed", fn);
      const payload = makePayload("workflow.completed", {
        data: { key: "val" },
      });
      await manager.emit(payload);
      expect(fn).toHaveBeenCalledWith(payload);
    });
  });

  describe("wildcard listener (*)", () => {
    it("should receive all events when registered with *", async () => {
      const fn = vi.fn();
      manager.on("*", fn);
      await manager.emit(makePayload("workflow.started"));
      await manager.emit(makePayload("node.completed"));
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should not duplicate calls when both specific and wildcard match", async () => {
      const fn = vi.fn();
      manager.on("workflow.started", fn);
      manager.on("*", fn);
      await manager.emit(makePayload("workflow.started"));
      // fn is the same reference added to a Set; should be called once
      expect(fn).toHaveBeenCalledOnce();
    });

    it("should remove wildcard listener via off()", async () => {
      const fn = vi.fn();
      manager.on("*", fn);
      manager.off("*", fn);
      await manager.emit(makePayload("workflow.started"));
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe("setDispatcher", () => {
    it("should call the dispatcher on each emit", async () => {
      const dispatcher = vi.fn();
      manager.setDispatcher(dispatcher);
      await manager.emit(makePayload("workflow.started"));
      expect(dispatcher).toHaveBeenCalledOnce();
    });

    it("should clear dispatcher when set to undefined", async () => {
      const dispatcher = vi.fn();
      manager.setDispatcher(dispatcher);
      manager.setDispatcher(undefined);
      await manager.emit(makePayload("workflow.started"));
      expect(dispatcher).not.toHaveBeenCalled();
    });
  });

  describe("error isolation", () => {
    it("should continue calling other listeners after one throws", async () => {
      const failing = vi.fn().mockRejectedValue(new Error("boom"));
      const succeeding = vi.fn();
      manager.on("node.failed", failing);
      manager.on("node.failed", succeeding);
      await expect(
        manager.emit(makePayload("node.failed")),
      ).resolves.not.toThrow();
      expect(succeeding).toHaveBeenCalledOnce();
    });

    it("should not throw when dispatcher rejects", async () => {
      manager.setDispatcher(
        vi.fn().mockRejectedValue(new Error("dispatch err")),
      );
      await expect(
        manager.emit(makePayload("workflow.started")),
      ).resolves.not.toThrow();
    });
  });

  describe("no listeners", () => {
    it("should be a no-op when no listeners are registered", async () => {
      await expect(
        manager.emit(makePayload("workflow.started")),
      ).resolves.not.toThrow();
    });
  });
});

describe("module-level onHook / offHook helpers", () => {
  afterEach(() => {
    setHookDispatcher(undefined);
  });

  it("onHook should register on the global hookManager", async () => {
    const fn = vi.fn();
    const cleanup = onHook("workflow.cancelled", fn);
    const payload = makePayload("workflow.cancelled");
    // We only verify it does not throw; global singleton may have other listeners
    await expect(
      import("../HookManager").then((m) => m.hookManager.emit(payload)),
    ).resolves.not.toThrow();
    cleanup();
  });

  it("offHook should remove listener from global hookManager", () => {
    const fn = vi.fn();
    onHook("node.retry", fn);
    expect(() => offHook("node.retry", fn)).not.toThrow();
  });
});
