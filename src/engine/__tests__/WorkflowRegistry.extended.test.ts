import { describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { WorkflowRegistry } from "../WorkflowRegistry";

function makeWorkflow(id: string, version?: string): WorkflowDefinition {
  return {
    id,
    name: id,
    startNode: "start",
    nodes: {},
    version,
  } as WorkflowDefinition;
}

describe("WorkflowRegistry (extended)", () => {
  // ── listVersions ──────────────────────────────────────────────────────────

  describe("listVersions", () => {
    it("should return empty array for unknown workflow", () => {
      const registry = new WorkflowRegistry();
      expect(registry.listVersions("no-such")).toEqual([]);
    });

    it("should list all registered versions", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf", "1"), start, { version: "1" });
      await registry.register(makeWorkflow("wf", "2"), start, { version: "2" });
      expect(registry.listVersions("wf")).toContain("1");
      expect(registry.listVersions("wf")).toContain("2");
    });
  });

  // ── setActiveVersion / getActiveVersion ───────────────────────────────────

  describe("setActiveVersion / getActiveVersion", () => {
    it("should set and get the active version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });

      registry.setActiveVersion("wf", "1");
      expect(registry.getActiveVersion("wf")).toBe("1");
    });

    it("should not set active version for non-existent version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });

      registry.setActiveVersion("wf", "99");
      // Should remain at "1" (the original active)
      expect(registry.getActiveVersion("wf")).toBe("1");
    });

    it("should return undefined for unknown workflow", () => {
      const registry = new WorkflowRegistry();
      expect(registry.getActiveVersion("no-such")).toBeUndefined();
    });
  });

  // ── setLockedVersion / getLockedVersion / clearLockedVersion ──────────────

  describe("locked version", () => {
    it("should lock to a specific version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, {
        version: "2",
        setActive: true,
      });

      registry.setLockedVersion("wf", "1");
      expect(registry.getLockedVersion("wf")).toBe("1");

      // resolveVersion should return locked version
      expect(registry.resolveVersion("wf")).toBe("1");
    });

    it("should not lock to a non-existent version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });

      registry.setLockedVersion("wf", "99");
      expect(registry.getLockedVersion("wf")).toBeUndefined();
    });

    it("should clear locked version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, {
        version: "2",
        setActive: true,
      });

      registry.setLockedVersion("wf", "1");
      registry.clearLockedVersion("wf");

      expect(registry.getLockedVersion("wf")).toBeUndefined();
      // After clearing lock, active version should be used
      expect(registry.resolveVersion("wf")).toBe("2");
    });
  });

  // ── resolveVersion ────────────────────────────────────────────────────────

  describe("resolveVersion", () => {
    it("should return undefined for unknown workflow", () => {
      const registry = new WorkflowRegistry();
      expect(registry.resolveVersion("no-such")).toBeUndefined();
    });

    it("should return requested version when it exists", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });

      expect(registry.resolveVersion("wf", "1")).toBe("1");
    });

    it("should fall back to active version for non-existent requested version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });

      // resolveVersion falls back to active when requested version doesn't exist
      expect(registry.resolveVersion("wf", "99")).toBe("1");
    });

    it("should fall back to active version when no request", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });
      registry.setActiveVersion("wf", "1");

      expect(registry.resolveVersion("wf")).toBe("1");
    });
  });

  // ── setReleasePolicy / getReleasePolicy (canary) ──────────────────────────

  describe("release policy", () => {
    it("should set and get a stable release policy", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });

      registry.setReleasePolicy("wf", { type: "stable" });
      expect(registry.getReleasePolicy("wf")).toEqual({ type: "stable" });
    });

    it("should set and get a canary release policy", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });

      const policy = {
        type: "canary" as const,
        baselineVersion: "1",
        canaryVersion: "2",
        canaryPercent: 100,
      };
      registry.setReleasePolicy("wf", policy);
      expect(registry.getReleasePolicy("wf")).toEqual(policy);
    });

    it("should route 100% canary traffic to canary version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });

      registry.setReleasePolicy("wf", {
        type: "canary",
        baselineVersion: "1",
        canaryVersion: "2",
        canaryPercent: 100,
      });

      // With 100% canary, should always resolve to canary version
      expect(registry.resolveVersion("wf")).toBe("2");
    });

    it("should route 0% canary traffic to baseline version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, { version: "2" });

      registry.setReleasePolicy("wf", {
        type: "canary",
        baselineVersion: "1",
        canaryVersion: "2",
        canaryPercent: 0,
      });

      // With 0% canary, should always resolve to baseline
      expect(registry.resolveVersion("wf")).toBe("1");
    });

    it("should return undefined for unknown workflow policy", () => {
      const registry = new WorkflowRegistry();
      expect(registry.getReleasePolicy("no-such")).toBeUndefined();
    });
  });

  // ── getWorkflow with version ──────────────────────────────────────────────

  describe("getWorkflow with version", () => {
    it("should return specific version when requested", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      const wf1 = makeWorkflow("wf", "1");
      const wf2 = makeWorkflow("wf", "2");
      await registry.register(wf1, start, { version: "1" });
      await registry.register(wf2, start, { version: "2" });

      expect(registry.getWorkflow("wf", "1")).toBe(wf1);
      expect(registry.getWorkflow("wf", "2")).toBe(wf2);
    });

    it("should fall back to active version for non-existent version", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      const wf1 = makeWorkflow("wf", "1");
      await registry.register(wf1, start, { version: "1" });

      // getWorkflow falls back to active version when requested version doesn't exist
      expect(registry.getWorkflow("wf", "99")).toBe(wf1);
    });
  });

  // ── setActive option on register ─────────────────────────────────────────

  describe("register with setActive option", () => {
    it("should override active version when setActive is true", async () => {
      const registry = new WorkflowRegistry();
      const start = vi.fn();
      await registry.register(makeWorkflow("wf"), start, { version: "1" });
      await registry.register(makeWorkflow("wf"), start, {
        version: "2",
        setActive: true,
      });

      expect(registry.getActiveVersion("wf")).toBe("2");
    });
  });
});
