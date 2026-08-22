import { describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { LifecycleManager } from "../LifecycleManager";

describe("LifecycleManager", () => {
  describe("cleanupStaleInstances", () => {
    it("should clean up completed instances older than TTL", () => {
      const manager = new LifecycleManager(undefined, {
        instanceTtlHours: 1,
        cleanupIntervalMs: 3600000,
      });

      const instances = new Map<string, WorkflowInstance>();
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

      instances.set("old-completed", {
        instanceId: "old-completed",
        workflowId: "test",
        currentNodes: [],
        status: "completed",
        context: {},
        history: [],
        createdAt: oldDate,
        updatedAt: oldDate,
        retries: {},
      });

      instances.set("recent-completed", {
        instanceId: "recent-completed",
        workflowId: "test",
        currentNodes: [],
        status: "completed",
        context: {},
        history: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        retries: {},
      });

      const cleaned = manager.cleanupStaleInstances(instances);

      expect(cleaned).toBe(1);
      expect(instances.has("old-completed")).toBe(false);
      expect(instances.has("recent-completed")).toBe(true);
    });

    it("should not clean up running instances", () => {
      const manager = new LifecycleManager(undefined, {
        instanceTtlHours: 1,
        cleanupIntervalMs: 3600000,
      });

      const instances = new Map<string, WorkflowInstance>();
      const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);

      instances.set("old-running", {
        instanceId: "old-running",
        workflowId: "test",
        currentNodes: ["node1"],
        status: "running",
        context: {},
        history: [],
        createdAt: oldDate,
        updatedAt: oldDate,
        retries: {},
      });

      const cleaned = manager.cleanupStaleInstances(instances);

      expect(cleaned).toBe(0);
      expect(instances.has("old-running")).toBe(true);
    });

    it("should clean up completed instances with ISO string updatedAt", () => {
      const manager = new LifecycleManager(undefined, {
        instanceTtlHours: 1,
        cleanupIntervalMs: 3600000,
      });

      const instances = new Map<string, WorkflowInstance>();
      const oldIsoDate = new Date(
        Date.now() - 2 * 60 * 60 * 1000,
      ).toISOString();

      instances.set("old-completed-string-date", {
        instanceId: "old-completed-string-date",
        workflowId: "test",
        currentNodes: [],
        status: "completed",
        context: {},
        history: [],
        createdAt: oldIsoDate as unknown as Date,
        updatedAt: oldIsoDate as unknown as Date,
        retries: {},
      });

      const cleaned = manager.cleanupStaleInstances(instances);

      expect(cleaned).toBe(1);
      expect(instances.has("old-completed-string-date")).toBe(false);
    });

    it("should handle invalid updatedAt without throwing", () => {
      const manager = new LifecycleManager(undefined, {
        instanceTtlHours: 1,
        cleanupIntervalMs: 3600000,
      });

      const instances = new Map<string, WorkflowInstance>();

      instances.set("completed-invalid-date", {
        instanceId: "completed-invalid-date",
        workflowId: "test",
        currentNodes: [],
        status: "completed",
        context: {},
        history: [],
        createdAt: new Date(),
        updatedAt: "invalid-date-value" as unknown as Date,
        retries: {},
      });

      expect(() => manager.cleanupStaleInstances(instances)).not.toThrow();
      expect(instances.has("completed-invalid-date")).toBe(false);
    });
  });

  describe("lifecycle", () => {
    it("should start and stop cleanup interval", () => {
      vi.useFakeTimers();

      const manager = new LifecycleManager(undefined, {
        instanceTtlHours: 1,
        cleanupIntervalMs: 1000,
      });

      const instances = new Map<string, WorkflowInstance>();
      const getInstances = vi.fn(() => instances);

      manager.start(getInstances);

      // Fast-forward time
      vi.advanceTimersByTime(1000);

      expect(getInstances).toHaveBeenCalled();

      manager.destroy();
      vi.useRealTimers();
    });
  });
});
