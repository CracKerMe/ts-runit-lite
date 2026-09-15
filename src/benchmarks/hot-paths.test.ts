// oxlint-disable no-explicit-any -- benchmark file uses dynamic shapes
import { describe, expect, it } from "vitest";
import {
  clearExpressionCache,
  evaluate,
  getExpressionCacheStats,
} from "../engine/ExpressionEvaluator";
import type { WorkflowInstance } from "../model/Instance";
import { MemoryStorage } from "../storage/MemoryStorage";

/**
 * 针对 Phase 2 两处热点改动的基准：
 *   1. 表达式 token 缓存（ExpressionEvaluator）
 *   2. structuredClone + 去掉读路径重复归一化（MemoryStorage）
 *
 * 断言刻意放宽——这里的目的是产出可对比的数字并守住"没有严重劣化"的底线，
 * 而不是把 CI 绑死在某个绝对耗时上。真正的收益看打印出来的 ops/s。
 */

function timeIt(label: string, iterations: number, fn: () => void): number {
  // 预热，让 JIT 先稳定下来
  for (let i = 0; i < Math.min(iterations, 1000); i++) fn();

  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const opsPerSec = Math.round((iterations / elapsedMs) * 1000);
  console.log(
    `  ${label}: ${elapsedMs.toFixed(1)}ms for ${iterations} ops ` +
      `(${opsPerSec.toLocaleString()} ops/s)`,
  );
  return elapsedMs;
}

describe("ExpressionEvaluator — token cache", () => {
  const EXPRESSION = "order.amount * 1.1 + max(base, 10) - discount";
  const ITERATIONS = 20_000;

  const context = {
    order: { amount: 100 },
    base: 5,
    discount: 3,
  };

  it("evaluates a repeated expression efficiently", () => {
    clearExpressionCache();

    const elapsed = timeIt("cached evaluate", ITERATIONS, () => {
      evaluate(EXPRESSION, context);
    });

    // 2 万次求值只产生一个缓存条目——证明确实命中而非反复重建
    expect(getExpressionCacheStats().size).toBe(1);

    // 2 万次求值应远低于 5 秒；这是防劣化下限，不是性能目标
    expect(elapsed).toBeLessThan(5000);
  });

  it("produces identical results on cache hit and miss", () => {
    clearExpressionCache();
    const cold = evaluate(EXPRESSION, context);
    const warm = evaluate(EXPRESSION, context);

    expect(warm).toBe(cold);
    expect(warm).toBeCloseTo(100 * 1.1 + 10 - 3, 10);
  });

  it("re-evaluates against a changing context, not a memoised result", () => {
    clearExpressionCache();

    const a = evaluate("n * 2", { n: 5 });
    const b = evaluate("n * 2", { n: 50 });

    expect(a).toBe(10);
    expect(b).toBe(100);
  });

  it("bounds the cache under dynamically generated expressions", () => {
    clearExpressionCache();

    for (let i = 0; i < 5000; i++) {
      evaluate(`${i} + 1`, {});
    }

    const stats = getExpressionCacheStats();
    expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
  });
});

describe("MemoryStorage — instance clone throughput", () => {
  function makeInstance(historyLength: number): WorkflowInstance {
    return {
      instanceId: "bench-1",
      workflowId: "wf-bench",
      currentNodes: ["node-1"],
      status: "running",
      context: {
        payload: { items: Array.from({ length: 20 }, (_, i) => ({ i })) },
      },
      history: Array.from({ length: historyLength }, (_, i) => ({
        timestamp: new Date(1_700_000_000_000 + i),
        nodeId: `node-${i}`,
        status: "completed",
        message: `step ${i}`,
      })) as any,
      createdAt: new Date(1_700_000_000_000),
      updatedAt: new Date(1_700_000_000_000),
      retries: {},
      state: { nodes: {} },
    };
  }

  it("saves instances with a growing history at reasonable throughput", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    const instance = makeInstance(200);

    const started = process.hrtime.bigint();
    const ITERATIONS = 2000;
    for (let i = 0; i < ITERATIONS; i++) {
      await storage.saveInstance(instance);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
      `  saveInstance (history=200): ${elapsedMs.toFixed(1)}ms for ${ITERATIONS} ops ` +
        `(${Math.round((ITERATIONS / elapsedMs) * 1000).toLocaleString()} ops/s)`,
    );

    expect(elapsedMs).toBeLessThan(10_000);
  });

  it("loads instances at reasonable throughput", async () => {
    const storage = new MemoryStorage();
    await storage.connect();
    await storage.saveInstance(makeInstance(200));

    const started = process.hrtime.bigint();
    const ITERATIONS = 2000;
    for (let i = 0; i < ITERATIONS; i++) {
      await storage.loadInstance("bench-1");
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
      `  loadInstance (history=200): ${elapsedMs.toFixed(1)}ms for ${ITERATIONS} ops ` +
        `(${Math.round((ITERATIONS / elapsedMs) * 1000).toLocaleString()} ops/s)`,
    );

    expect(elapsedMs).toBeLessThan(10_000);
  });

  it("queries a large instance set at reasonable throughput", async () => {
    const storage = new MemoryStorage();
    await storage.connect();

    for (let i = 0; i < 5000; i++) {
      await storage.saveInstance({
        ...makeInstance(0),
        instanceId: `inst-${i}`,
        workflowId: i % 10 === 0 ? "wf-hot" : "wf-cold",
        status: i % 3 === 0 ? "completed" : "running",
      });
    }

    const started = process.hrtime.bigint();
    const ITERATIONS = 200;
    for (let i = 0; i < ITERATIONS; i++) {
      await storage.queryInstances({
        workflowId: "wf-hot",
        status: "running",
        page: 1,
        pageSize: 50,
      });
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
      `  queryInstances (5000 stored): ${elapsedMs.toFixed(1)}ms for ${ITERATIONS} ops ` +
        `(${Math.round((ITERATIONS / elapsedMs) * 1000).toLocaleString()} ops/s)`,
    );

    expect(elapsedMs).toBeLessThan(30_000);
  });
});
