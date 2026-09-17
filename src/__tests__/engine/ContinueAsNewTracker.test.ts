import { beforeEach, describe, expect, it } from "vitest";
import { ContinueAsNewTracker } from "../../engine/ContinueAsNewTracker";

describe("ContinueAsNewTracker", () => {
  let manager: ContinueAsNewTracker;

  beforeEach(() => {
    manager = new ContinueAsNewTracker();
  });

  describe("prepareContinueAsNew", () => {
    it("should return a result with the original instanceId", () => {
      const result = manager.prepareContinueAsNew("inst-1", {});
      expect(result.previousInstanceId).toBe("inst-1");
    });

    it("should generate a new instance ID containing the original ID when no workflowId given", () => {
      const result = manager.prepareContinueAsNew("inst-1", {});
      expect(result.newInstanceId).toContain("inst-1-continued-");
    });

    it("should use workflowId in the new instance ID when provided", () => {
      const result = manager.prepareContinueAsNew("inst-1", {
        workflowId: "my-workflow",
      });
      expect(result.newInstanceId).toMatch(/^my-workflow-\d+$/);
    });

    it("should mark the instance as having a pending continuation", () => {
      manager.prepareContinueAsNew("inst-1", { input: { foo: "bar" } });
      expect(manager.hasPendingContinuation("inst-1")).toBe(true);
    });
  });

  describe("hasPendingContinuation", () => {
    it("should return false for unknown instance", () => {
      expect(manager.hasPendingContinuation("unknown")).toBe(false);
    });

    it("should return true after preparing", () => {
      manager.prepareContinueAsNew("inst-2", {});
      expect(manager.hasPendingContinuation("inst-2")).toBe(true);
    });
  });

  describe("getContinuation", () => {
    it("should return undefined for unknown instance", () => {
      expect(manager.getContinuation("unknown")).toBeUndefined();
    });

    it("should return the stored options", () => {
      const opts = { workflowId: "wf-x", input: { key: "value" } };
      manager.prepareContinueAsNew("inst-3", opts);
      const stored = manager.getContinuation("inst-3");
      expect(stored).toMatchObject(opts);
    });
  });

  describe("clearContinuation", () => {
    it("should remove a pending continuation", () => {
      manager.prepareContinueAsNew("inst-4", {});
      manager.clearContinuation("inst-4");
      expect(manager.hasPendingContinuation("inst-4")).toBe(false);
    });

    it("should be a no-op for unknown instance", () => {
      expect(() => manager.clearContinuation("no-such")).not.toThrow();
    });
  });

  describe("isActive", () => {
    it("should return true only when a continuation is pending", () => {
      expect(manager.isActive("inst-x")).toBe(false);
      manager.prepareContinueAsNew("inst-x", {});
      expect(manager.isActive("inst-x")).toBe(true);
      manager.clearContinuation("inst-x");
      expect(manager.isActive("inst-x")).toBe(false);
    });
  });
});
