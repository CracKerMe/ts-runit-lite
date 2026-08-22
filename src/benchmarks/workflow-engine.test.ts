/**
 * Performance benchmarks for ts-workflow-engine.
 *
 * Run with: npx vitest run benchmarks/workflow-engine.bench.ts
 *
 * Measures:
 *   - Workflow registration throughput
 *   - Instance start latency
 *   - Signal/Query/Update throughput
 *   - Concurrent instance handling
 *   - Memory usage under load
 */
import { describe, expect, it } from "vitest";
import { bootstrap } from "../bootstrap";
import type { WorkflowDefinition } from "../model/Workflow";

// Simple workflow for benchmarking
const simpleWorkflow: WorkflowDefinition = {
  id: "bench-simple",
  name: "Benchmark Simple Workflow",
  startNode: "start",
  nodes: {
    start: {
      id: "start",
      type: "action",
      config: { action: "console.log('hello')" },
      next: ["end"],
    },
    end: {
      id: "end",
      type: "action",
      config: { action: "console.log('done')" },
    },
  },
};

// Multi-node workflow
const multiNodeWorkflow: WorkflowDefinition = {
  id: "bench-multi",
  name: "Benchmark Multi-Node Workflow",
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
    step3: {
      id: "step3",
      type: "action",
      config: { action: "noop" },
      next: ["step4"],
    },
    step4: {
      id: "step4",
      type: "action",
      config: { action: "noop" },
      next: ["step5"],
    },
    step5: { id: "step5", type: "action", config: { action: "noop" } },
  },
};

describe("Workflow Engine Benchmarks", () => {
  let engine: Awaited<ReturnType<typeof bootstrap>>["engine"];

  it("bootstrap", async () => {
    const ctx = await bootstrap({
      skipValidation: true,
      skipGracefulShutdown: true,
    });
    engine = ctx.engine;
    expect(engine).toBeDefined();
  });

  describe("Workflow Registration", () => {
    it("should register workflows quickly", async () => {
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await engine.register({
          ...simpleWorkflow,
          id: `bench-reg-${i}`,
        });
      }

      const duration = performance.now() - start;
      const opsPerSec = (iterations / duration) * 1000;

      console.log(
        `\n  Workflow Registration: ${iterations} workflows in ${duration.toFixed(0)}ms`,
      );
      console.log(`  Throughput: ${opsPerSec.toFixed(0)} ops/sec`);
      console.log(`  Latency: ${(duration / iterations).toFixed(2)}ms/op`);

      expect(opsPerSec).toBeGreaterThan(50); // At least 50 ops/sec
    });
  });

  describe("Instance Start", () => {
    it("should start instances quickly", async () => {
      await engine.register(simpleWorkflow);
      const iterations = 100;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await engine.start("bench-simple", { iteration: i });
      }

      const duration = performance.now() - start;
      const opsPerSec = (iterations / duration) * 1000;

      console.log(
        `\n  Instance Start: ${iterations} instances in ${duration.toFixed(0)}ms`,
      );
      console.log(`  Throughput: ${opsPerSec.toFixed(0)} ops/sec`);
      console.log(`  Latency: ${(duration / iterations).toFixed(2)}ms/op`);

      expect(opsPerSec).toBeGreaterThan(20); // At least 20 ops/sec
    });

    it("should handle concurrent starts", async () => {
      await engine.register(simpleWorkflow);
      const concurrency = 50;
      const start = performance.now();

      const promises = Array.from({ length: concurrency }, (_, i) =>
        engine.start("bench-simple", { concurrent: i }),
      );

      await Promise.all(promises);

      const duration = performance.now() - start;
      const opsPerSec = (concurrency / duration) * 1000;

      console.log(
        `\n  Concurrent Start: ${concurrency} instances in ${duration.toFixed(0)}ms`,
      );
      console.log(`  Throughput: ${opsPerSec.toFixed(0)} ops/sec`);

      expect(opsPerSec).toBeGreaterThan(10); // At least 10 ops/sec under concurrency
    });
  });

  describe("Multi-Node Execution", () => {
    it("should execute multi-node workflows efficiently", async () => {
      await engine.register(multiNodeWorkflow);
      const iterations = 50;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        await engine.start("bench-multi", { iteration: i });
      }

      const duration = performance.now() - start;
      const opsPerSec = (iterations / duration) * 1000;

      console.log(
        `\n  Multi-Node Execution: ${iterations} workflows (5 nodes each) in ${duration.toFixed(0)}ms`,
      );
      console.log(`  Throughput: ${opsPerSec.toFixed(0)} ops/sec`);
      console.log(`  Total nodes executed: ${iterations * 5}`);
      console.log(
        `  Nodes/sec: ${(((iterations * 5) / duration) * 1000).toFixed(0)}`,
      );

      expect(opsPerSec).toBeGreaterThan(10);
    });
  });

  describe("Memory Usage", () => {
    it("should report memory usage", () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
      const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
      const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);

      console.log("\n  Memory Usage:");
      console.log(`  Heap Used: ${heapUsedMB} MB`);
      console.log(`  Heap Total: ${heapTotalMB} MB`);
      console.log(`  RSS: ${rssMB} MB`);

      // Should use less than 200MB heap for these benchmarks
      expect(memUsage.heapUsed).toBeLessThan(200 * 1024 * 1024);
    });
  });
});
