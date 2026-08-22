import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { InstanceManager } from "../InstanceManager";

describe("InstanceManager CAS concurrency", () => {
  it("should handle concurrent updates with CAS (100+ iterations)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.object({ maxDepth: 2 }), { minLength: 2, maxLength: 10 }),
        async (updates) => {
          const storage = new MemoryStorage();
          await storage.connect();
          const manager = new InstanceManager(storage);

          const instance = await manager.createInstance("wf1", "start");
          const originalVersion = instance.version ?? 1;

          // Simulate concurrent updates — use enough retries for all concurrent writers
          const maxConcurrent = updates.length;
          const promises = updates.map((update) =>
            manager.updateInstance(
              {
                ...instance,
                context: { ...instance.context, ...update },
              },
              maxConcurrent + 2,
            ),
          );

          await Promise.all(promises);

          const final = manager.getInstance(instance.instanceId);
          expect(final).toBeDefined();
          expect(final?.version).toBe(originalVersion + updates.length);

          await storage.close?.();
        },
      ),
      { numRuns: 100, seed: 42 },
    );
  });

  it("should maintain version monotonicity across updates", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 10 }), async (updateCount) => {
        const storage = new MemoryStorage();
        await storage.connect();
        const manager = new InstanceManager(storage);

        const instance = await manager.createInstance("wf2", "start");
        let previousVersion = instance.version ?? 1;

        for (let i = 0; i < updateCount; i++) {
          const current = manager.getInstance(instance.instanceId);
          if (current) {
            await manager.updateInstance({
              ...current,
              context: { counter: i },
            });

            const updated = manager.getInstance(instance.instanceId);
            expect(updated?.version ?? 1).toBeGreaterThan(previousVersion);
            previousVersion = updated?.version ?? 1;
          }
        }

        await storage.close?.();
      }),
      { numRuns: 50 },
    );
  });

  it("should detect version conflicts under contention", async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat(), async () => {
        const storage = new MemoryStorage();
        await storage.connect();
        const manager = new InstanceManager(storage);

        const instance = await manager.createInstance("wf3", "start");

        // Simulate competing writers by manually constructing conflicts
        const stale1 = { ...instance, context: { writer: 1 } };
        const stale2 = { ...instance, context: { writer: 2 } };

        await manager.updateInstance(stale1);
        // Second update should handle the version conflict via retry
        await manager.updateInstance(stale2);

        const final = manager.getInstance(instance.instanceId);
        expect(final?.version).toBe(3);
        expect(final?.context).toEqual({ writer: 2 });

        await storage.close?.();
      }),
      { numRuns: 50 },
    );
  });
});
