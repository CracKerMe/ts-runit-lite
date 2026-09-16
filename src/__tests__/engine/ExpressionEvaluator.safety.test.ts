// oxlint-disable no-explicit-any -- test exercises dynamic/hostile shapes
import { describe, expect, it } from "vitest";
import {
  clearExpressionCache,
  evaluate,
  getExpressionCacheStats,
  InterpolationDepthError,
  interpolateObject,
  MAX_INTERPOLATION_DEPTH,
} from "../../engine/ExpressionEvaluator";

/**
 * 回归测试：
 *  - interpolateObject 必须对循环引用与超深嵌套抛出可捕获的错误，
 *    而不是栈溢出（栈溢出会直接终止进程，节点错误处理接不住）。
 *  - token 缓存必须只影响性能，不影响求值结果。
 */

describe("interpolateObject — recursion safety", () => {
  it("throws a catchable error on a self-referential object", () => {
    const cyclic: any = { name: "root" };
    cyclic.self = cyclic;

    expect(() => interpolateObject(cyclic, {})).toThrow(
      InterpolationDepthError,
    );
  });

  it("throws on an indirect cycle", () => {
    const a: any = { name: "a" };
    const b: any = { name: "b", a };
    a.b = b;

    expect(() => interpolateObject(a, {})).toThrow(InterpolationDepthError);
  });

  it("throws on a cycle reached through an array", () => {
    const arr: any[] = [];
    arr.push({ items: arr });

    expect(() => interpolateObject(arr, {})).toThrow(InterpolationDepthError);
  });

  it("throws rather than overflowing on excessive nesting depth", () => {
    let deep: any = { leaf: true };
    for (let i = 0; i < MAX_INTERPOLATION_DEPTH + 20; i++) {
      deep = { nested: deep };
    }

    expect(() => interpolateObject(deep, {})).toThrow(InterpolationDepthError);
  });

  it("allows the same object to appear multiple times as a DAG", () => {
    // 同一个对象在树中多处出现是合法的，只有真正的环才应报错
    const shared = { value: "${name}" };
    const input = { first: shared, second: shared };

    const result = interpolateObject(input, { name: "ok" }) as any;

    expect(result.first.value).toBe("ok");
    expect(result.second.value).toBe("ok");
  });

  it("still interpolates normal nested structures", () => {
    const input = {
      a: "${user.name}",
      b: { c: ["${user.age}", "static"] },
      d: 42,
      e: null,
    };

    const result = interpolateObject(input, {
      user: { name: "Ada", age: 36 },
    }) as any;

    expect(result.a).toBe("Ada");
    expect(result.b.c).toEqual(["36", "static"]);
    expect(result.d).toBe(42);
    expect(result.e).toBeNull();
  });

  it("handles nesting just under the depth limit", () => {
    let deep: any = { leaf: "${v}" };
    for (let i = 0; i < MAX_INTERPOLATION_DEPTH - 5; i++) {
      deep = { nested: deep };
    }

    expect(() => interpolateObject(deep, { v: "x" })).not.toThrow();
  });
});

describe("expression token cache — correctness", () => {
  it("returns the same result on a cache hit as on a miss", () => {
    clearExpressionCache();
    const expr = "a * 2 + b";

    const cold = evaluate(expr, { a: 3, b: 4 });
    const warm = evaluate(expr, { a: 3, b: 4 });

    expect(cold).toBe(10);
    expect(warm).toBe(cold);
  });

  it("re-evaluates against the current context rather than memoising results", () => {
    clearExpressionCache();

    expect(evaluate("n + 1", { n: 1 })).toBe(2);
    expect(evaluate("n + 1", { n: 100 })).toBe(101);
    expect(evaluate("n + 1", { n: -5 })).toBe(-4);
  });

  it("keeps lambdas correct across repeated evaluation", () => {
    clearExpressionCache();
    const expr = "filter(items, x => x > 2)";

    const first = evaluate(expr, { items: [1, 2, 3, 4] });
    const second = evaluate(expr, { items: [5, 1, 9] });

    expect(first).toEqual([3, 4]);
    expect(second).toEqual([5, 9]);
  });

  it("caches the expression string, growing by one per distinct expression", () => {
    clearExpressionCache();

    evaluate("1 + 1", {});
    evaluate("1 + 1", {});
    evaluate("2 + 2", {});

    expect(getExpressionCacheStats().size).toBe(2);
  });

  it("stays within its configured bound", () => {
    clearExpressionCache();

    for (let i = 0; i < 3000; i++) {
      evaluate(`${i} + 1`, {});
    }

    const stats = getExpressionCacheStats();
    expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
  });

  it("still reports syntax errors on a cached-path expression", () => {
    clearExpressionCache();

    expect(() => evaluate("1 +", {})).toThrow();
    // 第二次同样应该抛错，而不是因为缓存变成静默成功
    expect(() => evaluate("1 +", {})).toThrow();
  });
});
