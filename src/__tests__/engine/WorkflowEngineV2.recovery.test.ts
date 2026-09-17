import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { HeartbeatTracker } from "../../engine/HeartbeatTracker";
import { InstanceManager } from "../../engine/InstanceManager";
import { LifecycleManager } from "../../engine/LifecycleManager";

describe("WorkflowEngine - Crash Recovery", () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
  });

  it("should recover instance state after simulated process crash", async () => {
    // Phase 1: Normal operation
    const manager1 = new InstanceManager(storage);
    const instance = await manager1.createInstance("order-wf", "start");
    instance.status = "running";
    instance.currentNodes = ["process-order"];
    await manager1.updateInstance(instance);

    // Phase 2: Simulate crash (discard manager1, create new one)
    const manager2 = new InstanceManager(storage);
    await manager2.loadFromStorage();

    // Phase 3: Verify recovery
    const recovered = manager2.getInstance(instance.instanceId);
    expect(recovered).toBeDefined();
    expect(recovered?.status).toBe("running");
    expect(recovered?.currentNodes).toContain("process-order");
    expect(recovered?.version).toBeGreaterThanOrEqual(1);
  });

  it("should restore heartbeats across process restart", async () => {
    const workerId = "worker-1";

    // Phase 1: Start heartbeat
    const hbManager1 = new HeartbeatTracker(storage, workerId);
    const hbKey = await hbManager1.start({
      instanceId: "instance-1",
      nodeId: "node-1",
      interval: 5000,
    });
    expect(hbKey).toBe("instance-1:node-1");

    // Wait for heartbeat to persist
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Phase 2: Simulate crash and restart
    const hbManager2 = new HeartbeatTracker(storage, workerId);
    await hbManager2.restoreHeartbeats();

    // Phase 3: Verify heartbeat is restored
    expect(hbManager2.isActive("instance-1", "node-1")).toBe(true);

    // Cleanup
    hbManager2.stop("instance-1", "node-1");
  });

  it("should not restore expired heartbeats from previous crash", async () => {
    const now = Date.now();

    // Phase 1: Save expired heartbeat (simulating old process that crashed)
    const expiredState = {
      instanceId: "old-instance",
      nodeId: "old-node",
      heartbeatKey: "old-instance:old-node",
      workerId: "old-worker",
      lastBeat: now - 60000, // 60 seconds ago
      timeoutMs: 30000, // 30 second timeout
      deadline: now - 30000, // Already expired
      createdAt: now - 60000,
    };

    await storage.saveHeartbeat(expiredState);

    // Phase 2: Startup heartbeat manager on new process
    const hbManager = new HeartbeatTracker(storage, "new-worker");
    await hbManager.restoreHeartbeats();

    // Phase 3: Expired heartbeat should NOT be active
    expect(hbManager.isActive("old-instance", "old-node")).toBe(false);

    // Verify cleanup was attempted
    const allHbs = await storage.loadAllHeartbeats?.();
    expect(allHbs).toBeDefined();
  });

  it("should cleanup stale instances after restart", async () => {
    const now = Date.now();

    // Phase 1: Save completed instance from before crash
    const completedInstance = {
      instanceId: "completed-1",
      workflowId: "wf1",
      currentNodes: ["end"],
      status: "completed" as const,
      context: {},
      history: [],
      createdAt: new Date(now - 50 * 60 * 60 * 1000), // 50 hours old
      updatedAt: new Date(now - 50 * 60 * 60 * 1000),
      version: 1,
    };

    const recentInstance = {
      instanceId: "recent-1",
      workflowId: "wf1",
      currentNodes: ["end"],
      status: "completed" as const,
      context: {},
      history: [],
      createdAt: new Date(now - 1 * 60 * 60 * 1000), // 1 hour old
      updatedAt: new Date(now - 1 * 60 * 60 * 1000),
      version: 1,
    };

    await storage.saveInstance(completedInstance);
    await storage.saveInstance(recentInstance);

    // Phase 2: Startup lifecycle manager
    const instances = new Map([
      ["completed-1", completedInstance],
      ["recent-1", recentInstance],
    ]);

    const lifecycleManager = new LifecycleManager(storage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: 100000, // Don't auto-run
      eventRetentionDays: 90,
    });

    // Phase 3: Manually trigger cleanup
    const cleaned = lifecycleManager.cleanupStaleInstances(instances);

    // Old completed instance should be cleaned
    expect(cleaned).toBe(1);
    expect(instances.has("completed-1")).toBe(false);
    expect(instances.has("recent-1")).toBe(true);
  });

  it("should perform full recovery sequence on startup", async () => {
    // Phase 1: Setup - save state before "crash"
    const manager1 = new InstanceManager(storage);
    const instance = await manager1.createInstance("recovery-wf", "start");
    instance.status = "running";
    await manager1.updateInstance(instance);

    const hbManager1 = new HeartbeatTracker(storage, "worker-1");
    await hbManager1.start({
      instanceId: instance.instanceId,
      nodeId: "node-1",
      interval: 5000,
    });

    // Wait for persistence
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Phase 2: Simulate process crash and restart
    const manager2 = new InstanceManager(storage);
    await manager2.loadFromStorage();

    const hbManager2 = new HeartbeatTracker(storage, "worker-1");
    await hbManager2.restoreHeartbeats();

    void new LifecycleManager(storage, {
      instanceTtlHours: 24,
      cleanupIntervalMs: 100000,
      eventRetentionDays: 90,
    });

    // Phase 3: Verify complete recovery
    const recoveredInstance = manager2.getInstance(instance.instanceId);
    expect(recoveredInstance).toBeDefined();
    expect(recoveredInstance?.status).toBe("running");

    const heartbeatActive = hbManager2.isActive(instance.instanceId, "node-1");
    expect(heartbeatActive).toBe(true);

    // Cleanup
    hbManager2.stop(instance.instanceId, "node-1");
    await storage.close?.();
  });

  it("should handle partial persistence state after crash", async () => {
    // Scenario: Instance saved but heartbeat not yet persisted
    const instance = {
      instanceId: "partial-1",
      workflowId: "wf1",
      currentNodes: ["node-1"],
      status: "running" as const,
      context: {},
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
    };

    // Only save instance, not heartbeat
    await storage.saveInstance(instance);

    // Restart without heartbeat in storage
    const manager = new InstanceManager(storage);
    await manager.loadFromStorage();

    const recovered = manager.getInstance("partial-1");
    expect(recovered).toBeDefined();
    expect(recovered?.status).toBe("running");

    const hbManager = new HeartbeatTracker(storage, "worker-1");
    await hbManager.restoreHeartbeats();

    // Heartbeat was not saved, so won't be active
    expect(hbManager.isActive("partial-1", "node-1")).toBe(false);
  });
});
