import { describe, expect, it } from "vitest";
import { evaluate, validateExpression } from "../../engine/ExpressionEvaluator";

/**
 * 回归测试：`validateExpression` 是用空上下文真实求值的（并非纯语法检查），
 * 因此内置字符串函数必须能容忍 undefined 实参。
 *
 * 曾经的 bug：trim/toUpperCase/toLowerCase/substring/startsWith/endsWith
 * 直接在实参上取方法（`s.trim()`），校验阶段实参为 undefined 就抛
 * "Cannot read properties of undefined"，导致任何在 context 值上调用这些
 * 函数的合法工作流在注册阶段被判定为 INVALID_EXPRESSION 而无法创建。
 */
describe("string builtins survive empty-context validation", () => {
  const cases: string[] = [
    "trim(context.raw)",
    "toUpperCase(context.raw)",
    "toLowerCase(context.raw)",
    'startsWith(context.raw, "A")',
    'endsWith(context.raw, "z")',
    "substring(context.raw, 0, 2)",
    "toUpperCase(trim(context.raw))",
  ];

  for (const expr of cases) {
    it(`validates: ${expr}`, () => {
      expect(validateExpression(expr)).toEqual({ valid: true });
    });
  }

  it("still produces correct results with real values", () => {
    const context = { context: { raw: "  Alice  " } };
    expect(evaluate("trim(context.raw)", context)).toBe("Alice");
    expect(evaluate("toUpperCase(trim(context.raw))", context)).toBe("ALICE");
    expect(evaluate("toLowerCase(trim(context.raw))", context)).toBe("alice");
    expect(evaluate('startsWith(trim(context.raw), "Al")', context)).toBe(true);
    expect(evaluate('endsWith(trim(context.raw), "ce")', context)).toBe(true);
    expect(evaluate("substring(trim(context.raw), 0, 2)", context)).toBe("Al");
  });

  it("coerces missing values to an empty string instead of throwing", () => {
    expect(evaluate("trim(context.missing)", {})).toBe("");
    expect(evaluate("toUpperCase(context.missing)", {})).toBe("");
    expect(evaluate("substring(context.missing, 0, 2)", {})).toBe("");
  });
});
