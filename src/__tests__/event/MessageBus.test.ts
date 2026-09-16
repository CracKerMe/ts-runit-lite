import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageBus } from "../../event/MessageBus";

describe("MessageBus", () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  // ── Signal ────────────────────────────────────────────────────────────────

  describe("signal", () => {
    it("should register and invoke a signal handler", async () => {
      const handler = vi.fn();
      bus.registerSignal("approve", handler);
      await bus.sendSignal("inst-1", "approve", { approved: true });
      expect(handler).toHaveBeenCalledWith("inst-1", "approve", {
        approved: true,
      });
    });

    it("should invoke multiple signal handlers in order", async () => {
      const order: number[] = [];
      bus.registerSignal(
        "ping",
        vi.fn(async () => {
          order.push(1);
        }),
      );
      bus.registerSignal(
        "ping",
        vi.fn(async () => {
          order.push(2);
        }),
      );
      await bus.sendSignal("inst-1", "ping", {});
      expect(order).toEqual([1, 2]);
    });

    it("should be a no-op when no signal handler is registered", async () => {
      await expect(
        bus.sendSignal("inst-1", "unknown", {}),
      ).resolves.not.toThrow();
    });

    it("should swallow handler errors and continue", async () => {
      const failing = vi.fn().mockRejectedValue(new Error("signal err"));
      const ok = vi.fn();
      bus.registerSignal("evt", failing);
      bus.registerSignal("evt", ok);
      await expect(bus.sendSignal("inst-1", "evt", {})).resolves.not.toThrow();
      expect(ok).toHaveBeenCalled();
    });

    it("should unregister a specific signal handler", async () => {
      const fn = vi.fn();
      bus.registerSignal("go", fn);
      bus.unregisterSignal("go", fn);
      await bus.sendSignal("inst-1", "go", {});
      expect(fn).not.toHaveBeenCalled();
    });

    it("getSignalHandlers should return registered handlers", () => {
      const fn = vi.fn();
      bus.registerSignal("check", fn);
      expect(bus.getSignalHandlers("check")).toContain(fn);
    });

    it("getSignalHandlers should return empty array when none registered", () => {
      expect(bus.getSignalHandlers("nonexistent")).toEqual([]);
    });
  });

  // ── Query ─────────────────────────────────────────────────────────────────

  describe("query", () => {
    it("should register and invoke a query handler", async () => {
      bus.registerQuery("status", async (_id, _name, _payload) => ({
        running: true,
      }));
      const result = await bus.sendQuery("inst-1", "status", {});
      expect(result).toEqual({ running: true });
    });

    it("should throw when no query handler is registered", async () => {
      await expect(bus.sendQuery("inst-1", "missing", {})).rejects.toThrow(
        "No query handler registered: missing",
      );
    });

    it("should propagate query handler errors", async () => {
      bus.registerQuery("broken", async () => {
        throw new Error("query fail");
      });
      await expect(bus.sendQuery("inst-1", "broken", {})).rejects.toThrow(
        "query fail",
      );
    });

    it("should overwrite previous query handler when re-registered", async () => {
      bus.registerQuery("ctx", async () => "first");
      bus.registerQuery("ctx", async () => "second");
      const result = await bus.sendQuery("inst-1", "ctx", {});
      expect(result).toBe("second");
    });

    it("should unregister a query handler", async () => {
      bus.registerQuery("data", async () => 42);
      bus.unregisterQuery("data");
      await expect(bus.sendQuery("inst-1", "data", {})).rejects.toThrow();
    });

    it("getQueryHandler should return the registered handler", () => {
      const fn = vi.fn();
      bus.registerQuery("info", fn);
      expect(bus.getQueryHandler("info")).toBe(fn);
    });

    it("getQueryHandler should return undefined when not registered", () => {
      expect(bus.getQueryHandler("missing")).toBeUndefined();
    });
  });

  // ── Update ────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("should register and invoke an update handler", async () => {
      bus.registerUpdate("setCtx", async (_id, _name, payload) => ({
        updated: true,
        payload,
      }));
      const result = await bus.sendUpdate("inst-1", "setCtx", { key: "val" });
      expect(result).toEqual({ updated: true, payload: { key: "val" } });
    });

    it("should throw when no update handler is registered", async () => {
      await expect(bus.sendUpdate("inst-1", "mystery", {})).rejects.toThrow(
        "No update handler registered: mystery",
      );
    });

    it("should call multiple update handlers in sequence and return last result", async () => {
      bus.registerUpdate("chain", async () => "first");
      bus.registerUpdate("chain", async () => "second");
      const result = await bus.sendUpdate("inst-1", "chain", {});
      expect(result).toBe("second");
    });

    it("should propagate update handler errors", async () => {
      bus.registerUpdate("bad", async () => {
        throw new Error("update fail");
      });
      await expect(bus.sendUpdate("inst-1", "bad", {})).rejects.toThrow(
        "update fail",
      );
    });

    it("should unregister a specific update handler via unregisterUpdate(name, fn)", async () => {
      const fn = vi.fn().mockResolvedValue("result");
      bus.registerUpdate("act", fn);
      bus.unregisterUpdate("act", fn);
      await expect(bus.sendUpdate("inst-1", "act", {})).rejects.toThrow();
    });

    it("should unregister all update handlers via unregisterUpdate(name)", async () => {
      bus.registerUpdate("clean", async () => "ok");
      bus.unregisterUpdate("clean");
      await expect(bus.sendUpdate("inst-1", "clean", {})).rejects.toThrow();
    });

    it("getUpdateHandlers should return all registered handlers", () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.registerUpdate("multi", fn1);
      bus.registerUpdate("multi", fn2);
      expect(bus.getUpdateHandlers("multi")).toContain(fn1);
      expect(bus.getUpdateHandlers("multi")).toContain(fn2);
    });

    it("getUpdateHandlers should return empty array when none registered", () => {
      expect(bus.getUpdateHandlers("none")).toEqual([]);
    });
  });
});
