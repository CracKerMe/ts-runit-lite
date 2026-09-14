import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StickyExecutionManager } from "../../StickyExecutionManager";
import { WorkerPool } from "../WorkerPool";

/**
 * Verifies sticky affinity end to end: the pool must route follow-up tasks of
 * an instance back to the worker that already ran one of its tasks.
 */
describe("WorkerPool sticky affinity", () => {
  let pool: WorkerPool;
  let sticky: StickyExecutionManager;

  const httpTask = (instanceId: string, nodeId: string, url: string) => ({
    type: "execute" as const,
    taskId: `${instanceId}-${nodeId}-${Math.random()}`,
    payload: {
      nodeType: "http",
      config: { url, method: "GET" },
      instanceId,
      workflowId: "wf-affinity",
      nodeId,
      context: {},
    },
  });

  beforeEach(() => {
    sticky = new StickyExecutionManager();
    sticky.setOptions({ enabled: true, cacheSize: 10, ttlMs: 60_000 });
    pool = new WorkerPool(
      {
        minWorkers: 2,
        maxWorkers: 4,
        taskTimeout: 15_000,
        idleTimeout: 30_000,
      },
      sticky,
    );
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  it("binds an instance to a worker on first dispatch", async () => {
    // Unroutable URL: the task fails, but it is still dispatched to a worker,
    // which is what establishes the binding.
    await pool
      .executeTask(httpTask("inst-1", "n1", "http://127.0.0.1:1/none"))
      .catch(() => undefined);

    expect(sticky.getAssignedWorker("inst-1")).toBeDefined();
  });

  it("routes later tasks of the same instance to the bound worker", async () => {
    await pool
      .executeTask(httpTask("inst-2", "n1", "http://127.0.0.1:1/none"))
      .catch(() => undefined);

    const firstWorker = sticky.getAssignedWorker("inst-2");
    expect(firstWorker).toBeDefined();

    for (let i = 0; i < 4; i += 1) {
      await pool
        .executeTask(httpTask("inst-2", `n${i + 2}`, "http://127.0.0.1:1/none"))
        .catch(() => undefined);

      expect(sticky.getAssignedWorker("inst-2")).toBe(firstWorker);
    }
  });

  it("keeps separate instances independently bound", async () => {
    await pool
      .executeTask(httpTask("inst-a", "n1", "http://127.0.0.1:1/none"))
      .catch(() => undefined);
    await pool
      .executeTask(httpTask("inst-b", "n1", "http://127.0.0.1:1/none"))
      .catch(() => undefined);

    expect(sticky.getAssignedWorker("inst-a")).toBeDefined();
    expect(sticky.getAssignedWorker("inst-b")).toBeDefined();
  });

  it("clears bindings on shutdown", async () => {
    await pool
      .executeTask(httpTask("inst-3", "n1", "http://127.0.0.1:1/none"))
      .catch(() => undefined);
    expect(sticky.getAssignedWorker("inst-3")).toBeDefined();

    await pool.shutdown();

    expect(sticky.getAssignedWorker("inst-3")).toBeUndefined();
  });

  it("still dispatches when affinity is disabled", async () => {
    sticky.setOptions({ enabled: false });

    await expect(
      pool.executeTask(httpTask("inst-4", "n1", "http://127.0.0.1:1/none")),
    ).rejects.toBeDefined();
  });
});
