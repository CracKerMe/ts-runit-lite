import { beforeEach, describe, expect, it } from "vitest";
import {
  type SearchAttributeDefinition,
  SearchAttributeManager,
} from "../../engine/SearchAttributeManager";

describe("SearchAttributeManager", () => {
  let manager: SearchAttributeManager;

  beforeEach(() => {
    manager = new SearchAttributeManager();
  });

  describe("registerAttribute", () => {
    it("should register a single attribute definition", () => {
      const definition: SearchAttributeDefinition = {
        name: "status",
        type: "keyword",
        description: "Workflow status",
      };

      manager.registerAttribute(definition);

      expect(manager.getDefinition("status")).toEqual(definition);
    });

    it("should return undefined for non-existent definition", () => {
      expect(manager.getDefinition("non-existent")).toBeUndefined();
    });
  });

  describe("registerAttributes", () => {
    it("should register multiple attribute definitions", () => {
      const definitions: SearchAttributeDefinition[] = [
        { name: "priority", type: "int" },
        { name: "amount", type: "double" },
        { name: "active", type: "bool" },
      ];

      manager.registerAttributes(definitions);

      expect(manager.listDefinitions()).toHaveLength(3);
      expect(manager.getDefinition("priority")).toEqual({
        name: "priority",
        type: "int",
      });
      expect(manager.getDefinition("amount")).toEqual({
        name: "amount",
        type: "double",
      });
      expect(manager.getDefinition("active")).toEqual({
        name: "active",
        type: "bool",
      });
    });
  });

  describe("listDefinitions", () => {
    it("should return empty array when no definitions registered", () => {
      expect(manager.listDefinitions()).toEqual([]);
    });
  });

  describe("index", () => {
    it("should index workflow with keyword attribute", () => {
      manager.registerAttribute({ name: "status", type: "keyword" });

      manager.index("workflow-1", { status: "completed" });

      const index = manager.getIndex("workflow-1");
      expect(index).toEqual({ status: "completed" });
    });

    it("should index workflow with int attribute", () => {
      manager.registerAttribute({ name: "priority", type: "int" });

      manager.index("workflow-2", { priority: "10" });

      const index = manager.getIndex("workflow-2");
      expect(index).toEqual({ priority: 10 });
    });

    it("should index workflow with double attribute", () => {
      manager.registerAttribute({ name: "amount", type: "double" });

      manager.index("workflow-3", { amount: "99.99" });

      const index = manager.getIndex("workflow-3");
      expect(index).toEqual({ amount: 99.99 });
    });

    it("should index workflow with bool attribute", () => {
      manager.registerAttribute({ name: "active", type: "bool" });

      manager.index("workflow-4", { active: "true" });

      const index = manager.getIndex("workflow-4");
      expect(index).toEqual({ active: true });
    });

    it("should index workflow with datetime attribute", () => {
      manager.registerAttribute({ name: "createdAt", type: "datetime" });

      manager.index("workflow-5", { createdAt: "2024-01-01T00:00:00Z" });

      const index = manager.getIndex("workflow-5");
      expect(index?.createdAt).toBeInstanceOf(Date);
    });

    it("should normalize existing workflow index", () => {
      manager.registerAttribute({ name: "status", type: "keyword" });

      manager.index("workflow-1", { status: "running" });
      manager.index("workflow-1", { status: "completed" });

      const index = manager.getIndex("workflow-1");
      expect(index).toEqual({ status: "completed" });
    });

    it("should skip attributes without definition", () => {
      manager.registerAttribute({ name: "status", type: "keyword" });

      manager.index("workflow-1", { status: "completed", unknown: "value" });

      const index = manager.getIndex("workflow-1");
      expect(index).toEqual({ status: "completed" });
    });
  });

  describe("removeIndex", () => {
    it("should remove workflow index", () => {
      manager.registerAttribute({ name: "status", type: "keyword" });
      manager.index("workflow-1", { status: "completed" });

      manager.removeIndex("workflow-1");

      expect(manager.getIndex("workflow-1")).toBeUndefined();
    });

    it("should handle removing non-existent index", () => {
      expect(() => manager.removeIndex("non-existent")).not.toThrow();
    });
  });

  describe("getIndex", () => {
    it("should return undefined for non-existent workflow", () => {
      expect(manager.getIndex("non-existent")).toBeUndefined();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      manager.registerAttributes([{ name: "priority", type: "int" }]);
      // Keyed by instanceId; workflowId + status carried via meta.
      manager.index(
        "inst-1",
        { priority: 1 },
        { workflowId: "wf-a", status: "completed" },
      );
      manager.index(
        "inst-2",
        { priority: 2 },
        { workflowId: "wf-b", status: "running" },
      );
      manager.index(
        "inst-3",
        { priority: 3 },
        { workflowId: "wf-a", status: "completed" },
      );
    });

    it("should return all instances when no query specified", () => {
      const results = manager.query({});
      expect(results).toHaveLength(3);
    });

    it("should filter by workflowId (exact match)", () => {
      const results = manager.query({ workflowId: "wf-a" });
      expect(results).toContain("inst-1");
      expect(results).toContain("inst-3");
      expect(results).not.toContain("inst-2");
    });

    it("should filter by status", () => {
      const results = manager.query({ status: ["running"] });
      expect(results).toEqual(["inst-2"]);
    });

    it("should filter by multiple statuses", () => {
      const results = manager.query({ status: ["completed", "running"] });
      expect(results).toHaveLength(3);
    });

    it("should reflect status updates via updateStatus", () => {
      manager.updateStatus("inst-2", "completed");
      const results = manager.query({ status: ["completed"] });
      expect(results).toHaveLength(3);
      expect(manager.query({ status: ["running"] })).toHaveLength(0);
    });

    it("should filter by attributes", () => {
      const results = manager.query({ attributes: { priority: 1 } });
      expect(results).toEqual(["inst-1"]);
    });

    it("should combine status and attribute filters", () => {
      const results = manager.query({
        status: ["completed"],
        attributes: { priority: 3 },
      });
      expect(results).toEqual(["inst-3"]);
    });

    it("should apply offset and limit", () => {
      const results = manager.query({ offset: 1, limit: 1 });
      expect(results).toHaveLength(1);
    });

    it("should use default limit of 100", () => {
      const results = manager.query({});
      expect(results.length).toBeLessThanOrEqual(100);
    });
  });

  describe("count", () => {
    beforeEach(() => {
      manager.registerAttribute({ name: "status", type: "keyword" });
      manager.index("workflow-1", { status: "completed" });
      manager.index("workflow-2", { status: "running" });
      manager.index("workflow-3", { status: "completed" });
    });

    it("should return correct count", () => {
      expect(manager.count({})).toBe(3);
    });

    it("should return correct count with filters", () => {
      expect(manager.count({ attributes: { status: "completed" } })).toBe(2);
    });
  });

  describe("normalizeValue", () => {
    it("should normalize int from string", () => {
      manager.registerAttribute({ name: "value", type: "int" });
      manager.index("wf", { value: "42" });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe(42);
    });

    it("should normalize int from number", () => {
      manager.registerAttribute({ name: "value", type: "int" });
      manager.index("wf", { value: 42.7 });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe(42);
    });

    it("should normalize double from string", () => {
      manager.registerAttribute({ name: "value", type: "double" });
      manager.index("wf", { value: "3.14" });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe(3.14);
    });

    it("should normalize bool from string", () => {
      manager.registerAttribute({ name: "value", type: "bool" });
      manager.index("wf", { value: "true" });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe(true);
    });

    it("should normalize datetime from string", () => {
      manager.registerAttribute({ name: "value", type: "datetime" });
      manager.index("wf", { value: "2024-01-01T00:00:00Z" });
      const index = manager.getIndex("wf");
      expect(index?.value).toBeInstanceOf(Date);
    });

    it("should normalize datetime from Date object", () => {
      const date = new Date("2024-01-01");
      manager.registerAttribute({ name: "value", type: "datetime" });
      manager.index("wf", { value: date });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe(date);
    });

    it("should normalize datetime from timestamp", () => {
      manager.registerAttribute({ name: "value", type: "datetime" });
      manager.index("wf", { value: 1704067200000 });
      const index = manager.getIndex("wf");
      expect(index?.value).toBeInstanceOf(Date);
    });

    it("should convert unknown type to string", () => {
      manager.registerAttribute({ name: "value", type: "keyword" });
      manager.index("wf", { value: 123 });
      const index = manager.getIndex("wf");
      expect(index?.value).toBe("123");
    });
  });
});
