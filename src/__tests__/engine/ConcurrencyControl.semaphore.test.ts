import { describe, expect, it } from "vitest";
import { ConcurrencyControl } from "../../engine/ConcurrencyControl";

describe("ConcurrencyControl – instance semaphore", () => {
  it("should refuse to register a start beyond maxConcurrentInstances", () => {
    // 回归守卫：registerInstanceStart 曾把 async 的 acquireSemaphore 返回值
    // `as unknown as boolean` 强转，实际返回 Promise——恒为真值，
    // 任何 `if (!control.registerInstanceStart())` 的判断都永远不成立。
    const control = new ConcurrencyControl({ maxConcurrentInstances: 2 });

    const results = [
      control.registerInstanceStart(),
      control.registerInstanceStart(),
      control.registerInstanceStart(),
    ];

    expect(results).toEqual([true, true, false]);
    // 显式断言返回的是 boolean 而不是 Promise
    for (const result of results) {
      expect(typeof result).toBe("boolean");
    }

    control.destroy();
  });

  it("should free a slot when an instance completes", () => {
    const control = new ConcurrencyControl({ maxConcurrentInstances: 1 });

    expect(control.registerInstanceStart()).toBe(true);
    expect(control.registerInstanceStart()).toBe(false);

    control.registerInstanceComplete();
    expect(control.registerInstanceStart()).toBe(true);

    control.destroy();
  });

  it("should keep canStartInstance consistent with registerInstanceStart", () => {
    const control = new ConcurrencyControl({ maxConcurrentInstances: 1 });

    expect(control.canStartInstance()).toBe(true);
    expect(control.registerInstanceStart()).toBe(true);
    expect(control.canStartInstance()).toBe(false);

    control.destroy();
  });

  it("should return a boolean from acquireSemaphore", () => {
    const control = new ConcurrencyControl({});

    const acquired = control.acquireSemaphore("custom", 1);
    expect(acquired).toBe(true);
    expect(control.acquireSemaphore("custom", 1)).toBe(false);

    control.releaseSemaphore("custom");
    expect(control.acquireSemaphore("custom", 1)).toBe(true);

    control.destroy();
  });
});
