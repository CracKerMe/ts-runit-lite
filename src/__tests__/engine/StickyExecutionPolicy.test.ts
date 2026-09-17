import { beforeEach, describe, expect, it } from "vitest";
import { StickyExecutionPolicy } from "../../engine/StickyExecutionPolicy";

describe("StickyExecutionPolicy", () => {
  let manager: StickyExecutionPolicy;

  beforeEach(() => {
    manager = new StickyExecutionPolicy();
    manager.setOptions({ enabled: true, cacheSize: 3, ttlMs: 60_000 });
  });

  it("binds an instance to a worker and reports the binding", async () => {
    expect(manager.getAssignedWorker("i1")).toBeUndefined();

    const assigned = await manager.tryAssignWorker("i1", "wf1", "worker-1");

    expect(assigned).toBe(true);
    expect(manager.getAssignedWorker("i1")).toBe("worker-1");
  });

  it("refuses to rebind an instance already held by another worker", async () => {
    await manager.tryAssignWorker("i1", "wf1", "worker-1");

    const stolen = await manager.tryAssignWorker("i1", "wf1", "worker-2");

    expect(stolen).toBe(false);
    expect(manager.getAssignedWorker("i1")).toBe("worker-1");
  });

  it("reports no binding while disabled", async () => {
    await manager.tryAssignWorker("i1", "wf1", "worker-1");
    manager.setOptions({ enabled: false });

    expect(manager.getAssignedWorker("i1")).toBeUndefined();
  });

  it("releaseWorker frees every instance bound to a dead worker", async () => {
    await manager.tryAssignWorker("i1", "wf1", "worker-1");
    await manager.tryAssignWorker("i2", "wf1", "worker-1");
    await manager.tryAssignWorker("i3", "wf1", "worker-2");

    manager.releaseWorker("worker-1");

    expect(manager.getAssignedWorker("i1")).toBeUndefined();
    expect(manager.getAssignedWorker("i2")).toBeUndefined();
    // Bindings on other workers are untouched.
    expect(manager.getAssignedWorker("i3")).toBe("worker-2");
  });

  it("releaseWorker lets a freed instance bind to a new worker", async () => {
    await manager.tryAssignWorker("i1", "wf1", "worker-1");
    manager.releaseWorker("worker-1");

    const rebound = await manager.tryAssignWorker("i1", "wf1", "worker-2");

    expect(rebound).toBe(true);
    expect(manager.getAssignedWorker("i1")).toBe("worker-2");
  });

  it("evicts the oldest cache entry beyond cacheSize", async () => {
    await manager.tryAssignWorker("i1", "wf1", "worker-1");

    for (const key of ["a", "b", "c", "d"]) {
      manager.setCacheValue("wf1", "i1", "worker-1", key, key);
    }

    const cache = manager.getWorkerCache("wf1", "i1", "worker-1");
    expect(cache?.size).toBe(3);
    expect(cache?.has("a")).toBe(false);
    expect(cache?.has("d")).toBe(true);
  });

  it("drops the binding and cache once the TTL elapses", async () => {
    manager.setOptions({ ttlMs: 1 });
    await manager.tryAssignWorker("i1", "wf1", "worker-1");
    manager.setCacheValue("wf1", "i1", "worker-1", "k", "v");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(manager.getWorkerCache("wf1", "i1", "worker-1")).toBeUndefined();
  });
});
