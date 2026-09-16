import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../../model/Instance";
import {
  type TransformNodeConfig,
  TransformNodeExecutor,
} from "../../../engine/executors/TransformNodeExecutor";

describe("TransformNodeExecutor", () => {
  let mockInstance: WorkflowInstance;

  beforeEach(() => {
    mockInstance = {
      instanceId: "test-instance",
      workflowId: "test-workflow",
      currentNodes: [],
      status: "running",
      context: {
        taxRate: 0.1,
      },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: {
        nodes: {
          fetchPrice: {
            output: { price: 100, currency: "USD" },
          },
          fetchQty: {
            output: { qty: 3 },
          },
        },
      },
    };
  });

  it("should evaluate arithmetic across node outputs and keep numeric type", async () => {
    const config: TransformNodeConfig = {
      output: {
        total: "${fetchPrice.output.price * fetchQty.output.qty}",
      },
    };

    const result = await TransformNodeExecutor.execute(config, mockInstance);

    expect(result.total).toBe(300);
    expect(typeof result.total).toBe("number");
  });

  it("should support multiple output fields referencing context and node outputs", async () => {
    const config: TransformNodeConfig = {
      output: {
        subtotal: "${fetchPrice.output.price * fetchQty.output.qty}",
        currency: "${fetchPrice.output.currency}",
        taxRate: "${taxRate}",
      },
    };

    const result = await TransformNodeExecutor.execute(config, mockInstance);

    expect(result).toEqual({
      subtotal: 300,
      currency: "USD",
      taxRate: 0.1,
    });
  });

  it("should accept bare expressions without ${} wrapping", async () => {
    const config: TransformNodeConfig = {
      output: {
        doubled: "fetchQty.output.qty * 2",
      },
    };

    const result = await TransformNodeExecutor.execute(config, mockInstance);

    expect(result.doubled).toBe(6);
  });

  it("should throw when config.output is missing", async () => {
    await expect(
      TransformNodeExecutor.execute({} as TransformNodeConfig, mockInstance),
    ).rejects.toThrow("Transform node requires config.output");
  });

  it("should throw with field context when an expression has invalid syntax", async () => {
    const config: TransformNodeConfig = {
      output: {
        broken: "${1 +}",
      },
    };

    await expect(
      TransformNodeExecutor.execute(config, mockInstance),
    ).rejects.toThrow(/broken/);
  });

  it("should preserve arrays and objects as native types", async () => {
    mockInstance.state!.nodes!["listNode"] = {
      output: { items: [1, 2, 3] },
    };
    const config: TransformNodeConfig = {
      output: {
        items: "${listNode.output.items}",
      },
    };

    const result = await TransformNodeExecutor.execute(config, mockInstance);

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items).toEqual([1, 2, 3]);
  });
});
