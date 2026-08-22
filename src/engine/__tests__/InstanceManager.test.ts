import { describe, expect, it } from "vitest";
import { InstanceManager } from "../InstanceManager";

describe("InstanceManager", () => {
  describe("createInstance", () => {
    it("should create a new instance with unique ID", async () => {
      const manager = new InstanceManager();

      const instance1 = await manager.createInstance("workflow1", "start", {
        data: "test",
      });
      const instance2 = await manager.createInstance("workflow1", "start", {});

      expect(instance1.instanceId).toMatch(/^workflow1_[a-z0-9]+_0_[a-z0-9]+$/);
      expect(instance2.instanceId).toMatch(/^workflow1_[a-z0-9]+_1_[a-z0-9]+$/);
      expect(instance1.workflowId).toBe("workflow1");
      expect(instance1.status).toBe("pending");
      expect(instance1.context).toEqual({ data: "test" });
    });

    it("should initialize instance with correct defaults", async () => {
      const manager = new InstanceManager();

      const instance = await manager.createInstance("test-wf", "start");

      expect(instance.currentNodes).toEqual(["start"]);
      expect(instance.history).toEqual([]);
      expect(instance.retries).toEqual({});
      expect(instance.createdAt).toBeInstanceOf(Date);
      expect(instance.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("getInstance", () => {
    it("should retrieve instance by ID", async () => {
      const manager = new InstanceManager();

      const created = await manager.createInstance("workflow1", "start");
      const retrieved = manager.getInstance(created.instanceId);

      expect(retrieved).toBe(created);
    });

    it("should return undefined for non-existent instance", () => {
      const manager = new InstanceManager();

      const retrieved = manager.getInstance("non-existent");

      expect(retrieved).toBeUndefined();
    });
  });

  describe("updateInstance", () => {
    it("should update instance and timestamp", async () => {
      const manager = new InstanceManager();

      const instance = await manager.createInstance("workflow1", "start");
      const originalUpdatedAt = instance.updatedAt;

      // Wait a bit to ensure timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      instance.status = "running";
      await manager.updateInstance(instance);

      const retrieved = manager.getInstance(instance.instanceId);
      expect(retrieved?.status).toBe("running");
      expect(retrieved?.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    });
  });

  describe("listInstances", () => {
    it("should list all instance IDs", async () => {
      const manager = new InstanceManager();

      await manager.createInstance("workflow1", "start");
      await manager.createInstance("workflow2", "start");

      const ids = manager.listInstances();

      expect(ids).toHaveLength(2);
      expect(ids.some((id) => id.startsWith("workflow1_"))).toBe(true);
      expect(ids.some((id) => id.startsWith("workflow2_"))).toBe(true);
    });
  });

  describe("getInstanceCount", () => {
    it("should return correct instance count", async () => {
      const manager = new InstanceManager();

      expect(manager.getInstanceCount()).toBe(0);

      await manager.createInstance("workflow1", "start");
      expect(manager.getInstanceCount()).toBe(1);

      await manager.createInstance("workflow2", "start");
      expect(manager.getInstanceCount()).toBe(2);
    });
  });
});
