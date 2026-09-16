import { beforeEach, describe, expect, it } from "vitest";
import { DeadLetterQueue, getDLQ, setDLQ } from "../../dlq/DeadLetterQueue";

describe("DeadLetterQueue (extended)", () => {
  let dlq: DeadLetterQueue;

  beforeEach(() => {
    dlq = new DeadLetterQueue();
  });

  // ── pop ───────────────────────────────────────────────────────────────────

  describe("pop", () => {
    it("should return null when queue is empty", async () => {
      expect(await dlq.pop()).toBeNull();
    });

    it("should return and remove the oldest entry", async () => {
      await dlq.push({
        type: "task",
        payload: { n: 1 },
        error: "e1",
        retryCount: 0,
      });
      await dlq.push({
        type: "task",
        payload: { n: 2 },
        error: "e2",
        retryCount: 0,
      });

      const popped = await dlq.pop();
      expect(popped).not.toBeNull();
      expect(popped!.error).toBe("e1");

      const remaining = await dlq.list();
      expect(remaining.total).toBe(1);
    });
  });

  // ── get ───────────────────────────────────────────────────────────────────

  describe("get", () => {
    it("should return null for non-existent id", async () => {
      expect(await dlq.get("no-such")).toBeNull();
    });

    it("should return entry without removing it", async () => {
      const id = await dlq.push({
        type: "event",
        payload: {},
        error: "err",
        retryCount: 0,
      });

      const entry = await dlq.get(id);
      expect(entry).not.toBeNull();
      expect(entry!.id).toBe(id);
      expect(entry!.type).toBe("event");

      // Entry should still be in the queue
      const list = await dlq.list();
      expect(list.total).toBe(1);
    });
  });

  // ── incrementRetry ────────────────────────────────────────────────────────

  describe("incrementRetry", () => {
    it("should increment retry count", async () => {
      const id = await dlq.push({
        type: "task",
        payload: {},
        error: "err",
        retryCount: 0,
      });

      const count1 = await dlq.incrementRetry(id);
      expect(count1).toBe(1);

      const count2 = await dlq.incrementRetry(id);
      expect(count2).toBe(2);

      const entry = await dlq.get(id);
      expect(entry!.retryCount).toBe(2);
    });

    it("should throw for non-existent entry", async () => {
      await expect(dlq.incrementRetry("no-such")).rejects.toThrow(
        "DLQ entry not found",
      );
    });
  });

  // ── list with workflowId filter ───────────────────────────────────────────

  describe("list with workflowId filter", () => {
    it("should filter entries by workflowId", async () => {
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "e1",
        retryCount: 0,
        workflowId: "wf-a",
      });
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "e2",
        retryCount: 0,
        workflowId: "wf-b",
      });
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "e3",
        retryCount: 0,
        workflowId: "wf-a",
      });

      const result = await dlq.list({ workflowId: "wf-a" });
      expect(result.total).toBe(2);
      expect(result.entries.every((e) => e.workflowId === "wf-a")).toBe(true);
    });
  });

  // ── maxSize enforcement ───────────────────────────────────────────────────

  describe("maxSize enforcement", () => {
    it("should evict oldest entry when maxSize is exceeded", async () => {
      const smallDlq = new DeadLetterQueue(undefined, 2);

      const id1 = await smallDlq.push({
        type: "task",
        payload: { n: 1 },
        error: "e1",
        retryCount: 0,
      });
      await smallDlq.push({
        type: "task",
        payload: { n: 2 },
        error: "e2",
        retryCount: 0,
      });
      await smallDlq.push({
        type: "task",
        payload: { n: 3 },
        error: "e3",
        retryCount: 0,
      });

      const list = await smallDlq.list();
      expect(list.total).toBe(2);

      // Oldest entry (id1) should have been evicted
      const evicted = await smallDlq.get(id1);
      expect(evicted).toBeNull();
    });
  });

  // ── getStats with byWorkflow ──────────────────────────────────────────────

  describe("getStats with byWorkflow", () => {
    it("should include byWorkflow counts", async () => {
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "e",
        retryCount: 0,
        workflowId: "wf-x",
      });
      await dlq.push({
        type: "workflow",
        payload: {},
        error: "e",
        retryCount: 0,
        workflowId: "wf-x",
      });
      await dlq.push({
        type: "task",
        payload: {},
        error: "e",
        retryCount: 0,
        workflowId: "wf-y",
      });

      const stats = await dlq.getStats();
      expect(stats.byWorkflow["wf-x"]).toBe(2);
      expect(stats.byWorkflow["wf-y"]).toBe(1);
    });
  });

  // ── singleton helpers ─────────────────────────────────────────────────────

  describe("getDLQ / setDLQ", () => {
    it("should return the same singleton", () => {
      const a = getDLQ();
      const b = getDLQ();
      expect(a).toBe(b);
    });

    it("should allow replacing the singleton", () => {
      const custom = new DeadLetterQueue();
      setDLQ(custom);
      expect(getDLQ()).toBe(custom);
    });
  });
});
