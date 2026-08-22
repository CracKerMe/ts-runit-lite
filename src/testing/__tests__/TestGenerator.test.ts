import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { TestGenerator } from "../TestGenerator";

describe("TestGenerator", () => {
  let generator: TestGenerator;

  beforeEach(() => {
    generator = new TestGenerator();
  });

  const mockWorkflow: WorkflowDefinition = {
    id: "test-workflow",
    name: "Test Workflow",
    version: "1.0.0",
    startNode: "start",
    nodes: {
      start: {
        id: "start",
        type: "action",
        next: ["process"],
      },
      process: {
        id: "process",
        type: "http",
        config: {
          model: "gpt-4",
          prompt: "Process the input",
        },
        next: ["end"],
      },
      end: {
        id: "end",
        type: "action",
      },
    },
  };

  describe("generateFromWorkflow", () => {
    it("should generate happy path test", async () => {
      const tests = await generator.generateFromWorkflow(mockWorkflow);

      const happyPath = tests.find((t) => t.testType === "happy-path");
      expect(happyPath).toBeDefined();
      expect(happyPath!.workflowId).toBe("test-workflow");
      expect(happyPath!.code).toContain("vitest");
    });

    it("should generate error path tests for each node", async () => {
      const tests = await generator.generateFromWorkflow(mockWorkflow);

      const errorTests = tests.filter((t) => t.testType === "error-path");
      expect(errorTests.length).toBeGreaterThan(0);
    });

    it("should generate boundary tests for condition nodes", async () => {
      const workflowWithCondition: WorkflowDefinition = {
        ...mockWorkflow,
        nodes: {
          ...mockWorkflow.nodes,
          condition: {
            id: "condition",
            type: "condition",
            config: {
              condition: "${amount} > 100",
              trueBranch: "process",
              falseBranch: "end",
            },
          },
        },
      };

      const tests = await generator.generateFromWorkflow(workflowWithCondition);

      const boundaryTests = tests.filter((t) => t.testType === "boundary");
      expect(boundaryTests.length).toBeGreaterThan(0);
    });

    it("should generate concurrency tests for parallel nodes", async () => {
      const workflowWithParallel: WorkflowDefinition = {
        ...mockWorkflow,
        nodes: {
          start: {
            id: "start",
            type: "action",
            next: ["branch1", "branch2"],
          },
          branch1: {
            id: "branch1",
            type: "action",
          },
          branch2: {
            id: "branch2",
            type: "action",
          },
        },
      };

      const tests = await generator.generateFromWorkflow(workflowWithParallel);

      const concurrentTests = tests.filter((t) => t.testType === "concurrent");
      expect(concurrentTests.length).toBeGreaterThan(0);
    });
  });

  describe("generateFromFailure", () => {
    it("should generate regression test from failed instance", async () => {
      const failedInstance = {
        workflowId: "test-workflow",
        instanceId: "instance-123",
        context: { input: "test" },
        history: [
          { nodeId: "start", status: "completed" },
          { nodeId: "process", status: "failed", error: "Timeout" },
        ],
      };

      const test = await generator.generateFromFailure(failedInstance);

      expect(test.testType).toBe("error-path");
      expect(test.workflowId).toBe("test-workflow");
      expect(test.code).toContain("instance-123");
    });
  });

  describe("generateMutationTests", () => {
    it("should generate mutation tests for each node", async () => {
      const tests = await generator.generateMutationTests(mockWorkflow);

      expect(tests.length).toBeGreaterThan(0);

      // Should have delete-node mutations
      const deleteTests = tests.filter((t) =>
        t.description.includes("Remove node"),
      );
      expect(deleteTests.length).toBeGreaterThan(0);
    });
  });
});
