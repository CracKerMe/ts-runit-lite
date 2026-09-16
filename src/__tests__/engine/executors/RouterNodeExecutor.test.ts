import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  type RouterNodeConfig,
  RouterNodeExecutor,
} from "../../../engine/executors/RouterNodeExecutor";

describe("RouterNodeExecutor", () => {
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
        priority: "high",
        category: "premium",
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
    it("should route to first matching condition", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age < 18", target: "minor-node" },
          { condition: "age >= 18 && age < 65", target: "adult-node" },
          { condition: "age >= 65", target: "senior-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("adult-node");
    });

    it("should route to default when no conditions match", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age < 18", target: "minor-node" },
          { condition: "age >= 65", target: "senior-node" },
        ],
        defaultTarget: "default-node",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(-1);
      expect(result.target).toBe("default-node");
    });

    it("should throw error when no conditions match and no default", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age < 18", target: "minor-node" },
          { condition: "age >= 65", target: "senior-node" },
        ],
      };

      await expect(
        RouterNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/No routes matched and no default target configured/);
    });

    it("should respect priority order (lower priority number first)", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age > 20", target: "low-priority-node", priority: 10 },
          { condition: "age > 20", target: "high-priority-node", priority: 1 },
          {
            condition: "age > 20",
            target: "medium-priority-node",
            priority: 5,
          },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      // Should match the high-priority route (priority 1)
      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("high-priority-node");
    });

    it("should handle routes without explicit priority", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age > 20", target: "first-node" },
          { condition: "age > 20", target: "second-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      // Should match the first route (both have default priority)
      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("first-node");
    });

    it("should handle mixed priority and no-priority routes", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age > 20", target: "no-priority-node" },
          { condition: "age > 20", target: "high-priority-node", priority: 1 },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      // Should match the high-priority route first
      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("high-priority-node");
    });

    it("should evaluate complex conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          {
            condition: "age > 30 && score >= 90",
            target: "excellent-senior-node",
          },
          { condition: "age > 18 && score >= 80", target: "good-adult-node" },
          { condition: "age > 18", target: "adult-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("good-adult-node");
    });

    it("should evaluate conditions with OR logic", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age < 18 || age > 65", target: "special-age-node" },
          { condition: "age >= 18 && age <= 65", target: "working-age-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("working-age-node");
    });

    it("should access context variables in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: 'priority == "low"', target: "low-priority-handler" },
          { condition: 'priority == "high"', target: "high-priority-handler" },
        ],
        defaultTarget: "default-handler",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("high-priority-handler");
    });

    it("should access node outputs in conditions", async () => {
      mockInstance.state!.nodes!.checkNode = {
        output: {
          approved: true,
          amount: 500,
        },
      };

      const config: RouterNodeConfig = {
        routes: [
          { condition: "checkNode.approved == false", target: "rejected-node" },
          {
            condition: "checkNode.approved == true && checkNode.amount > 1000",
            target: "high-amount-node",
          },
          { condition: "checkNode.approved == true", target: "approved-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(2);
      expect(result.target).toBe("approved-node");
    });

    it("should evaluate mathematical expressions in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "balance / 2 > 1000", target: "high-balance-node" },
          { condition: "balance / 2 > 400", target: "medium-balance-node" },
          { condition: "balance > 0", target: "positive-balance-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("medium-balance-node");
    });

    it("should handle string comparisons", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: 'name == "Jane"', target: "jane-node" },
          { condition: 'name == "John"', target: "john-node" },
        ],
        defaultTarget: "other-node",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("john-node");
    });

    it("should handle boolean context variables", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "!isActive", target: "inactive-node" },
          { condition: "isActive", target: "active-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("active-node");
    });

    it("should handle negation in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "!(age > 30)", target: "not-over-thirty-node" },
          { condition: "age > 18", target: "over-eighteen-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("not-over-thirty-node");
    });

    it("should handle parentheses for grouping", async () => {
      const config: RouterNodeConfig = {
        routes: [
          {
            condition: "(age > 18 && score >= 80) || balance > 5000",
            target: "qualified-node",
          },
          { condition: "age > 18", target: "adult-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("qualified-node");
    });

    it("should handle comparison operators", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "score < 60", target: "fail-node" },
          { condition: "score >= 60 && score < 80", target: "pass-node" },
          { condition: "score >= 80 && score < 90", target: "good-node" },
          { condition: "score >= 90", target: "excellent-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(2);
      expect(result.target).toBe("good-node");
    });

    it("should handle inequality operator", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: 'name != "John"', target: "not-john-node" },
          { condition: 'name == "John"', target: "john-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("john-node");
    });

    it("should handle modulo operator", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age % 2 == 0", target: "even-age-node" },
          { condition: "age % 2 == 1", target: "odd-age-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("odd-age-node");
    });

    it("should handle exponentiation operator", async () => {
      mockInstance.context.power = 8;

      const config: RouterNodeConfig = {
        routes: [
          { condition: "2 ** 3 == power", target: "power-match-node" },
          { condition: "2 ** 3 != power", target: "power-no-match-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("power-match-node");
    });

    it("should handle expression interpolation in conditions", async () => {
      mockInstance.context.threshold = 20;

      const config: RouterNodeConfig = {
        routes: [
          {
            condition: "age > ${context.threshold}",
            target: "above-threshold-node",
          },
          {
            condition: "age <= ${context.threshold}",
            target: "below-threshold-node",
          },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("above-threshold-node");
    });

    it("should handle context prefix in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "context.age > 30", target: "over-thirty-node" },
          { condition: "context.age > 18", target: "over-eighteen-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("over-eighteen-node");
    });

    it("should handle zero value correctly", async () => {
      mockInstance.context.count = 0;

      const config: RouterNodeConfig = {
        routes: [
          { condition: "count > 0", target: "positive-node" },
          { condition: "count == 0", target: "zero-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("zero-node");
    });

    it("should handle empty string correctly", async () => {
      mockInstance.context.message = "";

      const config: RouterNodeConfig = {
        routes: [
          { condition: 'message != ""', target: "has-message-node" },
          { condition: 'message == ""', target: "empty-message-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("empty-message-node");
    });

    it("should handle null value correctly", async () => {
      mockInstance.context.value = null;

      const config: RouterNodeConfig = {
        routes: [
          { condition: "value != null", target: "has-value-node" },
          { condition: "value == null", target: "null-value-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("null-value-node");
    });

    it("should handle undefined variable gracefully", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "undefinedVariable > 10", target: "defined-node" },
        ],
        defaultTarget: "default-node",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      // undefined > 10 evaluates to false, so should use default
      expect(result.matchedRoute).toBe(-1);
      expect(result.target).toBe("default-node");
    });

    it("should use built-in functions in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "abs(-5) == 5", target: "abs-correct-node" },
          { condition: "abs(-5) != 5", target: "abs-incorrect-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("abs-correct-node");
    });

    it("should use max function in conditions", async () => {
      const config: RouterNodeConfig = {
        routes: [
          {
            condition: "max(age, score) == score",
            target: "score-higher-node",
          },
          { condition: "max(age, score) == age", target: "age-higher-node" },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("score-higher-node");
    });

    it("should handle multiple routes with same priority", async () => {
      const config: RouterNodeConfig = {
        routes: [
          { condition: "age > 20", target: "first-node", priority: 5 },
          { condition: "age > 20", target: "second-node", priority: 5 },
        ],
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      // Should match the first one encountered with same priority
      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("first-node");
    });

    it("should handle empty routes array with default", async () => {
      const config: RouterNodeConfig = {
        routes: [],
        defaultTarget: "default-node",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(-1);
      expect(result.target).toBe("default-node");
    });

    it("should throw error for empty routes array without default", async () => {
      const config: RouterNodeConfig = {
        routes: [],
      };

      await expect(
        RouterNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/No routes matched and no default target configured/);
    });

    it("should throw error for invalid expression", async () => {
      const config: RouterNodeConfig = {
        routes: [{ condition: "invalid syntax @@", target: "error-node" }],
      };

      await expect(
        RouterNodeExecutor.execute(config, mockInstance),
      ).rejects.toThrow(/Router evaluation failed/);
    });

    it("should handle category-based routing", async () => {
      const config: RouterNodeConfig = {
        routes: [
          {
            condition: 'category == "basic"',
            target: "basic-handler",
            priority: 3,
          },
          {
            condition: 'category == "premium"',
            target: "premium-handler",
            priority: 1,
          },
          {
            condition: 'category == "enterprise"',
            target: "enterprise-handler",
            priority: 2,
          },
        ],
        defaultTarget: "default-handler",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(1);
      expect(result.target).toBe("premium-handler");
    });

    it("should handle complex multi-condition routing", async () => {
      const config: RouterNodeConfig = {
        routes: [
          {
            condition:
              'priority == "high" && category == "premium" && balance > 500',
            target: "vip-fast-track-node",
            priority: 1,
          },
          {
            condition: 'priority == "high" && balance > 500',
            target: "priority-node",
            priority: 2,
          },
          {
            condition: 'category == "premium"',
            target: "premium-node",
            priority: 3,
          },
        ],
        defaultTarget: "standard-node",
      };

      const result = await RouterNodeExecutor.execute(config, mockInstance);

      expect(result.matchedRoute).toBe(0);
      expect(result.target).toBe("vip-fast-track-node");
    });
  });

  describe("getNextNode", () => {
    it("should return target from router output", () => {
      const output = {
        matchedRoute: 2,
        target: "selected-node",
      };

      const nextNode = RouterNodeExecutor.getNextNode(output);

      expect(nextNode).toBe("selected-node");
    });

    it("should return default target when matchedRoute is -1", () => {
      const output = {
        matchedRoute: -1,
        target: "default-node",
      };

      const nextNode = RouterNodeExecutor.getNextNode(output);

      expect(nextNode).toBe("default-node");
    });
  });
});
