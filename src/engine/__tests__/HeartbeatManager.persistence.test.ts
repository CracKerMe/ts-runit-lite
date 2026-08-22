// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { afterEach, describe, expect, it, vi } from "vitest";
import { HeartbeatManager, type HeartbeatState } from "../HeartbeatManager";

describe("HeartbeatManager - Persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("saveHeartbeat and restoreHeartbeats", () => {
    it("should persist heartbeat state to storage", async () => {
      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue([]),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new HeartbeatManager(mockStorage as any);
      const heartbeatKey = await manager.start({
        instanceId: "wf1",
        nodeId: "node1",
        interval: 5000,
      });

      // Wait for first heartbeat to persist
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockStorage.saveHeartbeat).toHaveBeenCalled();
      const savedState = mockStorage.saveHeartbeat.mock
        .calls[0][0] as HeartbeatState;
      expect(savedState.heartbeatKey).toBe(heartbeatKey);
      expect(savedState.instanceId).toBe("wf1");
      expect(savedState.nodeId).toBe("node1");

      manager.stop("wf1", "node1");
    });

    it("should persist updated deadline on heartbeat ticks", async () => {
      vi.useFakeTimers();
      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue([]),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new HeartbeatManager(mockStorage as any);
      await manager.start({
        instanceId: "wf1",
        nodeId: "node1",
        interval: 1000,
      });

      const initialState = structuredClone(
        mockStorage.saveHeartbeat.mock.calls[0][0] as HeartbeatState,
      );

      await vi.advanceTimersByTimeAsync(1000);

      expect(mockStorage.saveHeartbeat).toHaveBeenCalledTimes(2);
      const tickState = structuredClone(
        mockStorage.saveHeartbeat.mock.calls[1][0] as HeartbeatState,
      );
      expect(tickState.lastBeat).toBeGreaterThanOrEqual(initialState.lastBeat);
      expect(tickState.deadline).toBeGreaterThan(initialState.deadline);

      manager.stop("wf1", "node1");
    });

    it("should restore heartbeats from storage on startup", async () => {
      const now = Date.now();
      const restoredStates: HeartbeatState[] = [
        {
          instanceId: "wf1",
          nodeId: "node1",
          heartbeatKey: "wf1:node1",
          workerId: "worker1",
          lastBeat: now - 1000,
          timeoutMs: 10000,
          deadline: now + 9000,
          createdAt: now - 5000,
        },
      ];

      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue(restoredStates),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new HeartbeatManager(mockStorage as any);
      await manager.restoreHeartbeats();

      // Verify restore was called
      expect(mockStorage.loadAllHeartbeats).toHaveBeenCalled();

      // Verify heartbeat is now active
      expect(manager.isActive("wf1", "node1")).toBe(true);

      manager.stop("wf1", "node1");
    });

    it("should not restore expired heartbeats", async () => {
      const now = Date.now();
      const expiredStates: HeartbeatState[] = [
        {
          instanceId: "wf1",
          nodeId: "node1",
          heartbeatKey: "wf1:node1",
          workerId: "worker1",
          lastBeat: now - 20000,
          timeoutMs: 10000,
          deadline: now - 1000, // Already expired
          createdAt: now - 25000,
        },
      ];

      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue(expiredStates),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new HeartbeatManager(mockStorage as any);
      await manager.restoreHeartbeats();

      // Expired heartbeat should not be active
      expect(manager.isActive("wf1", "node1")).toBe(false);

      // Should attempt to clean up expired heartbeat
      expect(mockStorage.deleteHeartbeat).toHaveBeenCalledWith("wf1", "node1");
    });

    it("should clean up heartbeat on stop", async () => {
      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue([]),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };

      const manager = new HeartbeatManager(mockStorage as any);
      await manager.start({
        instanceId: "wf1",
        nodeId: "node1",
        interval: 5000,
      });

      manager.stop("wf1", "node1");

      // Should clean up from storage
      expect(mockStorage.deleteHeartbeat).toHaveBeenCalledWith("wf1", "node1");
    });

    it("should invoke onTimeout when heartbeat expires", async () => {
      const onTimeout = vi.fn();
      const manager = new HeartbeatManager();

      await manager.start(
        {
          instanceId: "wf-timeout",
          nodeId: "node-timeout",
          interval: 1000,
          onTimeout,
        },
        50,
      );

      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(onTimeout).toHaveBeenCalledTimes(1);
      expect(manager.isActive("wf-timeout", "node-timeout")).toBe(false);
    });
  });
});
