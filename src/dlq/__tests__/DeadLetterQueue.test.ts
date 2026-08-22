import { beforeEach, describe, expect, it } from "vitest";
import { DeadLetterQueue } from "../DeadLetterQueue";

describe("DeadLetterQueue", () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  describe("push", () => {
    it("should add entry to the queue", async () => {
      await dlq.push({
        type: "task",
        payload: { taskId: "task-1" },
        error: "Task failed",
        instanceId: "instance-1",
        nodeId: "node-1",
        retryCount: 0,
      });

      const entries = await dlq.list();
      expect(entries.entries.length).toBe(1);
      expect(entries.entries[0].type).toBe("task");
    });

    it("should generate unique IDs for entries", async () => {
      await dlq.push({
        type: "event",
        payload: {},
        error: "Error 1",
        retryCount: 0,
      });
      await dlq.push({
        type: "event",
        payload: {},
        error: "Error 2",
        retryCount: 0,
      });

      const entries = await dlq.list();
      expect(entries.entries[0].id).not.toBe(entries.entries[1].id);
    });
  });

  describe("list", () => {
    it("should return entries with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await dlq.push({
          type: "task",
          payload: { i },
          error: `Error ${i}`,
          retryCount: 0,
        });
      }

      const page1 = await dlq.list({ limit: 2, offset: 0 });
      const page2 = await dlq.list({ limit: 2, offset: 2 });

      expect(page1.entries.length).toBe(2);
      expect(page2.entries.length).toBe(2);
      expect(page1.total).toBe(5);
    });

    it("should filter by type", async () => {
      await dlq.push({
        type: "task",
        payload: {},
        error: "Task error",
        retryCount: 0,
      });
      await dlq.push({
        type: "event",
        payload: {},
        error: "Event error",
        retryCount: 0,
      });
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "Workflow error",
        retryCount: 0,
      });

      const tasks = await dlq.list({ type: "task" });
      const events = await dlq.list({ type: "event" });

      expect(tasks.entries.length).toBe(1);
      expect(events.entries.length).toBe(1);
    });
  });

  describe("remove", () => {
    it("should remove entry by ID", async () => {
      await dlq.push({
        type: "task",
        payload: {},
        error: "Error",
        retryCount: 0,
      });
      const entries = await dlq.list();
      const id = entries.entries[0].id;

      const removed = await dlq.remove(id);
      expect(removed).toBe(true);

      const afterRemove = await dlq.list();
      expect(afterRemove.entries.length).toBe(0);
    });

    it("should return false for non-existent ID", async () => {
      const removed = await dlq.remove("non-existent-id");
      expect(removed).toBe(false);
    });
  });

  describe("clear", () => {
    it("should remove all entries", async () => {
      await dlq.push({
        type: "task",
        payload: {},
        error: "Error 1",
        retryCount: 0,
      });
      await dlq.push({
        type: "event",
        payload: {},
        error: "Error 2",
        retryCount: 0,
      });

      const count = await dlq.clear();
      expect(count).toBe(2);

      const entries = await dlq.list();
      expect(entries.entries.length).toBe(0);
    });
  });

  describe("getStats", () => {
    it("should return correct statistics", async () => {
      await dlq.push({
        type: "task",
        payload: {},
        error: "Error",
        retryCount: 1,
      });
      await dlq.push({
        type: "task",
        payload: {},
        error: "Error",
        retryCount: 3,
      });
      await dlq.push({
        type: "event",
        payload: {},
        error: "Error",
        retryCount: 0,
      });

      const stats = await dlq.getStats();

      expect(stats.total).toBe(3);
      expect(stats.byType.task).toBe(2);
      expect(stats.byType.event).toBe(1);
    });
  });
});
