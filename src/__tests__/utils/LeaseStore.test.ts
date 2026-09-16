import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaseStore } from "../../utils/LeaseStore";

describe("InMemoryLeaseStore", () => {
  let store: ReturnType<typeof createLeaseStore>;

  beforeEach(() => {
    store = createLeaseStore(); // no storage arg → InMemoryLeaseStore
  });

  // ── acquire ────────────────────────────────────────────────────────────────

  describe("acquire", () => {
    it("should acquire a lease when no lease exists", async () => {
      const ok = await store.acquire("key-1", "holder-A", 5000);
      expect(ok).toBe(true);
    });

    it("should allow the same holder to re-acquire (refresh)", async () => {
      await store.acquire("key-2", "holder-A", 5000);
      const ok = await store.acquire("key-2", "holder-A", 5000);
      expect(ok).toBe(true);
    });

    it("should deny acquisition by a different holder when lease is active", async () => {
      await store.acquire("key-3", "holder-A", 5000);
      const ok = await store.acquire("key-3", "holder-B", 5000);
      expect(ok).toBe(false);
    });

    it("should allow acquisition after a lease has expired", async () => {
      // Use a very short TTL and mock Date.now to simulate expiry
      const now = Date.now();
      const realNow = Date.now;
      let tick = 0;
      Date.now = vi.fn(() => now + tick);

      await store.acquire("key-4", "holder-A", 100);
      tick = 200; // 200ms later, lease has expired

      const ok = await store.acquire("key-4", "holder-B", 5000);
      Date.now = realNow;
      expect(ok).toBe(true);
    });
  });

  // ── renew ──────────────────────────────────────────────────────────────────

  describe("renew", () => {
    it("should renew an active lease", async () => {
      await store.acquire("key-5", "holder-A", 5000);
      const ok = await store.renew("key-5", "holder-A", 5000);
      expect(ok).toBe(true);
    });

    it("should fail to renew a non-existent lease", async () => {
      const ok = await store.renew("no-such-key", "holder-A", 5000);
      expect(ok).toBe(false);
    });

    it("should fail to renew a lease for a different holder", async () => {
      await store.acquire("key-6", "holder-A", 5000);
      const ok = await store.renew("key-6", "holder-B", 5000);
      expect(ok).toBe(false);
    });

    it("should fail to renew an expired lease", async () => {
      const now = Date.now();
      const realNow = Date.now;
      let tick = 0;
      Date.now = vi.fn(() => now + tick);

      await store.acquire("key-7", "holder-A", 100);
      tick = 200; // expired

      const ok = await store.renew("key-7", "holder-A", 5000);
      Date.now = realNow;
      expect(ok).toBe(false);
    });
  });

  // ── release ────────────────────────────────────────────────────────────────

  describe("release", () => {
    it("should release a lease held by the same holder", async () => {
      await store.acquire("key-8", "holder-A", 5000);
      const ok = await store.release("key-8", "holder-A");
      expect(ok).toBe(true);
    });

    it("should not release a lease held by a different holder", async () => {
      await store.acquire("key-9", "holder-A", 5000);
      const ok = await store.release("key-9", "holder-B");
      expect(ok).toBe(false);
    });

    it("should return true when releasing a non-existent key", async () => {
      const ok = await store.release("ghost-key", "holder-A");
      expect(ok).toBe(true);
    });

    it("should allow re-acquisition after release", async () => {
      await store.acquire("key-10", "holder-A", 5000);
      await store.release("key-10", "holder-A");
      const ok = await store.acquire("key-10", "holder-B", 5000);
      expect(ok).toBe(true);
    });
  });
});
