// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LifecycleManager } from "../LifecycleManager";

describe("LifecycleManager - Event Cleanup", () => {
  let manager: LifecycleManager;
  let mockStorage: any;
  let instances: Map<string, WorkflowInstance>;

  beforeEach(() => {
    mockStorage = {
      cleanupStaleEvents: vi.fn().mockResolvedValue(0),
      cleanupExpiredHeartbeats: vi.fn().mockResolvedValue(0),
    };

    manager = new LifecycleManager(mockStorage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: 60000,
      eventRetentionDays: 90,
    });

    instances = new Map();
  });

  it("should cleanup stale instances and call storage cleanup", async () => {
    const now = Date.now();

    // Create an old completed instance
    const oldInstance: WorkflowInstance = {
      instanceId: "old-1",
      workflowId: "wf1",
      currentNodes: ["start"],
      status: "completed",
      context: {},
      history: [],
      createdAt: new Date(now - 48 * 60 * 60 * 1000), // 48 hours old
      updatedAt: new Date(now - 48 * 60 * 60 * 1000),
      version: 1,
    };

    // Create a recent completed instance
    const recentInstance: WorkflowInstance = {
      instanceId: "recent-1",
      workflowId: "wf1",
      currentNodes: ["start"],
      status: "completed",
      context: {},
      history: [],
      createdAt: new Date(now - 1 * 60 * 60 * 1000), // 1 hour old
      updatedAt: new Date(now - 1 * 60 * 60 * 1000),
      version: 1,
    };

    instances.set("old-1", oldInstance);
    instances.set("recent-1", recentInstance);

    const cleaned = manager.cleanupStaleInstances(instances);

    // Old instance should be cleaned up
    expect(cleaned).toBe(1);
    expect(instances.has("old-1")).toBe(false);
    expect(instances.has("recent-1")).toBe(true);
  });

  it("should call storage cleanup on interval", async () => {
    vi.useFakeTimers();
    const shortManager = new LifecycleManager(mockStorage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: 100,
      eventRetentionDays: 90,
    });

    try {
      shortManager.start(() => instances);
      await vi.advanceTimersByTimeAsync(100);
      expect(mockStorage.cleanupExpiredHeartbeats).toHaveBeenCalledTimes(1);
    } finally {
      shortManager.destroy();
      vi.useRealTimers();
    }
  });

  it("should cleanup stale events with retention period", async () => {
    vi.useFakeTimers();
    const sixHoursMs = 6 * 60 * 60 * 1000;
    const eventCleanupManager = new LifecycleManager(mockStorage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: sixHoursMs + 1,
      eventRetentionDays: 30,
    });

    try {
      eventCleanupManager.start(() => instances);
      await vi.advanceTimersByTimeAsync(sixHoursMs + 1);
      expect(mockStorage.cleanupStaleEvents).toHaveBeenCalledTimes(1);
      expect(mockStorage.cleanupStaleEvents).toHaveBeenCalledWith(30);
    } finally {
      eventCleanupManager.destroy();
      vi.useRealTimers();
    }
  });

  it("should not cleanup running instances", async () => {
    const now = Date.now();

    const runningInstance: WorkflowInstance = {
      instanceId: "running-1",
      workflowId: "wf1",
      currentNodes: ["node1"],
      status: "running",
      context: {},
      history: [],
      createdAt: new Date(now - 48 * 60 * 60 * 1000),
      updatedAt: new Date(now - 48 * 60 * 60 * 1000),
      version: 1,
    };

    instances.set("running-1", runningInstance);

    const cleaned = manager.cleanupStaleInstances(instances);

    // Running instance should NOT be cleaned up
    expect(cleaned).toBe(0);
    expect(instances.has("running-1")).toBe(true);
  });

  it("should handle cleanup errors gracefully", async () => {
    vi.useFakeTimers();
    mockStorage.cleanupExpiredHeartbeats = vi
      .fn()
      .mockRejectedValue(new Error("Storage error"));

    const shortManager = new LifecycleManager(mockStorage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: 100,
      eventRetentionDays: 90,
    });

    try {
      shortManager.start(() => instances);
      await vi.advanceTimersByTimeAsync(200);
      expect(mockStorage.cleanupExpiredHeartbeats).toHaveBeenCalledTimes(2);
    } finally {
      shortManager.destroy();
      vi.useRealTimers();
    }
  });
});
