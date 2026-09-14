import { afterEach, describe, expect, it } from "vitest";
import {
  ConcurrencyControl,
  destroyConcurrencyControl,
  getConcurrencyControl,
} from "../ConcurrencyControl";

describe("ConcurrencyControl – timer lifecycle", () => {
  afterEach(() => {
    destroyConcurrencyControl();
  });

  it("unrefs its cleanup interval so it cannot pin the process", () => {
    // 回归守卫：未 unref 的 interval 会让进程在 destroy() 后仍不退出，
    // 这正是测试套件挂起的原因。
    const control = new ConcurrencyControl({});
    const timer = (control as unknown as { cleanupInterval?: NodeJS.Timeout })
      .cleanupInterval;

    expect(timer).toBeDefined();
    // unref 过的定时器 hasRef() 为 false
    expect(timer?.hasRef?.()).toBe(false);

    control.destroy();
  });

  it("clears the interval on destroy", () => {
    const control = new ConcurrencyControl({});
    control.destroy();

    expect(
      (control as unknown as { cleanupInterval?: NodeJS.Timeout })
        .cleanupInterval,
    ).toBeUndefined();
  });

  it("destroys and resets the global singleton", () => {
    // 回归守卫：该单例此前从不销毁，WorkflowEngineV2.destroy() 也没碰它。
    const first = getConcurrencyControl();
    destroyConcurrencyControl();
    const second = getConcurrencyControl();

    expect(second).not.toBe(first);
    expect(
      (first as unknown as { cleanupInterval?: NodeJS.Timeout })
        .cleanupInterval,
    ).toBeUndefined();
  });
});
