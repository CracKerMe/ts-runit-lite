/**
 * Load Tests - High Concurrency Scenarios
 */
import { describe, expect, it } from "vitest";
import { bootstrap } from "../bootstrap";
import type { WorkflowDefinition } from "../model/Workflow";

const stressWorkflow: WorkflowDefinition = {
  id: "load-stress",
  name: "Load Test Workflow",
  startNode: "step1",
  nodes: {
    step1: {
      id: "step1",
      type: "action",
      config: { action: "noop" },
      next: ["step2"],
    },
    step2: {
      id: "step2",
      type: "action",
      config: { action: "noop" },
      next: ["step3"],
    },
    step3: { id: "step3", type: "action", config: { action: "noop" } },
  },
};

describe("Load Tests", () => {
  let engine: Awaited<ReturnType<typeof bootstrap>>["engine"];

  it("bootstrap", async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    await engine.register(stressWorkflow);
  });

  it("200 concurrent starts", async () => {
    const concurrency = 200;
    const start = performance.now();

    const results = await Promise.allSettled(
      Array.from({ length: concurrency }, (_, i) =>
        engine.start("load-stress", { i }),
      ),
    );

    const duration = performance.now() - start;
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    console.log("\n  200 Concurrent Starts:");
    console.log(`  Duration: ${duration.toFixed(0)}ms`);
    console.log(`  Succeeded: ${succeeded}/${concurrency}`);
    console.log(
      `  Throughput: ${((concurrency / duration) * 1000).toFixed(0)} ops/sec`,
    );

    expect(succeeded).toBe(concurrency);
  });

  it("300 batch operations with 0% error rate", async () => {
    const total = 300;
    const batchSize = 50;
    let errors = 0;

    for (let batch = 0; batch < total / batchSize; batch++) {
      const results = await Promise.allSettled(
        Array.from({ length: batchSize }, (_, i) =>
          engine.start("load-stress", { batch, i }),
        ),
      );
      errors += results.filter((r) => r.status === "rejected").length;
    }

    const errorRate = (errors / total) * 100;
    console.log("\n  300 Batch Operations:");
    console.log(`  Errors: ${errors}/${total}`);
    console.log(`  Error rate: ${errorRate.toFixed(2)}%`);

    expect(errorRate).toBe(0);
  });

  it("memory stability under load", async () => {
    const memBefore = process.memoryUsage().heapUsed;

    // Run 100 operations
    await Promise.all(
      Array.from({ length: 100 }, (_, i) => engine.start("load-stress", { i })),
    );

    if (globalThis.gc) globalThis.gc();
    const memAfter = process.memoryUsage().heapUsed;
    const memDeltaMB = (memAfter - memBefore) / 1024 / 1024;

    console.log("\n  Memory Stability:");
    console.log(`  Delta: ${memDeltaMB.toFixed(2)} MB for 100 instances`);

    expect(memDeltaMB).toBeLessThan(20);
  });
});
