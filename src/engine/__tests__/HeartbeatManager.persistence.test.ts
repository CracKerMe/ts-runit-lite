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

  describe("restore across a process restart", () => {
    /** 全新的 manager：heartbeatOptions 为空，模拟进程重启后的状态。 */
    function freshManager(persisted: HeartbeatState[]) {
      const mockStorage = {
        saveHeartbeat: vi.fn().mockResolvedValue(undefined),
        loadAllHeartbeats: vi.fn().mockResolvedValue(persisted),
        deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
      };
      return {
        manager: new HeartbeatManager(mockStorage as any),
        mockStorage,
      };
    }

    function persistedState(
      overrides: Partial<HeartbeatState> = {},
    ): HeartbeatState {
      const now = Date.now();
      return {
        instanceId: "wf-restored",
        nodeId: "node-restored",
        heartbeatKey: "wf-restored:node-restored",
        lastBeat: now,
        timeoutMs: 30_000,
        deadline: now + 5000,
        createdAt: now,
        ...overrides,
      };
    }

    it("should fire the default onTimeout for a heartbeat restored after restart", async () => {
      // 回归守卫：heartbeatOptions 从不持久化，重启后恢复出的心跳没有
      // onTimeout，超时定时器触发后什么也不做——卡住的节点永远不被判失败。
      vi.useFakeTimers();
      const { manager } = freshManager([persistedState()]);

      const defaultOnTimeout = vi.fn();
      manager.setDefaultOnTimeout(defaultOnTimeout);

      await manager.restoreHeartbeats();

      // deadline 在 5s 后：4s 时不应触发
      await vi.advanceTimersByTimeAsync(4000);
      expect(defaultOnTimeout).not.toHaveBeenCalled();

      // 越过 deadline 后必须触发
      await vi.advanceTimersByTimeAsync(2000);
      expect(defaultOnTimeout).toHaveBeenCalledTimes(1);
      expect(defaultOnTimeout).toHaveBeenCalledWith(
        "wf-restored",
        "node-restored",
      );

      manager.stopAll();
    });

    it("should honour the persisted deadline instead of restarting the window", async () => {
      // 回归守卫：start() 用 Date.now() + timeoutMs 重算 deadline，
      // 把一个 30s 窗口里已过 29s 的心跳重置成完整 30s。
      vi.useFakeTimers();
      const { manager } = freshManager([
        persistedState({ timeoutMs: 30_000, deadline: Date.now() + 1000 }),
      ]);

      const defaultOnTimeout = vi.fn();
      manager.setDefaultOnTimeout(defaultOnTimeout);
      await manager.restoreHeartbeats();

      // 剩余 1s —— 2s 后必须已经触发，而不是等满 30s
      await vi.advanceTimersByTimeAsync(2000);
      expect(defaultOnTimeout).toHaveBeenCalledTimes(1);

      manager.stopAll();
    });

    it("should prefer an explicitly registered onTimeout over the default", async () => {
      vi.useFakeTimers();
      const { manager } = freshManager([persistedState()]);

      const explicit = vi.fn();
      const fallback = vi.fn();
      manager.setDefaultOnTimeout(fallback);

      // 同进程内已注册过回调（heartbeatOptions 中有记录），
      // 恢复时必须沿用它而不是替换成兜底处理器。
      await manager.start(
        {
          instanceId: "wf-restored",
          nodeId: "node-restored",
          interval: 10_000,
          onTimeout: explicit,
        },
        30_000,
      );
      await manager.restoreHeartbeats();

      const restoredOptions = (manager as any).heartbeatOptions.get(
        "wf-restored:node-restored",
      );
      expect(restoredOptions.onTimeout).toBe(explicit);
      expect(fallback).not.toHaveBeenCalled();

      manager.stopAll();
    });

    it("should clear heartbeatOptions on stopAll", async () => {
      const { manager } = freshManager([]);

      await manager.start({
        instanceId: "wf-leak",
        nodeId: "node-leak",
        interval: 5000,
      });

      manager.stopAll();

      expect((manager as any).heartbeatOptions.size).toBe(0);
    });
  });
});
