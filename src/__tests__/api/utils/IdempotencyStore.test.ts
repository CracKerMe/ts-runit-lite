import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hashRequestBody,
  IdempotencyStore,
} from "../../../api/utils/IdempotencyStore";

/**
 * IdempotencyStore Unit Tests
 * REDIS_ENABLED=false so all tests use the in-memory path
 */

describe("hashRequestBody", () => {
  it("should produce consistent hash for same input", () => {
    const body = { userId: "123", amount: 100 };
    const hash1 = hashRequestBody(body);
    const hash2 = hashRequestBody(body);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should produce consistent hash regardless of key order", () => {
    const hash1 = hashRequestBody({ a: 1, b: 2 });
    const hash2 = hashRequestBody({ b: 2, a: 1 });
    expect(hash1).toBe(hash2);
  });

  it("should produce different hash for different input", () => {
    expect(hashRequestBody({ id: "1" })).not.toBe(hashRequestBody({ id: "2" }));
  });

  it("should handle null and undefined", () => {
    const nullHash = hashRequestBody(null);
    const undefinedHash = hashRequestBody(undefined);
    expect(nullHash).toMatch(/^[a-f0-9]{64}$/);
    expect(undefinedHash).toMatch(/^[a-f0-9]{64}$/);
    // null -> "null", undefined -> "undefined" (different)
    expect(nullHash).not.toBe(undefinedHash);
  });

  it("should handle arrays with consistent ordering", () => {
    expect(hashRequestBody([1, 2, 3])).toBe(hashRequestBody([1, 2, 3]));
    expect(hashRequestBody([1, 2, 3])).not.toBe(hashRequestBody([3, 2, 1]));
  });

  it("should handle nested objects", () => {
    const body = { user: { profile: { name: "Alice" } }, role: "admin" };
    const hash1 = hashRequestBody(body);
    const hash2 = hashRequestBody({
      role: "admin",
      user: { profile: { name: "Alice" } },
    });
    expect(hash1).toBe(hash2);
  });
});

describe("IdempotencyStore (memory mode)", () => {
  let store: IdempotencyStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T10:00:00Z"));
    store = new IdempotencyStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("reserve", () => {
    it("should return reserved for new key", async () => {
      const result = await store.reserve(
        "namespace-1",
        "req-new",
        hashRequestBody({ data: "test" }),
      );
      expect(result.type).toBe("reserved");
    });

    it("should return in_progress when same key+body already pending", async () => {
      const h = hashRequestBody({ amount: 100 });
      await store.reserve("ns-2", "req-1", h);
      const result = await store.reserve("ns-2", "req-1", h);
      expect(result.type).toBe("in_progress");
    });

    it("should return conflict when same key used with different body", async () => {
      await store.reserve("ns-3", "req-1", hashRequestBody({ a: 1 }));
      const result = await store.reserve(
        "ns-3",
        "req-1",
        hashRequestBody({ a: 2 }),
      );
      expect(result.type).toBe("conflict");
      expect(
        (result as { type: "conflict"; message: string }).message,
      ).toContain("different payload");
    });

    it("should return hit for completed key with same body", async () => {
      const h = hashRequestBody({ value: 42 });
      await store.reserve("ns-4", "req-hit", h);
      await store.complete("ns-4", "req-hit", h, { result: 42 });

      const result = await store.reserve("ns-4", "req-hit", h);
      expect(result.type).toBe("hit");
      expect((result as { type: "hit"; value: unknown }).value).toEqual({
        result: 42,
      });
    });

    it("should return hit for directly completed key", async () => {
      const h = hashRequestBody({ ok: true });
      await store.complete("ns-5", "completed-key", h, { status: "done" });

      const hit = await store.reserve("ns-5", "completed-key", h);
      expect(hit.type).toBe("hit");
    });

    it("should treat different namespaces as independent", async () => {
      const h = hashRequestBody({ x: 1 });
      await store.reserve("ns-a", "key-1", h);
      const result = await store.reserve("ns-b", "key-1", h);
      expect(result.type).toBe("reserved");
    });
  });

  describe("complete", () => {
    it("should mark reserved key as completed", async () => {
      const h = hashRequestBody({ tx: "abc" });
      await store.reserve("ns-6", "req-complete", h);
      await store.complete("ns-6", "req-complete", h, {
        transactionId: "tx-abc",
      });

      const hit = await store.reserve("ns-6", "req-complete", h);
      expect(hit.type).toBe("hit");
      expect((hit as { type: "hit"; value: unknown }).value).toEqual({
        transactionId: "tx-abc",
      });
    });

    it("should allow complete without prior reserve", async () => {
      const h = hashRequestBody({ direct: true });
      await store.complete("ns-7", "req-direct", h, { done: true });

      const result = await store.reserve("ns-7", "req-direct", h);
      expect(result.type).toBe("hit");
      expect((result as { type: "hit"; value: unknown }).value).toEqual({
        done: true,
      });
    });

    it("should overwrite previous completed value", async () => {
      const h = hashRequestBody({ overwrite: true });
      await store.complete("ns-8", "req-ov", h, { v: 1 });
      await store.complete("ns-8", "req-ov", h, { v: 2 });

      const hit = await store.reserve("ns-8", "req-ov", h);
      expect((hit as { type: "hit"; value: unknown }).value).toEqual({ v: 2 });
    });
  });

  describe("fail", () => {
    it("should remove pending key on fail", async () => {
      const h = hashRequestBody({ fail: true });
      await store.reserve("ns-9", "req-fail", h);
      await store.fail("ns-9", "req-fail");

      const result = await store.reserve("ns-9", "req-fail", h);
      expect(result.type).toBe("reserved");
    });

    it("should be no-op for non-existent key", async () => {
      await expect(store.fail("ns-10", "ghost-key")).resolves.toBeUndefined();
    });
  });

  describe("completed entry survival", () => {
    it("completed entry should survive time advance", async () => {
      const store2 = new IdempotencyStore();
      const h = hashRequestBody({ completed: true });

      await store2.reserve("ns-ttl-2", "completed-key", h);
      await store2.complete("ns-ttl-2", "completed-key", h, { ok: true });

      vi.advanceTimersByTime(6000);

      const hit = await store2.reserve("ns-ttl-2", "completed-key", h);
      expect(hit.type).toBe("hit");
    });
  });

  describe("edge cases", () => {
    it("should handle empty object body", async () => {
      const h = hashRequestBody({});
      await store.reserve("ns-empty", "empty-1", h);
      await store.complete("ns-empty", "empty-1", h, { ok: true });

      const hit = await store.reserve("ns-empty", "empty-1", h);
      expect(hit.type).toBe("hit");
    });

    it("should handle nested complex body", async () => {
      const body = {
        users: [
          { id: 1, tags: ["a", "b"] },
          { id: 2, tags: ["c"] },
        ],
      };
      const h = hashRequestBody(body);
      await store.reserve("ns-nested", "nested-1", h);
      await store.complete("ns-nested", "nested-1", h, { count: 2 });

      const hit = await store.reserve("ns-nested", "nested-1", h);
      expect(hit.type).toBe("hit");
    });

    it("should distinguish same body on different keys", async () => {
      const h = hashRequestBody({ same: true });
      await store.reserve("ns-key", "key-a", h);
      await store.reserve("ns-key", "key-b", h);

      const resultA = await store.reserve("ns-key", "key-a", h);
      const resultB = await store.reserve("ns-key", "key-b", h);
      expect(resultA.type).toBe("in_progress");
      expect(resultB.type).toBe("in_progress");
    });
  });
});
