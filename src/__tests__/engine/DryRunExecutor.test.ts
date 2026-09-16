import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { DryRunExecutor } from "../../engine/DryRunExecutor";

describe("DryRunExecutor", () => {
  const workflow: WorkflowDefinition = {
    id: "dry-run",
    name: "dry-run",
    startNode: "http",
    nodes: {
      http: {
        id: "http",
        type: "http",
        next: ["condition"],
      },
      condition: {
        id: "condition",
        type: "condition",
        config: {
          condition: "context.amount > 10",
          trueBranch: "notify",
          falseBranch: "end",
        },
      },
      notify: {
        id: "notify",
        type: "notification",
        next: ["end"],
      },
      end: {
        id: "end",
        type: "action",
        action: async () => ({ done: true }),
      },
    },
  };

  it("simulates nodes and records expression traces", async () => {
    const executor = new DryRunExecutor();
    const result = await executor.execute(workflow, {
      context: { amount: 20 },
      recordExpressions: true,
      mockResponses: { http: { status: 200 } },
    });
    expect(result.success).toBe(true);
    expect(result.executionPath).toEqual([
      "http",
      "condition",
      "notify",
      "end",
    ]);
    expect(result.expressionTrace.length).toBeGreaterThan(0);
    expect(result.nodeResults.http.mocked).toBe(true);
  });

  it("supports skipNodes and stopAfterNode", async () => {
    const executor = new DryRunExecutor();
    const skipped = await executor.execute(workflow, {
      context: { amount: 20 },
      skipNodes: ["notify"],
    });
    expect(skipped.warnings.some((item) => item.includes("skipped"))).toBe(
      true,
    );

    const stopped = await executor.execute(workflow, {
      context: { amount: 20 },
      stopAfterNode: "condition",
    });
    expect(stopped.executionPath).toEqual(["http", "condition"]);
  });

  it("recursively dry-runs subworkflows", async () => {
    const child: WorkflowDefinition = {
      id: "child-workflow",
      name: "child-workflow",
      startNode: "child-start",
      nodes: {
        "child-start": {
          id: "child-start",
          type: "action",
          action: async (instance) => ({ echoed: instance?.context?.message }),
        },
      },
    };
    const parent: WorkflowDefinition = {
      id: "parent-workflow",
      name: "parent-workflow",
      startNode: "spawn",
      nodes: {
        spawn: {
          id: "spawn",
          type: "subworkflow",
          subworkflowId: "child-workflow",
          subworkflowInput: {
            message: "parent.message",
          },
        },
      },
    };

    const executor = new DryRunExecutor((workflowId) =>
      workflowId === "child-workflow" ? child : undefined,
    );
    const result = await executor.execute(parent, {
      context: { parent: { message: "hello" } },
    });

    expect(result.success).toBe(true);
    expect(
      (
        result.simulatedOutputs.spawn as {
          nested?: { executionPath: string[] };
        }
      ).nested?.executionPath,
    ).toEqual(["child-start"]);
  });
});
