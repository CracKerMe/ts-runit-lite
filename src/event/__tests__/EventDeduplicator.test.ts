import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventDeduplicator } from "../EventDeduplicator";

describe("EventDeduplicator", () => {
  let deduplicator: EventDeduplicator;

  beforeEach(() => {
    // 使用内存模式进行测试
    deduplicator = new EventDeduplicator();
  });

  afterEach(() => {
    deduplicator.destroy();
  });

  describe("isDuplicate", () => {
    it("should return false for first occurrence of event", () => {
      const result = deduplicator.isDuplicate("event-1");
      expect(result).toBe(false);
    });

    it("should return true for duplicate events", () => {
      deduplicator.isDuplicate("event-2");
      const result = deduplicator.isDuplicate("event-2");
      expect(result).toBe(true);
    });

    it("should handle different event IDs independently", () => {
      deduplicator.isDuplicate("event-a");

      const resultA = deduplicator.isDuplicate("event-a");
      const resultB = deduplicator.isDuplicate("event-b");

      expect(resultA).toBe(true);
      expect(resultB).toBe(false);
    });
  });

  describe("markProcessed", () => {
    it("should mark event as processed", () => {
      deduplicator.markProcessed("event-3");
      const result = deduplicator.isDuplicate("event-3");
      expect(result).toBe(true);
    });
  });

  describe("clearEvent", () => {
    it("should clear specific event record", () => {
      deduplicator.isDuplicate("event-4");
      deduplicator.clearEvent("event-4");

      const result = deduplicator.isDuplicate("event-4");
      expect(result).toBe(false);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", () => {
      deduplicator.isDuplicate("event-6");
      deduplicator.isDuplicate("event-7");
      deduplicator.isDuplicate("event-6"); // duplicate - not added

      const stats = deduplicator.getStats();

      expect(stats.totalRecords).toBe(2);
      expect(stats.oldestRecordAge).toBeGreaterThanOrEqual(0);
    });
  });

  describe("destroy", () => {
    it("should clear all records on destroy", () => {
      deduplicator.isDuplicate("event-8");
      deduplicator.destroy();

      // Create new instance to verify cleanup
      const newDedup = new EventDeduplicator();
      const result = newDedup.isDuplicate("event-8");
      expect(result).toBe(false);
      newDedup.destroy();
    });
  });
});
