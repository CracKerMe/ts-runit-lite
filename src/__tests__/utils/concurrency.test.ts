import { describe, expect, it } from "vitest";
import {
  forEachWithConcurrency,
  mapWithConcurrency,
} from "../../utils/concurrency";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const input = [5, 1, 4, 2, 3];

    const results = await mapWithConcurrency(
      input,
      async (n) => {
        // 故意让先入队的任务耗时更久，若实现按完成顺序收集就会乱序
        await tick(n);
        return n * 2;
      },
      3,
    );

    expect(results).toEqual([10, 2, 8, 4, 6]);
  });

  it("passes the element index to the worker", async () => {
    const seen: Array<[string, number]> = [];

    await mapWithConcurrency(
      ["a", "b", "c"],
      async (item, index) => {
        seen.push([item, index]);
      },
      1,
    );

    expect(seen).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(1);
        inFlight--;
      },
      4,
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // 确实是并发，不是退化成串行
  });

  it("actually runs concurrently (faster than serial)", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);

    const started = Date.now();
    await mapWithConcurrency(items, async () => tick(10), 10);
    const elapsed = Date.now() - started;

    // 串行需要 ~200ms；并发度 10 应该在 ~20ms 量级。
    // 阈值放宽到 150ms 以避免 CI 抖动导致偶发失败。
    expect(elapsed).toBeLessThan(150);
  });

  it("returns an empty array for empty input without invoking the worker", async () => {
    let called = false;

    const results = await mapWithConcurrency([], async () => {
      called = true;
    });

    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("handles a concurrency limit larger than the input length", async () => {
    const results = await mapWithConcurrency([1, 2], async (n) => n, 100);
    expect(results).toEqual([1, 2]);
  });

  it("normalises a non-positive concurrency to serial execution", async () => {
    let peak = 0;
    let inFlight = 0;

    await mapWithConcurrency(
      [1, 2, 3, 4],
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await tick(1);
        inFlight--;
      },
      0,
    );

    expect(peak).toBe(1);
  });

  it("rejects when a worker throws, like Promise.all", async () => {
    await expect(
      mapWithConcurrency(
        [1, 2, 3],
        async (n) => {
          if (n === 2) throw new Error("boom");
          return n;
        },
        2,
      ),
    ).rejects.toThrow("boom");
  });
});

describe("forEachWithConcurrency", () => {
  it("visits every item", async () => {
    const seen: number[] = [];

    await forEachWithConcurrency(
      [1, 2, 3, 4, 5],
      async (n) => {
        seen.push(n);
      },
      2,
    );

    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
