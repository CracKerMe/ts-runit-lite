import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  getNestedValue,
  resolveConditionalNext,
  validateExpression,
} from "../../engine/ExpressionEvaluator";

describe("ExpressionEvaluator", () => {
  describe("getNestedValue", () => {
    const obj = {
      user: {
        name: "Alice",
        age: 30,
        address: {
          city: "Beijing",
        },
      },
      items: [1, 2, 3],
    };

    it("should get top-level values", () => {
      expect(getNestedValue(obj, "user")).toEqual(obj.user);
    });

    it("should get nested values", () => {
      expect(getNestedValue(obj, "user.name")).toBe("Alice");
      expect(getNestedValue(obj, "user.address.city")).toBe("Beijing");
    });

    it("should return undefined for non-existent paths", () => {
      expect(getNestedValue(obj, "user.email")).toBeUndefined();
      expect(getNestedValue(obj, "nonexistent")).toBeUndefined();
    });
  });

  describe("evaluateCondition", () => {
    const context = {
      amount: 1500,
      status: "approved",
      user: { role: "admin", level: 5 },
      items: [1, 2, 3],
      enabled: true,
    };

    it("should evaluate comparison operators", () => {
      expect(evaluateCondition("amount > 1000", context)).toBe(true);
      expect(evaluateCondition("amount < 1000", context)).toBe(false);
      expect(evaluateCondition("amount >= 1500", context)).toBe(true);
      expect(evaluateCondition("amount <= 1500", context)).toBe(true);
      expect(evaluateCondition("amount == 1500", context)).toBe(true);
      expect(evaluateCondition("amount != 1000", context)).toBe(true);
    });

    it("should evaluate string comparisons", () => {
      expect(evaluateCondition('status == "approved"', context)).toBe(true);
      expect(evaluateCondition("status == 'approved'", context)).toBe(true);
      expect(evaluateCondition('status != "rejected"', context)).toBe(true);
    });

    it("should evaluate nested property access", () => {
      expect(evaluateCondition('user.role == "admin"', context)).toBe(true);
      expect(evaluateCondition("user.level > 3", context)).toBe(true);
    });

    it("should evaluate boolean values", () => {
      expect(evaluateCondition("enabled == true", context)).toBe(true);
      expect(evaluateCondition("enabled != false", context)).toBe(true);
    });

    it("should evaluate logical operators", () => {
      expect(
        evaluateCondition('amount > 1000 && status == "approved"', context),
      ).toBe(true);
      expect(
        evaluateCondition('amount < 1000 || status == "approved"', context),
      ).toBe(true);
      expect(
        evaluateCondition('amount < 1000 && status == "approved"', context),
      ).toBe(false);
    });

    it("should return false for invalid expressions", () => {
      expect(evaluateCondition("invalid syntax !!!", context)).toBe(false);
      expect(evaluateCondition("", context)).toBe(false);
    });
  });

  describe("validateExpression", () => {
    it("should validate correct expressions", () => {
      expect(validateExpression("amount > 100").valid).toBe(true);
      expect(validateExpression('status == "active"').valid).toBe(true);
      expect(validateExpression("a > 1 && b < 2").valid).toBe(true);
    });

    it("should reject dangerous patterns", () => {
      const result1 = validateExpression('eval("code")');
      expect(result1.valid).toBe(false);

      const result2 = validateExpression('Function("code")');
      expect(result2.valid).toBe(false);
    });

    it("should reject empty expressions", () => {
      expect(validateExpression("").valid).toBe(false);
      expect(validateExpression("   ").valid).toBe(false);
    });
  });

  describe("resolveConditionalNext", () => {
    const conditionalNext = [
      { condition: "amount > 1000", target: "high_value" },
      { condition: "amount > 500", target: "medium_value" },
      { condition: "amount > 0", target: "low_value" },
    ];

    it("should return first matching target", () => {
      // Note: resolveConditionalNext signature is (conditionalNext, defaultNext, context)
      expect(
        resolveConditionalNext(conditionalNext, "default", { amount: 1500 }),
      ).toBe("high_value");
      expect(
        resolveConditionalNext(conditionalNext, "default", { amount: 800 }),
      ).toBe("medium_value");
      expect(
        resolveConditionalNext(conditionalNext, "default", { amount: 100 }),
      ).toBe("low_value");
    });

    it("should return default when no condition matches", () => {
      expect(
        resolveConditionalNext(conditionalNext, "default", { amount: -10 }),
      ).toBe("default");
    });

    it("should return null when no default and no match", () => {
      expect(
        resolveConditionalNext(conditionalNext, undefined, { amount: -10 }),
      ).toBeNull();
    });
  });
});
