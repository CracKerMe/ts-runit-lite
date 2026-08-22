import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerPool } from "../WorkerPool";

describe("WorkerPool", () => {
  let pool: WorkerPool;

  beforeEach(() => {
    pool = new WorkerPool({
      minWorkers: 2,
      maxWorkers: 4,
      taskTimeout: 5000,
      idleTimeout: 30000,
    });
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  it("should initialize with min workers", () => {
    const stats = pool.getStats();
    expect(stats.total).toBe(2);
    expect(stats.busy).toBe(0);
    expect(stats.idle).toBe(2);
  });

  it("should report correct stats", () => {
    const stats = pool.getStats();
    expect(stats).toHaveProperty("total");
    expect(stats).toHaveProperty("busy");
    expect(stats).toHaveProperty("idle");
    expect(stats).toHaveProperty("queued");
  });

  it("should reject invalid worker counts", () => {
    expect(
      () =>
        new WorkerPool({
          minWorkers: 3,
          maxWorkers: 2,
          taskTimeout: 5000,
          idleTimeout: 30000,
        }),
    ).toThrow("minWorkers cannot exceed maxWorkers");
  });
});
