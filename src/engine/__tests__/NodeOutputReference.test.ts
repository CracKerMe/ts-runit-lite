import { describe, expect, it } from "vitest";
import {
  interpolateExpressions,
  interpolateObject,
  resolveNodeOutput,
} from "../ExpressionEvaluator";

describe("Node Output Reference", () => {
  describe("resolveNodeOutput", () => {
    const state = {
      nodes: {
        step1: {
          output: {
            result: 42,
            user: { name: "Alice", age: 30 },
            items: [1, 2, 3],
          },
        },
        step2: {
          output: "simple string",
        },
        step3: {
          output: null,
        },
        step4: {
          // no output property
        },
      },
    };

    it("should resolve node output without path", () => {
      const result = resolveNodeOutput("step1", undefined, state);
      expect(result).toEqual({
        result: 42,
        user: { name: "Alice", age: 30 },
        items: [1, 2, 3],
      });
    });

    it("should resolve nested output path", () => {
      expect(resolveNodeOutput("step1", "result", state)).toBe(42);
      expect(resolveNodeOutput("step1", "user.name", state)).toBe("Alice");
      expect(resolveNodeOutput("step1", "user.age", state)).toBe(30);
    });

    it("should resolve simple string output", () => {
      expect(resolveNodeOutput("step2", undefined, state)).toBe(
        "simple string",
      );
    });

    it("should return undefined for non-existent node", () => {
      expect(
        resolveNodeOutput("nonexistent", undefined, state),
      ).toBeUndefined();
    });

    it("should return undefined for non-existent path", () => {
      expect(resolveNodeOutput("step1", "nonexistent", state)).toBeUndefined();
      expect(resolveNodeOutput("step1", "user.email", state)).toBeUndefined();
    });

    it("should return undefined for node without output", () => {
      expect(resolveNodeOutput("step4", undefined, state)).toBeUndefined();
      expect(resolveNodeOutput("step4", "anything", state)).toBeUndefined();
    });

    it("should handle null output", () => {
      expect(resolveNodeOutput("step3", undefined, state)).toBeNull();
    });

    it("should return undefined when accessing path on non-object", () => {
      expect(resolveNodeOutput("step2", "length", state)).toBeUndefined();
    });

    it("should return undefined when state is undefined", () => {
      expect(resolveNodeOutput("step1", "result", undefined)).toBeUndefined();
    });

    it("should return undefined when state.nodes is undefined", () => {
      expect(resolveNodeOutput("step1", "result", {})).toBeUndefined();
    });
  });

  describe("interpolateExpressions", () => {
    const context = {
      userId: "user123",
      amount: 1000,
    };

    const state = {
      nodes: {
        step1: {
          output: {
            result: 42,
            message: "Success",
          },
        },
        step2: {
          output: {
            data: {
              value: 100,
            },
          },
        },
      },
    };

    it("should interpolate node output references", () => {
      expect(
        interpolateExpressions(
          "Result is ${step1.output.result}",
          context,
          state,
        ),
      ).toBe("Result is 42");

      expect(
        interpolateExpressions(
          "Message: ${step1.output.message}",
          context,
          state,
        ),
      ).toBe("Message: Success");
    });

    it("should interpolate nested output paths", () => {
      expect(
        interpolateExpressions(
          "Value: ${step2.output.data.value}",
          context,
          state,
        ),
      ).toBe("Value: 100");
    });

    it("should interpolate context variables", () => {
      expect(interpolateExpressions("User: ${userId}", context, state)).toBe(
        "User: user123",
      );

      expect(interpolateExpressions("Amount: ${amount}", context, state)).toBe(
        "Amount: 1000",
      );
    });

    it("should interpolate mixed references", () => {
      expect(
        interpolateExpressions(
          "User ${userId} got ${step1.output.result} points",
          context,
          state,
        ),
      ).toBe("User user123 got 42 points");
    });

    it("should keep placeholder when output not found", () => {
      expect(
        interpolateExpressions(
          "Missing: ${step99.output.value}",
          context,
          state,
        ),
      ).toBe("Missing: ${step99.output.value}");
    });

    it("should keep placeholder when path not found", () => {
      expect(
        interpolateExpressions(
          "Missing: ${step1.output.nonexistent}",
          context,
          state,
        ),
      ).toBe("Missing: ${step1.output.nonexistent}");
    });

    it("should handle multiple references in one string", () => {
      expect(
        interpolateExpressions(
          "${step1.output.result} + ${step2.output.data.value} = ${amount}",
          context,
          state,
        ),
      ).toBe("42 + 100 = 1000");
    });

    it("should work without state", () => {
      expect(interpolateExpressions("User: ${userId}", context)).toBe(
        "User: user123",
      );
    });

    it("should handle empty string", () => {
      expect(interpolateExpressions("", context, state)).toBe("");
    });

    it("should handle string without placeholders", () => {
      expect(
        interpolateExpressions("No placeholders here", context, state),
      ).toBe("No placeholders here");
    });
  });

  describe("interpolateObject", () => {
    const context = {
      userId: "user123",
      status: "active",
    };

    const state = {
      nodes: {
        step1: {
          output: {
            result: 42,
            data: { value: 100 },
          },
        },
      },
    };

    it("should interpolate string values", () => {
      const obj = {
        message: "User ${userId} has result ${step1.output.result}",
      };

      const result = interpolateObject(obj, context, state);
      expect(result).toEqual({
        message: "User user123 has result 42",
      });
    });

    it("should interpolate nested objects", () => {
      const obj = {
        user: {
          id: "${userId}",
          status: "${status}",
        },
        result: "${step1.output.result}",
      };

      const result = interpolateObject(obj, context, state);
      expect(result).toEqual({
        user: {
          id: "user123",
          status: "active",
        },
        result: "42",
      });
    });

    it("should interpolate arrays", () => {
      const obj = {
        items: ["${userId}", "${step1.output.result}", "literal"],
      };

      const result = interpolateObject(obj, context, state);
      expect(result).toEqual({
        items: ["user123", "42", "literal"],
      });
    });

    it("should preserve non-string values", () => {
      const obj = {
        number: 123,
        boolean: true,
        null: null,
        undefined: undefined,
      };

      const result = interpolateObject(obj, context, state);
      expect(result).toEqual(obj);
    });

    it("should handle complex nested structures", () => {
      const obj = {
        user: {
          id: "${userId}",
          scores: [
            { value: "${step1.output.result}" },
            { value: "${step1.output.data.value}" },
          ],
        },
      };

      const result = interpolateObject(obj, context, state);
      expect(result).toEqual({
        user: {
          id: "user123",
          scores: [{ value: "42" }, { value: "100" }],
        },
      });
    });

    it("should handle primitive values", () => {
      expect(interpolateObject("${userId}", context, state)).toBe("user123");
      expect(interpolateObject(123, context, state)).toBe(123);
      expect(interpolateObject(true, context, state)).toBe(true);
      expect(interpolateObject(null, context, state)).toBeNull();
    });
  });
});
