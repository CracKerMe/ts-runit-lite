// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import { type LoopNodeConfig, LoopNodeExecutor } from "../LoopNodeExecutor";

describe("LoopNodeExecutor", () => {
  let mockInstance: WorkflowInstance;

  beforeEach(() => {
    mockInstance = {
      instanceId: "test-instance",
      workflowId: "test-workflow",
      currentNodes: [],
      status: "running",
      context: {
        numbers: [1, 2, 3, 4, 5],
        users: [
          { name: "Alice", age: 25 },
          { name: "Bob", age: 30 },
          { name: "Charlie", age: 35 },
        ],
        multiplier: 2,
        emptyArray: [],
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: {
        nodes: {
          "data-node": {
            output: {
              items: ["a", "b", "c"],
              count: 3,
            },
          },
        },
      },
    };
  });

  describe("execute - sequential mode", () => {
    it("should iterate over simple array sequentially", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
      };

      const executedItems: any[] = [];
      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        executedItems.push(itemContext.num);
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(executedItems).toEqual([1, 2, 3, 4, 5]);
      expect(executeBody).toHaveBeenCalledTimes(5);
    });

    it("should provide index variable when configured", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        indexVariable: "idx",
        body: "process-node",
      };

      const executedIndices: number[] = [];
      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        executedIndices.push(itemContext.idx);
        return `${itemContext.idx}: ${itemContext.num}`;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual(["0: 1", "1: 2", "2: 3", "3: 4", "4: 5"]);
      expect(executedIndices).toEqual([0, 1, 2, 3, 4]);
    });

    it("should iterate over array of objects", async () => {
      const config: LoopNodeConfig = {
        collection: "users",
        itemVariable: "user",
        indexVariable: "i",
        body: "process-user-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return {
          index: itemContext.i,
          name: itemContext.user.name,
          age: itemContext.user.age,
        };
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(3);
      expect(result.results).toEqual([
        { index: 0, name: "Alice", age: 25 },
        { index: 1, name: "Bob", age: 30 },
        { index: 2, name: "Charlie", age: 35 },
      ]);
    });

    it("should handle empty array", async () => {
      const config: LoopNodeConfig = {
        collection: "emptyArray",
        itemVariable: "item",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.item;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(0);
      expect(result.results).toEqual([]);
      expect(executeBody).not.toHaveBeenCalled();
    });

    it("should access node outputs in collection expression", async () => {
      // Node outputs are stored with hyphens converted to camelCase in state
      mockInstance.state!.nodes!.dataNode = {
        output: {
          items: ["a", "b", "c"],
          count: 3,
        },
      };

      const config: LoopNodeConfig = {
        collection: "dataNode.items",
        itemVariable: "item",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.item.toUpperCase();
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(3);
      expect(result.results).toEqual(["A", "B", "C"]);
    });

    it("should use context variable as collection", async () => {
      // The expression evaluator doesn't support array literals, so we use context variables
      mockInstance.context.smallArray = [1, 2, 3];

      const config: LoopNodeConfig = {
        collection: "smallArray",
        itemVariable: "n",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.n * 10;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(3);
      expect(result.results).toEqual([10, 20, 30]);
    });

    it("should handle body execution returning different types", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
      };

      const executeBody = vi.fn(
        async (_itemContext: Record<string, any>, index: number) => {
          if (index === 0) return "string";
          if (index === 1) return 42;
          if (index === 2) return { key: "value" };
          if (index === 3) return [1, 2, 3];
          return null;
        },
      );

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([
        "string",
        42,
        { key: "value" },
        [1, 2, 3],
        null,
      ]);
    });

    it("should throw error if collection is not an array", async () => {
      const config: LoopNodeConfig = {
        collection: "multiplier", // This is a number, not an array
        itemVariable: "item",
        body: "process-node",
      };

      const executeBody = vi.fn();

      await expect(
        LoopNodeExecutor.execute(config, mockInstance, executeBody),
      ).rejects.toThrow(/Collection expression must return an array/);
    });

    it("should throw error if collection expression is invalid", async () => {
      const config: LoopNodeConfig = {
        collection: "invalid syntax @@",
        itemVariable: "item",
        body: "process-node",
      };

      const executeBody = vi.fn();

      await expect(
        LoopNodeExecutor.execute(config, mockInstance, executeBody),
      ).rejects.toThrow(/Loop execution failed/);
    });

    it("should throw error if body execution fails", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
      };

      const executeBody = vi.fn(
        async (itemContext: Record<string, any>, index: number) => {
          if (index === 2) {
            throw new Error("Body execution failed");
          }
          return itemContext.num * 2;
        },
      );

      await expect(
        LoopNodeExecutor.execute(config, mockInstance, executeBody),
      ).rejects.toThrow(/Loop iteration 2 failed/);

      // Should have executed 3 times (0, 1, 2) before failing
      expect(executeBody).toHaveBeenCalledTimes(3);
    });

    it("should handle single item array", async () => {
      mockInstance.context.singleItem = [42];

      const config: LoopNodeConfig = {
        collection: "singleItem",
        itemVariable: "value",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.value * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(1);
      expect(result.results).toEqual([84]);
    });

    it("should handle nested object access in item", async () => {
      mockInstance.context.complexData = [
        { user: { profile: { name: "Alice" } } },
        { user: { profile: { name: "Bob" } } },
      ];

      const config: LoopNodeConfig = {
        collection: "complexData",
        itemVariable: "data",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.data.user.profile.name;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(2);
      expect(result.results).toEqual(["Alice", "Bob"]);
    });
  });

  describe("execute - parallel mode", () => {
    it("should iterate over array in parallel", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
      };

      const executedItems: any[] = [];
      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        executedItems.push(itemContext.num);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 10));
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(executeBody).toHaveBeenCalledTimes(5);
      // All items should be executed (order may vary in parallel)
      expect(executedItems.sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it("should provide index variable in parallel mode", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        indexVariable: "idx",
        body: "process-node",
        parallel: true,
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return `${itemContext.idx}: ${itemContext.num}`;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      // Results should be in original order despite parallel execution
      expect(result.results).toEqual(["0: 1", "1: 2", "2: 3", "3: 4", "4: 5"]);
    });

    it("should respect maxConcurrency limit", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
        maxConcurrency: 2,
      };

      let currentlyExecuting = 0;
      let maxConcurrent = 0;

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        currentlyExecuting++;
        maxConcurrent = Math.max(maxConcurrent, currentlyExecuting);

        await new Promise((resolve) => setTimeout(resolve, 20));

        currentlyExecuting--;
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(executeBody).toHaveBeenCalledTimes(5);
      // Should never exceed maxConcurrency
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it("should actually enforce maxConcurrency over a long collection", async () => {
      // 并发池的行为守卫：现有实现依赖 .finally 从 Set 中移除自己。
      // 集合远长于并发上限，确保滑动窗口在多轮补位后仍不超限。
      mockInstance.context.many = Array.from({ length: 40 }, (_, i) => i);

      const config: LoopNodeConfig = {
        collection: "many",
        itemVariable: "n",
        body: "process-node",
        parallel: true,
        maxConcurrency: 3,
      };

      let inFlight = 0;
      let peak = 0;
      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return itemContext.n;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(peak).toBeLessThanOrEqual(3);
      expect(result.iterations).toBe(40);
      expect(result.results).toEqual(Array.from({ length: 40 }, (_, i) => i));
    });

    it("should not emit unhandled rejections when an iteration fails", async () => {
      // 失败路径的安全守卫：某个迭代失败时，其余在途 promise 必须被
      // drain 且其拒绝必须有 handler，否则会变成 unhandledRejection
      // （Node ≥15 默认终止进程）。
      mockInstance.context.many = Array.from({ length: 20 }, (_, i) => i);

      const config: LoopNodeConfig = {
        collection: "many",
        itemVariable: "n",
        body: "process-node",
        parallel: true,
        maxConcurrency: 3,
      };

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);

      try {
        const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (itemContext.n === 0) throw new Error("boom");
          return itemContext.n;
        });

        await expect(
          LoopNodeExecutor.execute(config, mockInstance, executeBody),
        ).rejects.toThrow("Loop iteration 0 failed: boom");

        // 让所有在途 promise 的结算落地
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("should fall back to unbounded concurrency when the limit is not a usable number", async () => {
      // MAX_CONCURRENT_NODES=abc 会让上限变成 NaN；`size >= NaN` 恒为 false，
      // 旧代码会静默地完全不限流。这里断言至少不会卡死或串行化。
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
        maxConcurrency: Number.NaN,
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(executeBody).toHaveBeenCalledTimes(5);
    });
  });

  describe("execute - iteration cap", () => {
    it("should reject a collection larger than MAX_LOOP_ITERATIONS before running any body", async () => {
      const previous = process.env.MAX_LOOP_ITERATIONS;
      process.env.MAX_LOOP_ITERATIONS = "5";

      try {
        mockInstance.context.many = Array.from({ length: 6 }, (_, i) => i);
        const config: LoopNodeConfig = {
          collection: "many",
          itemVariable: "n",
          body: "process-node",
        };

        const executeBody = vi.fn(async () => ({}));

        await expect(
          LoopNodeExecutor.execute(config, mockInstance, executeBody),
        ).rejects.toThrow("exceeds the limit of 5");

        expect(executeBody).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.MAX_LOOP_ITERATIONS;
        else process.env.MAX_LOOP_ITERATIONS = previous;
      }
    });

    it("should allow a collection exactly at the limit", async () => {
      const previous = process.env.MAX_LOOP_ITERATIONS;
      process.env.MAX_LOOP_ITERATIONS = "5";

      try {
        mockInstance.context.many = Array.from({ length: 5 }, (_, i) => i);
        const config: LoopNodeConfig = {
          collection: "many",
          itemVariable: "n",
          body: "process-node",
        };

        const executeBody = vi.fn(async (ctx: Record<string, any>) => ctx.n);
        const result = await LoopNodeExecutor.execute(
          config,
          mockInstance,
          executeBody,
        );

        expect(result.iterations).toBe(5);
      } finally {
        if (previous === undefined) delete process.env.MAX_LOOP_ITERATIONS;
        else process.env.MAX_LOOP_ITERATIONS = previous;
      }
    });

    it("should handle empty array in parallel mode", async () => {
      const config: LoopNodeConfig = {
        collection: "emptyArray",
        itemVariable: "item",
        body: "process-node",
        parallel: true,
      };

      const executeBody = vi.fn();

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(0);
      expect(result.results).toEqual([]);
      expect(executeBody).not.toHaveBeenCalled();
    });

    it("should throw error if any parallel iteration fails", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
      };

      const executeBody = vi.fn(
        async (itemContext: Record<string, any>, index: number) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (index === 2) {
            throw new Error("Parallel iteration failed");
          }
          return itemContext.num * 2;
        },
      );

      await expect(
        LoopNodeExecutor.execute(config, mockInstance, executeBody),
      ).rejects.toThrow(/Loop iteration 2 failed/);
    });

    it("should maintain result order in parallel execution", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
      };

      // Simulate varying execution times
      const executeBody = vi.fn(
        async (itemContext: Record<string, any>, index: number) => {
          // Later items complete faster
          await new Promise((resolve) => setTimeout(resolve, (5 - index) * 10));
          return itemContext.num * 2;
        },
      );

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      // Despite varying execution times, results should be in original order
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
    });

    it("should handle maxConcurrency of 1 (effectively sequential)", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
        maxConcurrency: 1,
      };

      const executionOrder: number[] = [];
      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        executionOrder.push(itemContext.num);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      // With maxConcurrency=1, should execute in order
      expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle maxConcurrency greater than array length", async () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
        maxConcurrency: 100, // Much larger than array length
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
      expect(executeBody).toHaveBeenCalledTimes(5);
    });

    it("should handle parallel execution with complex objects", async () => {
      const config: LoopNodeConfig = {
        collection: "users",
        itemVariable: "user",
        indexVariable: "i",
        body: "process-user-node",
        parallel: true,
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          index: itemContext.i,
          name: itemContext.user.name,
          age: itemContext.user.age,
          processed: true,
        };
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(3);
      expect(result.results).toEqual([
        { index: 0, name: "Alice", age: 25, processed: true },
        { index: 1, name: "Bob", age: 30, processed: true },
        { index: 2, name: "Charlie", age: 35, processed: true },
      ]);
    });
  });

  describe("execute - expression interpolation", () => {
    it("should interpolate expressions in collection", async () => {
      mockInstance.context.arrayKey = "numbers";

      const config: LoopNodeConfig = {
        collection: "${context.arrayKey}",
        itemVariable: "num",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
    });

    it("should access context with prefix", async () => {
      const config: LoopNodeConfig = {
        collection: "context.numbers",
        itemVariable: "num",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.num * 2;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([2, 4, 6, 8, 10]);
    });
  });

  describe("getBodyNode", () => {
    it("should return body node ID", () => {
      const config: LoopNodeConfig = {
        collection: "numbers",
        itemVariable: "item",
        body: "process-node",
      };

      const bodyNode = LoopNodeExecutor.getBodyNode(config);

      expect(bodyNode).toBe("process-node");
    });
  });

  describe("edge cases", () => {
    it("should handle array with null values", async () => {
      mockInstance.context.nullArray = [1, null, 3, null, 5];

      const config: LoopNodeConfig = {
        collection: "nullArray",
        itemVariable: "value",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.value === null ? "null" : itemContext.value;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(5);
      expect(result.results).toEqual([1, "null", 3, "null", 5]);
    });

    it("should handle array with undefined values", async () => {
      mockInstance.context.undefinedArray = [1, undefined, 3];

      const config: LoopNodeConfig = {
        collection: "undefinedArray",
        itemVariable: "value",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.value === undefined
          ? "undefined"
          : itemContext.value;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(3);
      expect(result.results).toEqual([1, "undefined", 3]);
    });

    it("should handle array with mixed types", async () => {
      mockInstance.context.mixedArray = [
        1,
        "two",
        { three: 3 },
        [4],
        true,
        null,
      ];

      const config: LoopNodeConfig = {
        collection: "mixedArray",
        itemVariable: "item",
        indexVariable: "i",
        body: "process-node",
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return typeof itemContext.item;
      });

      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );

      expect(result.iterations).toBe(6);
      expect(result.results).toEqual([
        "number",
        "string",
        "object",
        "object",
        "boolean",
        "object",
      ]);
    });

    it("should handle very large arrays efficiently", async () => {
      const largeArray = Array.from({ length: 1000 }, (_, i) => i);
      mockInstance.context.largeArray = largeArray;

      const config: LoopNodeConfig = {
        collection: "largeArray",
        itemVariable: "num",
        body: "process-node",
        parallel: true,
        maxConcurrency: 10,
      };

      const executeBody = vi.fn(async (itemContext: Record<string, any>) => {
        return itemContext.num * 2;
      });

      const startTime = Date.now();
      const result = await LoopNodeExecutor.execute(
        config,
        mockInstance,
        executeBody,
      );
      const executionTime = Date.now() - startTime;

      expect(result.iterations).toBe(1000);
      expect(result.results.length).toBe(1000);
      expect(result.results[0]).toBe(0);
      expect(result.results[999]).toBe(1998);
      expect(executeBody).toHaveBeenCalledTimes(1000);
      // Should complete reasonably fast with parallel execution
      expect(executionTime).toBeLessThan(5000);
    });
  });
});
