import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionSandboxPool } from "../../../engine/worker/ActionSandboxPool";

describe("ActionSandboxPool", () => {
  let pool: ActionSandboxPool;

  beforeEach(() => {
    pool = new ActionSandboxPool({
      minWorkers: 1,
      maxWorkers: 2,
      taskTimeoutMs: 2000,
      idleTimeoutMs: 30000,
    });
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  it("should initialize with min workers", () => {
    const stats = pool.getStats();
    expect(stats.total).toBe(1);
    expect(stats.idle).toBe(1);
  });

  it("evaluates an expression in a worker thread and returns the result", async () => {
    const result = await pool.evaluate(
      "(function(instance) { return instance.status; })(instance)",
      { instance: { status: "running" } },
    );
    expect(result).toBe("running");
  });

  it("propagates a thrown error from the sandboxed expression", async () => {
    await expect(
      pool.evaluate("(function() { throw new Error('boom'); })()", {}),
    ).rejects.toThrow("boom");
  });

  it("blocks dangerous patterns just like the in-process sandbox", async () => {
    await expect(pool.evaluate("process.exit(1)", {})).rejects.toThrow(
      /blocked pattern/i,
    );
  });

  it("hard-terminates a worker that exceeds its timeout", async () => {
    // minWorkers: 0 avoids an eager worker at construction; taskTimeoutMs is
    // generous (2s) because it also bounds the *recovery* evaluate() call
    // below, which has to spin up a brand-new worker thread from scratch
    // (real wall-clock cost, worse under the dev ts-node/esm loader and
    // under whole-suite parallel load) — the hung task still gets killed
    // almost immediately since it never yields the event loop for the
    // timeout to matter; what's under test is termination happening at all,
    // not shaving the timeout to the minimum tolerable value.
    const busyPool = new ActionSandboxPool({
      minWorkers: 0,
      maxWorkers: 1,
      taskTimeoutMs: 2000,
      idleTimeoutMs: 30000,
    });
    try {
      await expect(
        busyPool.evaluate("(function(){ while(true) {} })()", {}),
      ).rejects.toThrow(/timed out/i);
      // The pool should recover with a fresh worker after terminating the hung one.
      const result = await busyPool.evaluate("1 + 1", {});
      expect(result).toBe(2);
    } finally {
      await busyPool.shutdown();
    }
  }, 15000);

  it("rejects invalid worker counts", () => {
    expect(
      () =>
        new ActionSandboxPool({
          minWorkers: 3,
          maxWorkers: 2,
          taskTimeoutMs: 1000,
          idleTimeoutMs: 30000,
        }),
    ).toThrow("minWorkers cannot exceed maxWorkers");
  });

  it("rejects pending tasks on shutdown", async () => {
    // Attach the assertion before shutdown() settles the promise, so vitest's
    // rejection handler is registered in the same microtask turn — otherwise
    // Node reports a (harmless but noisy) PromiseRejectionHandledWarning even
    // though the rejection is legitimately handled below.
    const assertion = expect(pool.evaluate("1 + 1", {})).rejects.toThrow();
    await pool.shutdown();
    await assertion;
  });
});
