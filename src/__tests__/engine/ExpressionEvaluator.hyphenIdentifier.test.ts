import { describe, expect, it } from "vitest";
import { evaluate } from "../../engine/ExpressionEvaluator";

/**
 * 回归测试：连字符节点 id 在表达式中的解析。
 *
 * 曾经的 bug：tokenizer 不把 '-' 收进标识符，`check-stock.output.ok`
 * 被切成 `check` `-` `stock.output.ok` 当作减法，两边都不存在时求值成
 * NaN，JSON 序列化后变成 null——不报错、不可见，排查成本极高。
 *
 * 修复策略是"紧邻 + 上下文中存在"才合并，因此必须同时保证：
 * 合法的减法（尤其是 `a - b`）语义完全不变。
 */
describe("hyphenated node ids in expressions", () => {
  const ctx = {
    "check-stock": { output: { ok: true, qty: 7 } },
    "first-done": { output: { results: { a: 1 }, missing: [] } },
    "a-b-c": { value: 42 },
    plain: { output: { n: 5 } },
    a: 10,
    b: 3,
    c: 2,
  };

  it("resolves a hyphenated node id instead of silently producing NaN", () => {
    expect(evaluate("check-stock.output.ok", ctx)).toBe(true);
    expect(evaluate("check-stock.output.qty", ctx)).toBe(7);
  });

  it("resolves multi-hyphen ids", () => {
    expect(evaluate("a-b-c.value", ctx)).toBe(42);
  });

  it("works inside function calls and comparisons", () => {
    expect(evaluate("check-stock.output.qty > 5", ctx)).toBe(true);
    expect(evaluate("round(check-stock.output.qty * 2, 0)", ctx)).toBe(14);
    expect(evaluate("length(first-done.output.missing)", ctx)).toBe(0);
  });

  it("still treats spaced hyphens as subtraction", () => {
    expect(evaluate("a - b", ctx)).toBe(7);
    expect(evaluate("a - b - c", ctx)).toBe(5);
    expect(evaluate("a - b * c", ctx)).toBe(4);
  });

  it("still subtracts when the merged name does not exist in context", () => {
    // 没有名为 "a-b" 的键，必须退回减法而不是变成 undefined。
    // 注意 ctx 里存在 "a-b-c"，所以这里用 a/b/c 之外的键来验证回退。
    const nums = { a: 10, b: 3, c: 2 };
    expect(evaluate("a-b", nums)).toBe(7);
    expect(evaluate("a-b-c", nums)).toBe(5);
  });

  it("prefers a real hyphenated key over subtraction when both are possible", () => {
    // ctx 同时有 a=10,b=3,c=2 和 "a-b-c"；已存在的键优先，避免静默 NaN
    expect(evaluate("a-b-c.value", ctx)).toBe(42);
    // 但拼不出已知键时仍然是减法
    expect(evaluate("a-c", ctx)).toBe(8);
  });

  it("does not break unrelated arithmetic or plain identifiers", () => {
    expect(evaluate("10 - 3", ctx)).toBe(7);
    expect(evaluate("plain.output.n", ctx)).toBe(5);
    expect(evaluate("-b", ctx)).toBe(-3);
    expect(evaluate("a - -b", ctx)).toBe(13);
  });
});
