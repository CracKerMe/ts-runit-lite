/**
 * Tests for Expression Engine v2 features:
 * - Lambda expressions
 * - Nested collection expressions
 * - Custom function registration
 */
import { beforeEach, describe, expect, it } from "vitest";
import { evaluate, validateExpression } from "../../engine/ExpressionEvaluator";
import {
  listCustomFunctions,
  registerCustomFunction,
  unregisterCustomFunction,
} from "../../engine/functions/customFunctions";

describe("ExpressionEvaluator advanced features", () => {
  // ─── Lambda expressions ───────────────────────────────────────────

  describe("Lambda expressions", () => {
    it("should evaluate single-param lambda with filter", () => {
      const context = {
        items: [1, 2, 3, 4, 5, 6],
      };
      const result = evaluate("filter(items, n => n > 3)", context);
      expect(result).toEqual([4, 5, 6]);
    });

    it("should evaluate single-param lambda with map", () => {
      const context = {
        items: [1, 2, 3],
      };
      const result = evaluate("map(items, n => n * 2)", context);
      expect(result).toEqual([2, 4, 6]);
    });

    it("should evaluate lambda with reduce", () => {
      const context = {
        items: [1, 2, 3, 4, 5],
      };
      const result = evaluate("reduce(items, (sum, n) => sum + n, 0)", context);
      expect(result).toEqual(15);
    });

    it("should evaluate lambda with find", () => {
      const context = {
        items: [
          { name: "alice", age: 25 },
          { name: "bob", age: 30 },
          { name: "charlie", age: 35 },
        ],
      };
      const result = evaluate("find(items, n => n.age > 28)", context);
      expect(result).toEqual({ name: "bob", age: 30 });
    });

    it("should evaluate lambda with some and every", () => {
      const context = { items: [2, 4, 6, 8] };
      expect(evaluate("every(items, n => n % 2 == 0)", context)).toBe(true);
      expect(evaluate("some(items, n => n > 5)", context)).toBe(true);
      expect(evaluate("every(items, n => n > 5)", context)).toBe(false);
    });

    it("should evaluate lambda accessing object properties", () => {
      const context = {
        orders: [
          { id: 1, amount: 100, status: "completed" },
          { id: 2, amount: 250, status: "pending" },
          { id: 3, amount: 50, status: "completed" },
        ],
      };
      const result = evaluate(
        "filter(orders, o => o.status == 'completed')",
        context,
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(3);
    });
  });

  // ─── Nested collection expressions ──────────────────────────────

  describe("Nested collection expressions", () => {
    it("should compose filter and map", () => {
      const context = {
        items: [
          { name: "a", active: true },
          { name: "b", active: false },
          { name: "c", active: true },
        ],
      };
      const names = evaluate(
        "map(filter(items, n => n.active), n => n.name)",
        context,
      );
      expect(names).toEqual(["a", "c"]);
    });
  });

  // ─── Custom function registration ────────────────────────────────

  describe("Custom function registration", () => {
    beforeEach(() => {
      // Clean up any leftover custom functions
      for (const fn of listCustomFunctions()) {
        unregisterCustomFunction(fn.name);
      }
    });

    it("should register and call a custom function", () => {
      registerCustomFunction("double", "n * 2", ["n"], "Doubles a number");

      const result = evaluate("double(21)", {});
      expect(result).toBe(42);
    });

    it("should register and call a multi-param custom function", () => {
      registerCustomFunction(
        "formatPrice",
        "amount * rate",
        ["amount", "rate"],
        "Converts price by rate",
      );

      const result = evaluate("formatPrice(100, 1.1)", {});
      expect(result).toBeCloseTo(110);
    });

    it("should list custom functions", () => {
      registerCustomFunction("fn1", "1", [], "test fn 1");
      registerCustomFunction("fn2", "2", [], "test fn 2");

      const list = listCustomFunctions();
      expect(list.length).toBeGreaterThanOrEqual(2);
      const names = list.map((f) => f.name);
      expect(names).toContain("fn1");
      expect(names).toContain("fn2");
    });

    it("should unregister a custom function", () => {
      registerCustomFunction("tempFn", "42", [], "temporary");
      expect(listCustomFunctions().some((f) => f.name === "tempFn")).toBe(true);

      unregisterCustomFunction("tempFn");
      expect(listCustomFunctions().some((f) => f.name === "tempFn")).toBe(
        false,
      );
    });

    it("should throw on duplicate registration without force", () => {
      registerCustomFunction("dupFn", "1", [], "dup");
      expect(() =>
        registerCustomFunction("dupFn", "2", [], "dup again"),
      ).toThrow("already registered");
    });

    it("should allow override with force=true", () => {
      registerCustomFunction("overFn", "1", [], "v1");
      registerCustomFunction("overFn", "2", [], "v2", true);
      expect(evaluate("overFn()", {})).toBe(2);
    });
  });

  // ─── Expression validation ──────────────────────────────────────

  describe("Expression validation", () => {
    it("should validate lambda syntax", () => {
      expect(validateExpression("filter(items, n => n > 0)").valid).toBe(true);
    });
  });
});
