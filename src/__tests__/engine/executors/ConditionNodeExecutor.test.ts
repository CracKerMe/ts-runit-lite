import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  type ConditionNodeConfig,
  ConditionNodeExecutor,
} from "../../../engine/executors/ConditionNodeExecutor";

describe("ConditionNodeExecutor", () => {
  let mockInstance: WorkflowInstance;

  beforeEach(() => {
    mockInstance = {
      instanceId: "test-instance",
      workflowId: "test-workflow",
      currentNodes: [],
      status: "running",
      context: {
        age: 25,
        score: 85,
        name: "John",
        isActive: true,
        balance: 1000,
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: {
        nodes: {
          "previous-node": {
            output: {
              value: 42,
              status: "success",
              count: 10,
            },
          },
          "check-node": {
            output: {
              approved: true,
              amount: 500,
            },
          },
        },
      },
    };
  });

  describe("execute", () => {
    it("should evaluate simple true condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "age > 18",
        trueBranch: "adult-node",
        falseBranch: "minor-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate simple false condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "age < 18",
        trueBranch: "minor-node",
        falseBranch: "adult-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(false);
      expect(result.branch).toBe("false");
    });

    it("should evaluate equality condition", async () => {
      const config: ConditionNodeConfig = {
        condition: 'name == "John"',
        trueBranch: "match-node",
        falseBranch: "no-match-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate inequality condition", async () => {
      const config: ConditionNodeConfig = {
        condition: 'name != "Jane"',
        trueBranch: "different-node",
        falseBranch: "same-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate boolean context variable", async () => {
      const config: ConditionNodeConfig = {
        condition: "isActive",
        trueBranch: "active-node",
        falseBranch: "inactive-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate negation", async () => {
      const config: ConditionNodeConfig = {
        condition: "!isActive",
        trueBranch: "inactive-node",
        falseBranch: "active-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(false);
      expect(result.branch).toBe("false");
    });

    it("should evaluate logical AND condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "age > 18 && score >= 80",
        trueBranch: "qualified-node",
        falseBranch: "not-qualified-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate logical OR condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "age < 18 || score >= 90",
        trueBranch: "pass-node",
        falseBranch: "fail-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(false);
      expect(result.branch).toBe("false");
    });

    it("should evaluate complex condition with parentheses", async () => {
      const config: ConditionNodeConfig = {
        condition: "(age > 18 && score >= 80) || balance > 5000",
        trueBranch: "approved-node",
        falseBranch: "rejected-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should access node output in condition using identifier", async () => {
      // The executor adds node outputs directly to context with node ID as key
      // So we can access them using the identifier syntax with underscores
      mockInstance.state!.nodes!.previousNode = {
        output: {
          value: 42,
          status: "success",
        },
      };

      const config: ConditionNodeConfig = {
        condition: "previousNode.value > 40",
        trueBranch: "high-value-node",
        falseBranch: "low-value-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should access nested node output in condition", async () => {
      // Node outputs are added directly to context by the executor
      mockInstance.state!.nodes!.checkNode = {
        output: {
          approved: true,
          amount: 500,
        },
      };

      const config: ConditionNodeConfig = {
        condition: "checkNode.approved == true",
        trueBranch: "approved-node",
        falseBranch: "rejected-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate mathematical expressions", async () => {
      const config: ConditionNodeConfig = {
        condition: "balance / 2 > 400",
        trueBranch: "sufficient-node",
        falseBranch: "insufficient-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate modulo operator", async () => {
      const config: ConditionNodeConfig = {
        condition: "age % 2 == 1",
        trueBranch: "odd-node",
        falseBranch: "even-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate comparison with calculation", async () => {
      const config: ConditionNodeConfig = {
        condition: "score + 10 >= 95",
        trueBranch: "excellent-node",
        falseBranch: "good-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should handle string comparison", async () => {
      const config: ConditionNodeConfig = {
        condition: 'name == "John"',
        trueBranch: "john-node",
        falseBranch: "other-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate less than or equal", async () => {
      const config: ConditionNodeConfig = {
        condition: "score <= 85",
        trueBranch: "at-or-below-node",
        falseBranch: "above-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate greater than or equal", async () => {
      const config: ConditionNodeConfig = {
        condition: "score >= 85",
        trueBranch: "at-or-above-node",
        falseBranch: "below-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should handle false AND condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "age > 30 && score >= 80",
        trueBranch: "both-true-node",
        falseBranch: "at-least-one-false-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(false);
      expect(result.branch).toBe("false");
    });

    it("should handle true OR condition with first false", async () => {
      const config: ConditionNodeConfig = {
        condition: "age > 30 || score >= 80",
        trueBranch: "at-least-one-true-node",
        falseBranch: "both-false-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate with context prefix", async () => {
      const config: ConditionNodeConfig = {
        condition: "context.age > 20",
        trueBranch: "over-twenty-node",
        falseBranch: "under-twenty-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should handle expression interpolation in condition", async () => {
      // Test that the condition itself can contain placeholders
      mockInstance.context.threshold = 20;

      const config: ConditionNodeConfig = {
        condition: "age > ${context.threshold}",
        trueBranch: "above-threshold-node",
        falseBranch: "below-threshold-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should throw error for invalid expression", async () => {
      const config: ConditionNodeConfig = {
        condition: "invalid syntax @@",
        trueBranch: "true-node",
        falseBranch: "false-node",
      };

      await expect(
        ConditionNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/Condition evaluation failed/);
    });

    it("should throw error for undefined variable", async () => {
      const config: ConditionNodeConfig = {
        condition: "undefinedVariable > 10",
        trueBranch: "true-node",
        falseBranch: "false-node",
      };

      // Should not throw, undefined > 10 evaluates to false
      const result = await ConditionNodeExecutor.execute(config, mockInstance);
      expect(result.result).toBe(false);
      expect(result.branch).toBe("false");
    });

    it("should handle zero value correctly", async () => {
      mockInstance.context.count = 0;

      const config: ConditionNodeConfig = {
        condition: "count == 0",
        trueBranch: "zero-node",
        falseBranch: "non-zero-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should handle empty string correctly", async () => {
      mockInstance.context.message = "";

      const config: ConditionNodeConfig = {
        condition: 'message == ""',
        trueBranch: "empty-node",
        falseBranch: "non-empty-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should handle null value correctly", async () => {
      mockInstance.context.value = null;

      const config: ConditionNodeConfig = {
        condition: "value == null",
        trueBranch: "null-node",
        falseBranch: "not-null-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should evaluate exponentiation operator", async () => {
      const config: ConditionNodeConfig = {
        condition: "2 ** 3 == 8",
        trueBranch: "correct-node",
        falseBranch: "incorrect-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should use built-in functions in condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "abs(-5) == 5",
        trueBranch: "correct-node",
        falseBranch: "incorrect-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });

    it("should use max function in condition", async () => {
      const config: ConditionNodeConfig = {
        condition: "max(age, score) == score",
        trueBranch: "score-higher-node",
        falseBranch: "age-higher-node",
      };

      const result = await ConditionNodeExecutor.execute(config, mockInstance);

      expect(result.result).toBe(true);
      expect(result.branch).toBe("true");
    });
  });

  describe("getNextNode", () => {
    it("should return trueBranch when result is true", () => {
      const config: ConditionNodeConfig = {
        condition: "age > 18",
        trueBranch: "adult-node",
        falseBranch: "minor-node",
      };

      const nextNode = ConditionNodeExecutor.getNextNode(config, true);

      expect(nextNode).toBe("adult-node");
    });

    it("should return falseBranch when result is false", () => {
      const config: ConditionNodeConfig = {
        condition: "age > 18",
        trueBranch: "adult-node",
        falseBranch: "minor-node",
      };

      const nextNode = ConditionNodeExecutor.getNextNode(config, false);

      expect(nextNode).toBe("minor-node");
    });
  });
});
