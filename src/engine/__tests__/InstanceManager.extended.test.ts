// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceManager } from "../InstanceManager";

describe("InstanceManager (extended)", () => {
  let manager: InstanceManager;

  beforeEach(() => {
    manager = new InstanceManager();
  });

  // ── getInstancesMap ───────────────────────────────────────────────────────

  describe("getInstancesMap", () => {
    it("should return the internal map", async () => {
      await manager.createInstance("wf", "start");
      const map = manager.getInstancesMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(1);
    });

    it("should reflect mutations made via updateInstance", async () => {
      const instance = await manager.createInstance("wf", "start");
      instance.status = "running";
      await manager.updateInstance(instance);

      const map = manager.getInstancesMap();
      expect(map.get(instance.instanceId)?.status).toBe("running");
    });
  });

  // ── workflowVersion ───────────────────────────────────────────────────────

  describe("workflowVersion", () => {
    it("should store workflowVersion when provided", async () => {
      const instance = await manager.createInstance("wf", "start", {}, "2.0.0");
      expect(instance.workflowVersion).toBe("2.0.0");
    });

    it("should leave workflowVersion undefined when not provided", async () => {
      const instance = await manager.createInstance("wf", "start");
      expect(instance.workflowVersion).toBeUndefined();
    });
  });

  // ── storage integration ───────────────────────────────────────────────────

  describe("storage integration", () => {
    it("should call storage.saveInstance on createInstance", async () => {
      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        loadInstance: vi.fn(),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      await mgr.createInstance("wf", "start");

      expect(storage.saveInstance).toHaveBeenCalledTimes(1);
    });

    it("should call storage.casUpdateInstance on updateInstance", async () => {
      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        casUpdateInstance: vi.fn().mockResolvedValue(true),
        loadInstance: vi.fn(),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      const instance = await mgr.createInstance("wf", "start");

      instance.status = "running";
      await mgr.updateInstance(instance);

      expect(storage.casUpdateInstance).toHaveBeenCalledTimes(1);
    });

    it("should not throw when storage.saveInstance fails", async () => {
      const storage = {
        saveInstance: vi.fn().mockRejectedValue(new Error("storage error")),
        loadInstance: vi.fn(),
        listInstances: vi.fn().mockResolvedValue([]),
      } as any;

      const mgr = new InstanceManager(storage);
      await expect(mgr.createInstance("wf", "start")).resolves.toBeDefined();
    });
  });

  // ── loadFromStorage ───────────────────────────────────────────────────────

  describe("loadFromStorage", () => {
    it("should do nothing when no storage is provided", async () => {
      await expect(manager.loadFromStorage()).resolves.toBeUndefined();
      expect(manager.getInstanceCount()).toBe(0);
    });

    it("should load instances from storage", async () => {
      const storedInstance = {
        instanceId: "wf_5",
        workflowId: "wf",
        currentNodes: ["start"],
        status: "running",
        context: {},
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        retries: {},
      };

      const storage = {
        saveInstance: vi.fn(),
        listInstances: vi.fn().mockResolvedValue(["wf_5"]),
        loadInstance: vi.fn().mockResolvedValue(storedInstance),
      } as any;

      const mgr = new InstanceManager(storage);
      await mgr.loadFromStorage();

      expect(mgr.getInstanceCount()).toBe(1);
      expect(mgr.getInstance("wf_5")).toBeDefined();
    });

    it("should update instanceCounter based on loaded IDs", async () => {
      const storedInstance = {
        instanceId: "wf_10",
        workflowId: "wf",
        currentNodes: [],
        status: "completed",
        context: {},
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        retries: {},
      };

      const storage = {
        saveInstance: vi.fn().mockResolvedValue(undefined),
        listInstances: vi.fn().mockResolvedValue(["wf_10"]),
        loadInstance: vi.fn().mockResolvedValue(storedInstance),
      } as any;

      const mgr = new InstanceManager(storage);
      await mgr.loadFromStorage();

      // Next created instance should have ID > 10
      const newInstance = await mgr.createInstance("wf", "start");
      const idNum = Number.parseInt(newInstance.instanceId.split("_")[2]!, 10);
      expect(idNum).toBeGreaterThan(10);
    });

    it("should not throw when storage.listInstances fails", async () => {
      const storage = {
        listInstances: vi.fn().mockRejectedValue(new Error("storage error")),
        loadInstance: vi.fn(),
        saveInstance: vi.fn(),
      } as any;

      const mgr = new InstanceManager(storage);
      await expect(mgr.loadFromStorage()).resolves.toBeUndefined();
    });
  });
});
