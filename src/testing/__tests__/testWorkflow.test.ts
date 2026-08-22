import { afterEach, describe, expect, it } from "vitest";
import type { WorkflowInstance } from "../../model/Instance";
import type { WorkflowDefinition } from "../../model/Workflow";
import { testWorkflow } from "../testWorkflow";

const workflow: WorkflowDefinition = {
  id: "workflow-test-helper",
  name: "Workflow Test Helper",
  startNode: "llm-draft",
  nodes: {
    "llm-draft": {
      id: "llm-draft",
      type: "http",
      config: {
        userPrompt: "draft a reply",
      },
      next: ["finalize"],
    },
    finalize: {
      id: "finalize",
      type: "action",
      action: async (instance) => ({
        draft: instance?.state?.nodes?.["llm-draft"]?.output,
        approved: true,
      }),
      next: [],
    },
  },
};

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe("testWorkflow", () => {
  it("runs a workflow with mocked non-action nodes", async () => {
    const result = await testWorkflow(workflow, {
      mockNodes: {
        "llm-draft": {
          content: "mocked reply",
        },
      },
    });
    cleanups.push(result.cleanup);

    result
      .expectCompleted()
      .expectOutput("llm-draft", { content: "mocked reply" })
      .expectOutput("finalize", {
        draft: { content: "mocked reply" },
        approved: true,
      });
  });

  it("supports function-based mocks with access to instance context", async () => {
    const result = await testWorkflow(workflow, {
      context: {
        customerId: "cust-1",
      },
      mockNodes: {
        "llm-draft": (instance: WorkflowInstance) => ({
          customerId: instance.context.customerId,
        }),
      },
    });
    cleanups.push(result.cleanup);

    expect(result.outputs["llm-draft"]).toEqual({ customerId: "cust-1" });
    expect(result.history.map((entry) => entry.nodeId)).toEqual([
      "llm-draft",
      "finalize",
    ]);
  });

  it("captures a failure snapshot for failed workflows", async () => {
    const failedWorkflow: WorkflowDefinition = {
      id: "workflow-test-helper-fail",
      name: "Workflow Test Helper Fail",
      startNode: "boom",
      nodes: {
        boom: {
          id: "boom",
          type: "action",
          action: async () => {
            throw new Error("expected failure");
          },
          next: [],
        },
      },
    };

    const result = await testWorkflow(failedWorkflow);
    cleanups.push(result.cleanup);

    expect(result.instance.status).toBe("failed");
    expect(result.failureSnapshot?.status).toBe("failed");
    expect(result.formatFailureSnapshot()).toContain("expected failure");
    expect(() => result.expectCompleted()).toThrow(
      /Expected workflow status completed/,
    );
  });

  it("supports DSL input", async () => {
    const dsl = `
id: dsl-workflow-test
name: DSL Workflow Test
startNode: llm-draft

llm-draft:
  type: http
  next: ["finalize"]

finalize:
  type: action
`;

    const result = await testWorkflow(dsl, {
      mockNodes: {
        "llm-draft": { content: "dsl reply" },
        finalize: { done: true },
      },
    });
    cleanups.push(result.cleanup);

    result
      .expectCompleted()
      .expectOutput("llm-draft", { content: "dsl reply" })
      .expectOutput("finalize", { done: true });
  });

  it("supports template input", async () => {
    const result = await testWorkflow(
      {
        template: {
          templateId: "http-callback",
          name: "HTTP Callback Test",
          parameters: {
            callbackUrl: "https://example.com/test",
            payload: { ok: true },
          },
        },
      },
      {
        mockNodes: {
          callback: {
            status: 202,
          },
        },
      },
    );
    cleanups.push(result.cleanup);

    result.expectCompleted().expectOutput("callback", { status: 202 });
    expect(result.instance.workflowId).toBe("http-callback-test");
  });
});
