// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../../storage/MemoryStorage";

function makeInstance(id: string, workflowId = "wf-1"): WorkflowInstance {
  return {
    instanceId: id,
    workflowId,
    currentNodes: ["node-1"],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    retries: {},
    state: { nodes: {} },
  };
}

describe("MemoryStorage", () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
  });

  // ── Instance CRUD ─────────────────────────────────────────────────────────

  describe("saveInstance / loadInstance", () => {
    it("should save and load an instance", async () => {
      const inst = makeInstance("inst-1");
      await storage.saveInstance(inst);
      const loaded = await storage.loadInstance("inst-1");
      expect(loaded).toBeDefined();
      expect(loaded!.instanceId).toBe("inst-1");
    });

    it("should return null for a non-existent instance", async () => {
      const loaded = await storage.loadInstance("ghost");
      expect(loaded).toBeNull();
    });

    it("should deep-clone on save so mutations don't affect stored data", async () => {
      const inst = makeInstance("inst-2");
      await storage.saveInstance(inst);
      inst.status = "completed"; // mutate original
      const loaded = await storage.loadInstance("inst-2");
      expect(loaded!.status).toBe("running");
    });
  });

  describe("listInstances", () => {
    it("should list all saved instance IDs", async () => {
      await storage.saveInstance(makeInstance("a"));
      await storage.saveInstance(makeInstance("b"));
      const ids = await storage.listInstances();
      expect(ids).toContain("a");
      expect(ids).toContain("b");
    });
  });

  describe("deleteInstance", () => {
    it("should remove an instance", async () => {
      await storage.saveInstance(makeInstance("del-1"));
      await storage.deleteInstance("del-1");
      expect(await storage.loadInstance("del-1")).toBeNull();
    });
  });

  // ── queryInstances ─────────────────────────────────────────────────────────

  describe("queryInstances", () => {
    beforeEach(async () => {
      const running = {
        ...makeInstance("q-1", "wf-A"),
        status: "running" as const,
      };
      const completed = {
        ...makeInstance("q-2", "wf-A"),
        status: "completed" as const,
      };
      const failed = {
        ...makeInstance("q-3", "wf-B"),
        status: "failed" as const,
      };
      await storage.saveInstance(running);
      await storage.saveInstance(completed);
      await storage.saveInstance(failed);
    });

    it("should filter by workflowId", async () => {
      const { instances } = await storage.queryInstances({
        workflowId: "wf-A",
      });
      expect(instances).toHaveLength(2);
      expect(instances.every((i) => i.workflowId === "wf-A")).toBe(true);
    });

    it("should filter by status", async () => {
      const { instances } = await storage.queryInstances({ status: "failed" });
      expect(instances).toHaveLength(1);
      expect(instances[0].instanceId).toBe("q-3");
    });

    it("should return total count before pagination", async () => {
      const { total } = await storage.queryInstances({ workflowId: "wf-A" });
      expect(total).toBe(2);
    });

    it("should paginate results", async () => {
      const { instances, total } = await storage.queryInstances({
        pageSize: 2,
        page: 1,
      });
      expect(instances).toHaveLength(2);
      expect(total).toBe(3);
    });

    it("should filter by startTime / endTime", async () => {
      const start = Date.now() - 5000;
      const end = Date.now() + 5000;
      const { instances } = await storage.queryInstances({
        startTime: start,
        endTime: end,
      });
      expect(instances.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── cleanupStaleInstances ─────────────────────────────────────────────────

  describe("cleanupStaleInstances", () => {
    it("should remove completed instances older than maxAgeMs", async () => {
      const old = {
        ...makeInstance("old-1"),
        status: "completed" as const,
        updatedAt: new Date(Date.now() - 100000),
      };
      await storage.saveInstance(old);
      const count = storage.cleanupStaleInstances(50000);
      expect(count).toBe(1);
      expect(await storage.loadInstance("old-1")).toBeNull();
    });

    it("should not remove running instances even if old", async () => {
      const running = {
        ...makeInstance("run-1"),
        updatedAt: new Date(Date.now() - 100000),
      };
      await storage.saveInstance(running);
      const count = storage.cleanupStaleInstances(50000);
      expect(count).toBe(0);
      expect(await storage.loadInstance("run-1")).not.toBeNull();
    });

    it("should not remove recently completed instances", async () => {
      const fresh = {
        ...makeInstance("fresh-1"),
        status: "completed" as const,
        updatedAt: new Date(),
      };
      await storage.saveInstance(fresh);
      const count = storage.cleanupStaleInstances(60000);
      expect(count).toBe(0);
    });
  });

  // ── getStats ───────────────────────────────────────────────────────────────

  describe("getStats", () => {
    it("should return instance and workflow counts", async () => {
      await storage.saveInstance(makeInstance("s-1"));
      await storage.saveWorkflow({
        id: "wf-stats",
        name: "test",
        startNode: "n1",
        nodes: {},
      });
      const stats = storage.getStats();
      expect(stats.instanceCount).toBeGreaterThanOrEqual(1);
      expect(stats.workflowCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── updateNodeMetrics workflowId fix ──────────────────────────────────────

  describe("updateNodeMetrics", () => {
    it("should inherit workflowId from stored instance", async () => {
      const inst = makeInstance("metrics-inst", "wf-metrics");
      await storage.saveInstance(inst);
      await storage.updateNodeMetrics("metrics-inst", "node-1", {
        nodeId: "node-1",
        nodeType: "action",
        startTime: Date.now(),
        status: "completed",
        retryCount: 0,
      });
      const metrics = await storage.loadInstanceMetrics("metrics-inst");
      expect(metrics?.workflowId).toBe("wf-metrics");
    });

    it("should accumulate metrics for multiple nodes", async () => {
      const inst = makeInstance("multi-metrics", "wf-multi");
      await storage.saveInstance(inst);
      await storage.updateNodeMetrics("multi-metrics", "node-a", {
        nodeId: "node-a",
        nodeType: "action",
        startTime: Date.now(),
        status: "completed",
        retryCount: 0,
      });
      await storage.updateNodeMetrics("multi-metrics", "node-b", {
        nodeId: "node-b",
        nodeType: "http",
        startTime: Date.now(),
        status: "failed",
        retryCount: 2,
      });
      const metrics = await storage.loadInstanceMetrics("multi-metrics");
      expect(Object.keys(metrics!.nodeMetrics)).toHaveLength(2);
      expect(metrics!.nodeMetrics["node-b"].retryCount).toBe(2);
    });
  });

  // ── Event waiting state ────────────────────────────────────────────────────

  describe("event waiting state", () => {
    it("should save and load event waiting state", async () => {
      await storage.saveEventWaitingState({
        instanceId: "inst-ev",
        nodeId: "ev-node",
        eventType: "order.placed",
        createdAt: Date.now(),
      });
      const state = await storage.loadEventWaitingState("inst-ev", "ev-node");
      expect(state).not.toBeNull();
      expect(state!.eventType).toBe("order.placed");
    });

    it("should return null for missing event waiting state", async () => {
      const state = await storage.loadEventWaitingState("nope", "nope");
      expect(state).toBeNull();
    });

    it("should load all event waiting states", async () => {
      await storage.saveEventWaitingState({
        instanceId: "inst-1",
        nodeId: "n1",
        eventType: "e1",
        createdAt: Date.now(),
      });
      await storage.saveEventWaitingState({
        instanceId: "inst-2",
        nodeId: "n2",
        eventType: "e2",
        createdAt: Date.now(),
      });
      const all = await storage.loadAllEventWaitingStates();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it("should delete event waiting state", async () => {
      await storage.saveEventWaitingState({
        instanceId: "del-ev",
        nodeId: "del-node",
        eventType: "e",
        createdAt: Date.now(),
      });
      await storage.deleteEventWaitingState("del-ev", "del-node");
      const state = await storage.loadEventWaitingState("del-ev", "del-node");
      expect(state).toBeNull();
    });
  });

  // ── Event history ──────────────────────────────────────────────────────────

  describe("event history", () => {
    it("should save, load, and query events", async () => {
      const ts = Date.now();
      await storage.saveEvent({
        id: "ev-1",
        eventType: "order.placed",
        instanceId: "inst-ev-h",
        workflowId: "wf-1",
        payload: { orderId: "O1" },
        timestamp: ts,
      });
      const loaded = await storage.loadEvent("ev-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.eventType).toBe("order.placed");
    });

    it("should filter events by instanceId on queryEvents", async () => {
      await storage.saveEvent({
        id: "ev-a",
        eventType: "e1",
        instanceId: "inst-a",
        workflowId: "wf-1",
        payload: {},
        timestamp: Date.now(),
      });
      await storage.saveEvent({
        id: "ev-b",
        eventType: "e2",
        instanceId: "inst-b",
        workflowId: "wf-1",
        payload: {},
        timestamp: Date.now(),
      });
      const { events } = await storage.queryEvents({ instanceId: "inst-a" });
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe("ev-a");
    });

    it("should delete an event", async () => {
      await storage.saveEvent({
        id: "ev-del",
        eventType: "e",
        instanceId: "i",
        workflowId: "wf-1",
        payload: {},
        timestamp: Date.now(),
      });
      await storage.deleteEvent("ev-del");
      expect(await storage.loadEvent("ev-del")).toBeNull();
    });
  });

  // ── Workflow version management ────────────────────────────────────────────

  describe("workflow versions", () => {
    it("should save, load, and list workflow versions", async () => {
      await storage.saveWorkflowVersion({
        id: "wf-ver",
        name: "wf-ver",
        version: 1,
        definition: {} as any,
        createdAt: Date.now(),
      });
      const ver = await storage.loadWorkflowVersion("wf-ver", 1);
      expect(ver).not.toBeNull();
      const list = await storage.listWorkflowVersions("wf-ver");
      expect(list).toContain(1);
    });

    it("should return null for missing version", async () => {
      const ver = await storage.loadWorkflowVersion("wf-none", 99);
      expect(ver).toBeNull();
    });
  });
});
