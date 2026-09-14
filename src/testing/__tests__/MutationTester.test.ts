import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { MutationTester } from "../MutationTester";

describe("MutationTester", () => {
  let tester: MutationTester;

  beforeEach(() => {
    tester = new MutationTester();
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

  describe("generateMutations", () => {
    it("should generate mutations for each node", () => {
      const mutations = tester.generateMutations(mockWorkflow);

      expect(mutations.length).toBeGreaterThan(0);

      // Should have delete-node mutations
      const deleteMutations = mutations.filter((m) => m.type === "delete-node");
      expect(deleteMutations.length).toBe(3); // start, process, end

      // Should have change-type mutations
      const typeMutations = mutations.filter((m) => m.type === "change-type");
      expect(typeMutations.length).toBeGreaterThan(0);
    });

    it("should generate condition mutations for condition nodes", () => {
      const workflowWithCondition: WorkflowDefinition = {
        ...mockWorkflow,
        nodes: {
          ...mockWorkflow.nodes,
          condition: {
            id: "condition",
            type: "condition",
            config: {
              condition: "${amount} > 100",
            },
          },
        },
      };

      const mutations = tester.generateMutations(workflowWithCondition);

      const conditionMutations = mutations.filter(
        (m) => m.type === "negate-condition",
      );
      expect(conditionMutations.length).toBeGreaterThan(0);
    });
  });

  describe("testMutation", () => {
    it("should detect that deleting start node breaks workflow", () => {
      const mutation = {
        type: "delete-node" as const,
        nodeId: "start",
        description: "Delete start node",
      };

      const result = tester.testMutation(mutation, mockWorkflow);

      expect(result.killed).toBe(true);
      expect(result.reason).toContain("Start node does not exist");
    });

    it("should detect that deleting a referenced node breaks workflow", () => {
      const mutation = {
        type: "delete-node" as const,
        nodeId: "process",
        description: "Delete process node",
      };

      const result = tester.testMutation(mutation, mockWorkflow);

      // Should be killed because start references process
      expect(result.killed).toBe(true);
    });

    it("should detect orphan nodes", () => {
      const mutation = {
        type: "delete-node" as const,
        nodeId: "start",
        description: "Delete start node",
      };

      const result = tester.testMutation(mutation, mockWorkflow);

      expect(result.killed).toBe(true);
    });
  });

  describe("runMutations", () => {
    it("should run all mutations and generate report", async () => {
      const report = await tester.runMutations(mockWorkflow);

      expect(report.totalMutations).toBeGreaterThan(0);
      expect(report.killed).toBeGreaterThan(0);
      expect(report.killRate).toBeGreaterThan(0);
      expect(report.details.length).toBe(report.totalMutations);
    });

    it("should have a kill rate between 0 and 1", async () => {
      const report = await tester.runMutations(mockWorkflow);

      expect(report.killRate).toBeGreaterThanOrEqual(0);
      expect(report.killRate).toBeLessThanOrEqual(1);
    });

    it("should report killed and survived counts that sum to the total", async () => {
      const report = await tester.runMutations(mockWorkflow);

      expect(report.killed + report.survived).toBe(report.totalMutations);
    });
  });

  it("should not mutate the original workflow definition", () => {
    const before = JSON.stringify(mockWorkflow);

    tester.testMutation(
      {
        type: "delete-node" as const,
        nodeId: "process",
        description: "Delete process node",
      },
      mockWorkflow,
    );

    expect(JSON.stringify(mockWorkflow)).toBe(before);
  });
});
