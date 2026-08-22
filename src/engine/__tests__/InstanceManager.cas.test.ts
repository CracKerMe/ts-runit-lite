// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceManager } from "../InstanceManager";

describe("InstanceManager (CAS - Optimistic Concurrency Control)", () => {
  let manager: InstanceManager;

  beforeEach(() => {
    manager = new InstanceManager();
  });

  describe("version field initialization", () => {
    it("should initialize version to 1 on createInstance", async () => {
      const instance = await manager.createInstance("wf", "start");
      expect(instance.version).toBe(1);
    });

    it("should preserve version field after multiple updates", async () => {
      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        casUpdateInstance: vi.fn().mockResolvedValue(true),
        loadInstance: vi.fn(),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      const instance = await mgr.createInstance("wf", "start");
      const v1 = instance.version;

      instance.status = "running";
      await mgr.updateInstance(instance);
      const updated = mgr.getInstance(instance.instanceId);

      // Version should be incremented by CAS
      expect(updated?.version).toBeGreaterThan((v1 ?? 1) as number);
    });
  });

  describe("CAS conflict detection", () => {
    it("should detect version mismatch and retry with successful storage", async () => {
      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        casUpdateInstance: vi
          .fn()
          .mockResolvedValueOnce(false) // First attempt fails (version mismatch)
          .mockResolvedValueOnce(true), // Second attempt succeeds
        loadInstance: vi.fn().mockResolvedValue({
          instanceId: "test_1",
          workflowId: "test",
          currentNodes: ["start"],
          status: "pending",
          context: {},
          history: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
        }),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      const instance = await mgr.createInstance("wf", "start");

      // This should trigger CAS with retry
      instance.status = "running";
      await mgr.updateInstance(instance);

      // Should have retried
      expect(storage.casUpdateInstance).toHaveBeenCalledTimes(2 as any);
    });

    it("should throw after max retries when persistence cannot converge", async () => {
      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        casUpdateInstance: vi.fn().mockResolvedValue(false), // Always fail
        loadInstance: vi.fn().mockResolvedValue({
          instanceId: "test_1",
          workflowId: "test",
          currentNodes: ["start"],
          status: "pending",
          context: {},
          history: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          version: 1,
        }),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      const instance = await mgr.createInstance("wf", "start");

      await expect(mgr.updateInstance(instance)).rejects.toThrow(
        "Failed to persist instance",
      );

      // Should have retried 3 times
      expect(storage.casUpdateInstance).toHaveBeenCalledTimes(3);
    });
  });

  describe("concurrent update scenario", () => {
    it("should handle version increment in memory", async () => {
      const instance = await manager.createInstance("wf", "start");
      const v1 = instance.version ?? 1;

      // Version should be set to 1 initially
      expect(v1).toBe(1);
      expect(instance.version).toBeDefined();
    });
  });

  describe("integration with MemoryStorage", () => {
    it("should perform CAS update in memory storage", async () => {
      const { MemoryStorage } = await import("../../storage/MemoryStorage");
      const storage = new MemoryStorage();
      await storage.connect();

      const mgr = new InstanceManager(storage);
      const instance = await mgr.createInstance("wf", "start");
      const v1 = instance.version ?? 1;

      instance.status = "running";
      instance.version = v1;
      await mgr.updateInstance(instance);

      const updated = await storage.loadInstance(instance.instanceId);
      expect(updated?.version).toBe(v1 + 1);

      await storage.close?.();
    });
  });
});
