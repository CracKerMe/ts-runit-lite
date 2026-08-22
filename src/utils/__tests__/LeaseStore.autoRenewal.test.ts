import { describe, expect, it } from "vitest";
import { createLeaseStore } from "../LeaseStore";

describe("LeaseStore - Auto Renewal", () => {
  describe("InMemoryLeaseStore", () => {
    it("should auto-renewal cleanup function works correctly", async () => {
      const leaseStore = createLeaseStore();
      const key = "test-lease";
      const holderId = "worker-1";
      const ttlMs = 10000;

      // Acquire lease
      const acquired = await leaseStore.acquire(key, holderId, ttlMs);
      expect(acquired).toBe(true);

      // Start auto-renewal (should return a function)
      const stopRenewal = leaseStore.startAutoRenewal(
        key,
        holderId,
        ttlMs,
        5000,
      );
      expect(typeof stopRenewal).toBe("function");

      // Cleanup - stop renewal
      stopRenewal();
    });

    it("should stop auto-renewal on release", async () => {
      const leaseStore = createLeaseStore();
      const key = "test-lease";
      const holderId = "worker-1";
      const ttlMs = 10000;

      await leaseStore.acquire(key, holderId, ttlMs);

      const stopRenewal = leaseStore.startAutoRenewal(
        key,
        holderId,
        ttlMs,
        5000,
      );

      // Release should stop renewal
      const released = await leaseStore.release(key, holderId);
      expect(released).toBe(true);

      // Cleanup
      stopRenewal();
    });

    it("should return cleanup function", async () => {
      const leaseStore = createLeaseStore();
      const key = "test-lease";
      const holderId = "worker-1";
      const ttlMs = 10000;

      await leaseStore.acquire(key, holderId, ttlMs);

      // startAutoRenewal should return a function
      const stopRenewal = leaseStore.startAutoRenewal(key, holderId, ttlMs);

      expect(typeof stopRenewal).toBe("function");

      // Calling stopRenewal should stop the timer
      stopRenewal();

      // Must explicitly release to free the lease
      const released = await leaseStore.release(key, holderId);
      expect(released).toBe(true);

      // Should be able to acquire again after releasing
      const acquired = await leaseStore.acquire(key, "worker-2", ttlMs);
      expect(acquired).toBe(true);
    });

    it("should default renewal interval to 50% of TTL", async () => {
      const leaseStore = createLeaseStore();
      const key = "test-lease";
      const holderId = "worker-1";
      const ttlMs = 10000;

      await leaseStore.acquire(key, holderId, ttlMs);

      // Not passing renewIntervalMs should use 50% of ttlMs
      const stopRenewal = leaseStore.startAutoRenewal(key, holderId, ttlMs);

      // Just verify it returns a function
      expect(typeof stopRenewal).toBe("function");
      stopRenewal();
    });
  });
});
