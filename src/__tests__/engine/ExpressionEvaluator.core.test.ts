import { describe, expect, it } from "vitest";
import { evaluate, registerFunction } from "../../engine/ExpressionEvaluator";

describe("ExpressionEvaluator core", () => {
  describe("Mathematical Operators", () => {
    it("should evaluate addition", () => {
      expect(evaluate("2 + 3")).toBe(5);
      expect(evaluate("10 + 20 + 30")).toBe(60);
    });

    it("should evaluate subtraction", () => {
      expect(evaluate("10 - 3")).toBe(7);
      expect(evaluate("100 - 50 - 25")).toBe(25);
    });

    it("should evaluate multiplication", () => {
      expect(evaluate("4 * 5")).toBe(20);
      expect(evaluate("2 * 3 * 4")).toBe(24);
    });

    it("should evaluate division", () => {
      expect(evaluate("20 / 4")).toBe(5);
      expect(evaluate("100 / 10 / 2")).toBe(5);
    });

    it("should evaluate modulo", () => {
      expect(evaluate("10 % 3")).toBe(1);
      expect(evaluate("17 % 5")).toBe(2);
    });

    it("should evaluate exponentiation", () => {
      expect(evaluate("2 ** 3")).toBe(8);
      expect(evaluate("5 ** 2")).toBe(25);
    });
  });

  describe("Operator Precedence", () => {
    it("should respect multiplication before addition", () => {
      expect(evaluate("2 + 3 * 4")).toBe(14); // Not 20
    });

    it("should respect exponentiation before multiplication", () => {
      expect(evaluate("2 * 3 ** 2")).toBe(18); // Not 36
    });

    it("should respect parentheses", () => {
      expect(evaluate("(2 + 3) * 4")).toBe(20);
      expect(evaluate("2 * (3 + 4)")).toBe(14);
    });

    it("should handle complex expressions", () => {
      expect(evaluate("2 + 3 * 4 - 5 / 5")).toBe(13);
      expect(evaluate("(2 + 3) * (4 - 1)")).toBe(15);
    });
  });

  describe("Comparison Operators", () => {
    it("should evaluate less than", () => {
      expect(evaluate("5 < 10")).toBe(true);
      expect(evaluate("10 < 5")).toBe(false);
    });

    it("should evaluate greater than", () => {
      expect(evaluate("10 > 5")).toBe(true);
      expect(evaluate("5 > 10")).toBe(false);
    });

    it("should evaluate less than or equal", () => {
      expect(evaluate("5 <= 10")).toBe(true);
      expect(evaluate("10 <= 10")).toBe(true);
      expect(evaluate("15 <= 10")).toBe(false);
    });

    it("should evaluate greater than or equal", () => {
      expect(evaluate("10 >= 5")).toBe(true);
      expect(evaluate("10 >= 10")).toBe(true);
      expect(evaluate("5 >= 10")).toBe(false);
    });

    it("should evaluate equality", () => {
      expect(evaluate("5 == 5")).toBe(true);
      expect(evaluate("5 == 10")).toBe(false);
      expect(evaluate("5 === 5")).toBe(true);
    });

    it("should evaluate inequality", () => {
      expect(evaluate("5 != 10")).toBe(true);
      expect(evaluate("5 != 5")).toBe(false);
      expect(evaluate("5 !== 10")).toBe(true);
    });
  });

  describe("Logical Operators", () => {
    it("should evaluate AND", () => {
      expect(evaluate("true && true")).toBe(true);
      expect(evaluate("true && false")).toBe(false);
      expect(evaluate("false && false")).toBe(false);
    });

    it("should evaluate OR", () => {
      expect(evaluate("true || false")).toBe(true);
      expect(evaluate("false || true")).toBe(true);
      expect(evaluate("false || false")).toBe(false);
    });

    it("should evaluate NOT", () => {
      expect(evaluate("!true")).toBe(false);
      expect(evaluate("!false")).toBe(true);
    });

    it("should respect logical operator precedence", () => {
      expect(evaluate("true || false && false")).toBe(true); // AND before OR
      expect(evaluate("(true || false) && false")).toBe(false);
    });
  });

  describe("Unary Operators", () => {
    it("should evaluate unary minus", () => {
      expect(evaluate("-5")).toBe(-5);
      expect(evaluate("-(3 + 2)")).toBe(-5);
      expect(evaluate("10 + -5")).toBe(5);
    });

    it("should evaluate unary NOT", () => {
      expect(evaluate("!true")).toBe(false);
      expect(evaluate("!(5 > 3)")).toBe(false);
    });
  });

  describe("Built-in Math Functions", () => {
    it("should evaluate abs", () => {
      expect(evaluate("abs(-5)")).toBe(5);
      expect(evaluate("abs(5)")).toBe(5);
    });

    it("should evaluate ceil", () => {
      expect(evaluate("ceil(4.3)")).toBe(5);
      expect(evaluate("ceil(4.9)")).toBe(5);
    });

    it("should evaluate floor", () => {
      expect(evaluate("floor(4.3)")).toBe(4);
      expect(evaluate("floor(4.9)")).toBe(4);
    });

    it("should evaluate round", () => {
      expect(evaluate("round(4.3)")).toBe(4);
      expect(evaluate("round(4.6)")).toBe(5);
    });

    it("should evaluate min", () => {
      expect(evaluate("min(5, 3, 8, 1)")).toBe(1);
    });

    it("should evaluate max", () => {
      expect(evaluate("max(5, 3, 8, 1)")).toBe(8);
    });

    it("should evaluate sqrt", () => {
      expect(evaluate("sqrt(16)")).toBe(4);
      expect(evaluate("sqrt(25)")).toBe(5);
    });

    it("should evaluate pow", () => {
      expect(evaluate("pow(2, 3)")).toBe(8);
      expect(evaluate("pow(5, 2)")).toBe(25);
    });
  });

  describe("Built-in String Functions", () => {
    it("should evaluate length", () => {
      expect(evaluate('length("hello")')).toBe(5);
      expect(evaluate('length("test")')).toBe(4);
    });

    it("should evaluate substring", () => {
      expect(evaluate('substring("hello", 0, 2)')).toBe("he");
      expect(evaluate('substring("world", 1, 4)')).toBe("orl");
    });

    it("should evaluate toLowerCase", () => {
      expect(evaluate('toLowerCase("HELLO")')).toBe("hello");
    });

    it("should evaluate toUpperCase", () => {
      expect(evaluate('toUpperCase("hello")')).toBe("HELLO");
    });

    it("should evaluate trim", () => {
      expect(evaluate('trim("  hello  ")')).toBe("hello");
    });

    it("should evaluate concat", () => {
      expect(evaluate('concat("hello", " ", "world")')).toBe("hello world");
    });

    it("should evaluate includes", () => {
      expect(evaluate('includes("hello world", "world")')).toBe(true);
      expect(evaluate('includes("hello", "xyz")')).toBe(false);
    });

    it("should evaluate startsWith", () => {
      expect(evaluate('startsWith("hello", "hel")')).toBe(true);
      expect(evaluate('startsWith("hello", "wor")')).toBe(false);
    });

    it("should evaluate endsWith", () => {
      expect(evaluate('endsWith("hello", "llo")')).toBe(true);
      expect(evaluate('endsWith("hello", "hel")')).toBe(false);
    });
  });

  describe("Built-in Date Functions", () => {
    it("should evaluate now", () => {
      const result = evaluate("now()");
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThan(0);
    });

    it("should evaluate parse", () => {
      const result = evaluate('parse("2024-01-01T00:00:00.000Z")');
      expect(typeof result).toBe("number");
    });

    it("should evaluate addDays", () => {
      const timestamp = Date.parse("2024-01-01T00:00:00.000Z");
      const result = evaluate(`addDays(${timestamp}, 1)`);
      expect(result).toBe(timestamp + 24 * 60 * 60 * 1000);
    });

    it("should evaluate addHours", () => {
      const timestamp = Date.parse("2024-01-01T00:00:00.000Z");
      const result = evaluate(`addHours(${timestamp}, 2)`);
      expect(result).toBe(timestamp + 2 * 60 * 60 * 1000);
    });

    it("should evaluate diff", () => {
      const t1 = Date.parse("2024-01-02T00:00:00.000Z");
      const t2 = Date.parse("2024-01-01T00:00:00.000Z");
      const result = evaluate(`diff(${t1}, ${t2}, "d")`);
      expect(result).toBe(1);
    });
  });

  describe("Built-in Array Functions", () => {
    it("should evaluate join", () => {
      const context = { arr: [1, 2, 3] };
      expect(evaluate('join(arr, ",")', context)).toBe("1,2,3");
    });

    it("should evaluate includes for arrays", () => {
      const context = { arr: [1, 2, 3] };
      expect(evaluate("includes(arr, 2)", context)).toBe(true);
      expect(evaluate("includes(arr, 5)", context)).toBe(false);
    });
  });

  describe("Context Variables", () => {
    it("should access context variables", () => {
      const context = { x: 10, y: 20 };
      expect(evaluate("x + y", context)).toBe(30);
    });

    it("should access nested context variables", () => {
      const context = { user: { age: 25 } };
      expect(evaluate("user.age", context)).toBe(25);
    });

    it("should handle missing variables", () => {
      const context = {};
      expect(evaluate("missing", context)).toBeUndefined();
    });
  });

  describe("Custom Functions", () => {
    it("should register and use custom functions", () => {
      registerFunction("double", (x: number) => x * 2);
      expect(evaluate("double(5)")).toBe(10);
    });

    it("should register functions with multiple arguments", () => {
      registerFunction("add3", (a: number, b: number, c: number) => a + b + c);
      expect(evaluate("add3(1, 2, 3)")).toBe(6);
    });
  });

  describe("Complex Expressions", () => {
    it("should evaluate complex mathematical expressions", () => {
      expect(evaluate("(2 + 3) * 4 - 10 / 2")).toBe(15);
    });

    it("should evaluate complex logical expressions", () => {
      expect(evaluate("(5 > 3) && (10 < 20) || false")).toBe(true);
    });

    it("should combine functions and operators", () => {
      expect(evaluate("abs(-5) + max(3, 7) * 2")).toBe(19);
    });

    it("should evaluate expressions with context and functions", () => {
      const context = { x: 10 };
      expect(evaluate("sqrt(x) + abs(-5)", context)).toBeCloseTo(8.162, 2);
    });
  });
});
