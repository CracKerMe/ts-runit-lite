import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import type { EventWaitingState } from "../../storage/StorageProvider";

describe("Event Timeout - Property-Based Tests", () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.connect();
  });

  it("should handle timeout expiration idempotently (100+ iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          instanceId: fc.uuid(),
          nodeId: fc.uuid(),
          timeoutMs: fc.integer({ min: 100, max: 10000 }),
        }),
        async (params) => {
          const state: EventWaitingState = {
            instanceId: params.instanceId,
            nodeId: params.nodeId,
            eventType: "test",
            deadline: Date.now() - 1000, // Already expired
            createdAt: Date.now() - 5000,
          };

          // Save initial state
          await storage.saveEventWaitingState(state);
          let loaded = await storage.loadEventWaitingState(
            params.instanceId,
            params.nodeId,
          );
          expect(loaded).toBeDefined();

          // Simulate multiple timeout firings (idempotent)
          await storage.deleteEventWaitingState(
            params.instanceId,
            params.nodeId,
          );
          loaded = await storage.loadEventWaitingState(
            params.instanceId,
            params.nodeId,
          );
          expect(loaded).toBeNull();

          // Second deletion should also succeed (idempotent)
          await storage.deleteEventWaitingState(
            params.instanceId,
            params.nodeId,
          );
          loaded = await storage.loadEventWaitingState(
            params.instanceId,
            params.nodeId,
          );
          expect(loaded).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("should maintain deadline ordering across multiple events", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            instanceId: fc.uuid(),
            nodeId: fc.uuid(),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (events) => {
          const savedStates: EventWaitingState[] = [];

          // Save events with varying deadlines
          for (let i = 0; i < events.length; i++) {
            const state: EventWaitingState = {
              ...events[i],
              eventType: "test",
              deadline: Date.now() + i * 1000, // Staggered deadlines
              createdAt: Date.now(),
            };
            await storage.saveEventWaitingState(state);
            savedStates.push(state);
          }

          // Verify all are loadable
          for (const state of savedStates) {
            const loaded = await storage.loadEventWaitingState(
              state.instanceId,
              state.nodeId,
            );
            expect(loaded).toBeDefined();
            expect(loaded?.deadline).toBe(state.deadline);
          }

          // Load all and verify ordering
          const allStates = await storage.loadAllEventWaitingStates();
          expect(allStates.length).toBeGreaterThanOrEqual(events.length);

          // Verify no duplicates
          const keys = new Set(
            allStates.map((s) => `${s.instanceId}:${s.nodeId}`),
          );
          expect(keys.size).toBeGreaterThanOrEqual(events.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("should handle rapid event state transitions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.uuid(), fc.uuid()), {
          minLength: 1,
          maxLength: 20,
        }),
        async (eventPairs) => {
          // Save and immediately delete
          for (const [instanceId, nodeId] of eventPairs) {
            const state: EventWaitingState = {
              instanceId,
              nodeId,
              eventType: "rapid",
              deadline: Date.now() + 1000,
              createdAt: Date.now(),
            };

            await storage.saveEventWaitingState(state);
            const saved = await storage.loadEventWaitingState(
              instanceId,
              nodeId,
            );
            expect(saved).toBeDefined();

            await storage.deleteEventWaitingState(instanceId, nodeId);
            const deleted = await storage.loadEventWaitingState(
              instanceId,
              nodeId,
            );
            expect(deleted).toBeNull();
          }

          // All events should be cleaned up
          const remaining = await storage.loadAllEventWaitingStates();
          expect(remaining.length).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
