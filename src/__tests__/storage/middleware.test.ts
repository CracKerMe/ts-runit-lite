import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import { MemoryStorage } from "../../storage/MemoryStorage";
import { withStorageCache, withStorageMetrics } from "../../storage/middleware";

function makeInstance(id: string, workflowId = "wf-1"): WorkflowInstance {
  return {
    instanceId: id,
    workflowId,
    currentNodes: ["node-1"],
    status: "running",
    context: {},
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    retries: {},
    state: { nodes: {} },
  };
}

describe("withStorageMetrics", () => {
  let inner: MemoryStorage;

  beforeEach(async () => {
    inner = new MemoryStorage();
    await inner.connect();
  });

  it("records timing for every intercepted call without altering the result", async () => {
    const calls: Array<{ method: string; durationMs: number }> = [];
    const storage = withStorageMetrics(inner, (method, durationMs) => {
      calls.push({ method, durationMs });
    });

    await storage.saveInstance(makeInstance("inst-1"));
    const loaded = await storage.loadInstance("inst-1");

    expect(loaded?.instanceId).toBe("inst-1");
    expect(calls.map((c) => c.method)).toEqual(
      expect.arrayContaining(["saveInstance", "loadInstance"]),
    );
    for (const call of calls) {
      expect(call.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("records timing for calls that resolve to a falsy/rejected outcome (CAS conflict)", async () => {
    const calls: string[] = [];
    const storage = withStorageMetrics(inner, (method) => calls.push(method));

    await storage.saveInstance(makeInstance("inst-1"));
    const staleWrite = makeInstance("inst-1");
    staleWrite.version = -1;
    const casSucceeded = await storage.casUpdateInstance(staleWrite);

    expect(casSucceeded).toBe(false);
    expect(calls).toContain("casUpdateInstance");
  });
});

describe("withStorageCache", () => {
  let inner: MemoryStorage;

  beforeEach(async () => {
    inner = new MemoryStorage();
    await inner.connect();
  });

  it("serves loadInstance from cache within the TTL without hitting the inner storage again", async () => {
    const storage = withStorageCache(inner, { ttlMs: 60_000 });
    await storage.saveInstance(makeInstance("inst-1"));

    const first = await storage.loadInstance("inst-1");
    await inner.deleteInstance("inst-1");
    const second = await storage.loadInstance("inst-1");

    expect(first?.instanceId).toBe("inst-1");
    expect(second?.instanceId).toBe("inst-1");
  });

  it("invalidates the whole cache when a write method runs", async () => {
    const storage = withStorageCache(inner, { ttlMs: 60_000 });
    await storage.saveInstance(makeInstance("inst-1"));
    await storage.loadInstance("inst-1");

    await storage.saveInstance(makeInstance("inst-2"));
    await inner.deleteInstance("inst-1");

    const afterInvalidate = await storage.loadInstance("inst-1");
    expect(afterInvalidate).toBeNull();
  });

  it("expires cached entries after the configured TTL", async () => {
    const storage = withStorageCache(inner, { ttlMs: 5 });
    await storage.saveInstance(makeInstance("inst-1"));
    await storage.loadInstance("inst-1");

    await inner.deleteInstance("inst-1");
    await new Promise((resolve) => setTimeout(resolve, 15));

    const afterExpiry = await storage.loadInstance("inst-1");
    expect(afterExpiry).toBeNull();
  });
});
