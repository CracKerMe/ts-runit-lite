// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureHeartbeatTracker,
  HeartbeatTracker,
  type HeartbeatOptions,
  heartbeatTracker,
} from "../../engine/HeartbeatTracker";

describe("HeartbeatTracker", () => {
  let manager: HeartbeatTracker;

  beforeEach(() => {
    manager = new HeartbeatTracker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    manager.stopAll();
    vi.useRealTimers();
  });

  describe("start", () => {
    it("should start a heartbeat with given options", async () => {
      const options: HeartbeatOptions = {
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
      };

      const key = await manager.start(options);

      expect(key).toBe("instance-1:node-1");
      expect(manager.isActive("instance-1", "node-1")).toBe(true);
    });

    it("should call onHeartbeat callback at intervals", () => {
      const onHeartbeat = vi.fn();
      const options: HeartbeatOptions = {
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
        onHeartbeat,
      };

      manager.start(options);

      vi.advanceTimersByTime(1000);
      expect(onHeartbeat).toHaveBeenCalledTimes(1);
      expect(onHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: expect.any(Number) }),
      );

      vi.advanceTimersByTime(1000);
      expect(onHeartbeat).toHaveBeenCalledTimes(2);
    });

    it("should restart heartbeat if already running", () => {
      const onHeartbeat = vi.fn();
      const options: HeartbeatOptions = {
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
        onHeartbeat,
      };

      manager.start(options);
      vi.advanceTimersByTime(500);

      manager.start(options);
      vi.advanceTimersByTime(500);

      expect(onHeartbeat).toHaveBeenCalledTimes(1);
    });

    it("should handle onHeartbeat callback errors", () => {
      const onHeartbeat = vi.fn(() => {
        throw new Error("Callback error");
      });
      const options: HeartbeatOptions = {
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
        onHeartbeat,
      };

      expect(() => {
        manager.start(options);
        vi.advanceTimersByTime(1000);
      }).not.toThrow();
    });

    it("should call onTimeout when heartbeat expires without renewal", async () => {
      const onTimeout = vi.fn();
      await manager.start(
        {
          instanceId: "instance-timeout",
          nodeId: "node-timeout",
          interval: 1000,
          onTimeout,
        },
        200,
      );

      await vi.advanceTimersByTimeAsync(200);

      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(manager.isActive("instance-timeout", "node-timeout")).toBe(false);
    });
  });

  describe("stop", () => {
    it("should stop an active heartbeat", () => {
      const options: HeartbeatOptions = {
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
      };

      manager.start(options);
      expect(manager.isActive("instance-1", "node-1")).toBe(true);

      manager.stop("instance-1", "node-1");
      expect(manager.isActive("instance-1", "node-1")).toBe(false);
    });

    it("should handle stopping non-existent heartbeat", () => {
      expect(() => manager.stop("non-existent", "node")).not.toThrow();
    });
  });

  describe("stopAll", () => {
    it("should stop all active heartbeats", () => {
      manager.start({
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
      });
      manager.start({
        instanceId: "instance-2",
        nodeId: "node-2",
        interval: 1000,
      });

      manager.stopAll();

      expect(manager.isActive("instance-1", "node-1")).toBe(false);
      expect(manager.isActive("instance-2", "node-2")).toBe(false);
    });

    it("should handle stopAll when no heartbeats active", () => {
      expect(() => manager.stopAll()).not.toThrow();
    });
  });

  describe("isActive", () => {
    it("should return false for non-active heartbeat", () => {
      expect(manager.isActive("instance-1", "node-1")).toBe(false);
    });

    it("should return true for active heartbeat", () => {
      manager.start({
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
      });

      expect(manager.isActive("instance-1", "node-1")).toBe(true);
    });
  });

  describe("getKey", () => {
    it("should generate correct key format", async () => {
      const key = await manager.start({
        instanceId: "instance-1",
        nodeId: "node-1",
        interval: 1000,
      });

      expect(key).toBe("instance-1:node-1");
    });
  });

  describe("configureHeartbeatTracker", () => {
    it("should configure the shared heartbeat manager with injected storage", async () => {
      const saveHeartbeat = vi.fn().mockResolvedValue(undefined);
      const shared = configureHeartbeatTracker({
        saveHeartbeat,
      } as any);

      expect(shared).toBe(heartbeatTracker);

      await heartbeatTracker.start({
        instanceId: "shared-instance",
        nodeId: "shared-node",
        interval: 1000,
      });

      expect(saveHeartbeat).toHaveBeenCalled();
      heartbeatTracker.stop("shared-instance", "shared-node");
    });
  });
});
