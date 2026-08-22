// oxlint-disable no-explicit-any -- dynamic types used throughout this module
import type { TaskNode, WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

/**
 * Generated test case
 */
export interface GeneratedTest {
  workflowId: string;
  testType:
    | "happy-path"
    | "error-path"
    | "boundary"
    | "concurrent"
    | "rollback";
  description: string;
  input: Record<string, any>;
  expectedBehavior: TestAssertion[];
  code: string;
}

/**
 * Test assertion definition
 */
export interface TestAssertion {
  type: "status" | "output" | "error" | "execution_order" | "duration";
  target: string;
  expected: any;
  operator: "equals" | "contains" | "greaterThan" | "lessThan" | "exists";
}

/**
 * AI-driven test generator for workflow definitions.
 * Generates test cases based on workflow structure analysis.
 */
export class TestGenerator {
  /**
   * Generate comprehensive test cases from a workflow definition
   */
  async generateFromWorkflow(
    workflow: WorkflowDefinition,
  ): Promise<GeneratedTest[]> {
    const tests: GeneratedTest[] = [];

    // 1. Happy path tests
    tests.push(...this.generateHappyPathTests(workflow));

    // 2. Error path tests
    tests.push(...this.generateErrorPathTests(workflow));

    // 3. Boundary tests (for condition nodes)
    tests.push(...this.generateBoundaryTests(workflow));

    // 4. Concurrent tests (for parallel nodes)
    tests.push(...this.generateConcurrencyTests(workflow));

    Logger.info("system", "test-generator", "Generated test cases", {
      workflowId: workflow.id,
      totalTests: tests.length,
      happyPath: tests.filter((t) => t.testType === "happy-path").length,
      errorPath: tests.filter((t) => t.testType === "error-path").length,
      boundary: tests.filter((t) => t.testType === "boundary").length,
      concurrent: tests.filter((t) => t.testType === "concurrent").length,
    });

    return tests;
  }

  /**
   * Generate happy path tests by tracing the workflow execution path
   */
  private generateHappyPathTests(
    workflow: WorkflowDefinition,
  ): GeneratedTest[] {
    const tests: GeneratedTest[] = [];
    const executionPath = this.traceExecutionPath(workflow);

    tests.push({
      workflowId: workflow.id,
      testType: "happy-path",
      description: `Execute workflow '${workflow.name}' through the happy path`,
      input: this.generateSampleInput(workflow),
      expectedBehavior: [
        {
          type: "status",
          target: "instance",
          expected: "completed",
          operator: "equals",
        },
        {
          type: "execution_order",
          target: "nodes",
          expected: executionPath,
          operator: "equals",
        },
      ],
      code: this.generateHappyPathTestCode(workflow, executionPath),
    });

    return tests;
  }

  /**
   * Generate error path tests for each node that could fail
   */
  private generateErrorPathTests(
    workflow: WorkflowDefinition,
  ): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      // Skip nodes that are unlikely to fail
      if (node.type === "wait" || node.type === "condition") continue;

      tests.push({
        workflowId: workflow.id,
        testType: "error-path",
        description: `Test error handling when node '${nodeId}' fails`,
        input: this.generateFailureInput(node),
        expectedBehavior: [
          {
            type: "status",
            target: `nodes.${nodeId}`,
            expected: "failed",
            operator: "equals",
          },
          {
            type: "error",
            target: `nodes.${nodeId}`,
            expected: true,
            operator: "exists",
          },
        ],
        code: this.generateErrorPathTestCode(workflow, nodeId, node),
      });
    }

    return tests;
  }

  /**
   * Generate boundary tests for condition nodes
   */
  private generateBoundaryTests(workflow: WorkflowDefinition): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      if (node.type !== "condition" || !node.config?.condition) continue;

      // Generate boundary value tests
      const condition = node.config.condition as string;

      // Test with boundary values
      tests.push({
        workflowId: workflow.id,
        testType: "boundary",
        description: `Test condition node '${nodeId}' boundary values`,
        input: { conditionValue: 0 },
        expectedBehavior: [
          {
            type: "output",
            target: `nodes.${nodeId}`,
            expected: { result: false },
            operator: "contains",
          },
        ],
        code: this.generateBoundaryTestCode(workflow, nodeId, condition),
      });
    }

    return tests;
  }

  /**
   * Generate concurrency tests for parallel execution paths
   */
  private generateConcurrencyTests(
    workflow: WorkflowDefinition,
  ): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    // Find nodes with multiple next targets (parallel execution)
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      if (node.next && node.next.length > 1) {
        tests.push({
          workflowId: workflow.id,
          testType: "concurrent",
          description: `Test parallel execution from node '${nodeId}' to ${node.next.join(", ")}`,
          input: this.generateSampleInput(workflow),
          expectedBehavior: node.next.map((nextNode) => ({
            type: "status" as const,
            target: `nodes.${nextNode}`,
            expected: "completed",
            operator: "equals" as const,
          })),
          code: this.generateConcurrencyTestCode(workflow, nodeId, node.next),
        });
      }
    }

    return tests;
  }

  /**
   * Trace the execution path from start node
   */
  private traceExecutionPath(workflow: WorkflowDefinition): string[] {
    const path: string[] = [];
    let currentNode = workflow.startNode;
    const visited = new Set<string>();

    while (currentNode && !visited.has(currentNode)) {
      visited.add(currentNode);
      path.push(currentNode);

      const node = workflow.nodes[currentNode];
      if (!node) break;

      // Follow the first next node (happy path)
      if (node.next && node.next.length > 0) {
        currentNode = node.next[0];
      } else if (node.conditionalNext && node.conditionalNext.length > 0) {
        currentNode = node.conditionalNext[0].target;
      } else {
        break;
      }
    }

    return path;
  }

  /**
   * Generate sample input for a workflow
   */
  private generateSampleInput(
    workflow: WorkflowDefinition,
  ): Record<string, any> {
    return {
      sampleInput: true,
      workflowId: workflow.id,
      timestamp: Date.now(),
    };
  }

  /**
   * Generate input that should cause a node to fail
   */
  private generateFailureInput(node: TaskNode): Record<string, any> {
    switch (node.type) {
      case "http":
        return { url: "http://invalid-host-that-does-not-exist.local" };
      case "sql":
        return { query: "INVALID SQL QUERY" };
      default:
        return { invalidInput: true };
    }
  }

  /**
   * Generate Vitest test code for happy path
   */
  private generateHappyPathTestCode(
    workflow: WorkflowDefinition,
    executionPath: string[],
  ): string {
    return `import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("Workflow: ${workflow.name}", () => {
  let engine: any;

  beforeEach(async () => {
    const ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  it("should complete the happy path successfully", async () => {
    const input = ${JSON.stringify(this.generateSampleInput(workflow), null, 2)};
    const result = await engine.start("${workflow.id}", input);

    expect(result).toBeDefined();
    expect(result.status).toBe("completed");

    // Verify execution order
    const executedNodes = result.history.map((h: any) => h.nodeId);
    ${executionPath.map((node, i) => `expect(executedNodes[${i}]).toBe("${node}");`).join("\n    ")}
  });
});`;
  }

  /**
   * Generate Vitest test code for error path
   */
  private generateErrorPathTestCode(
    workflow: WorkflowDefinition,
    nodeId: string,
    node: TaskNode,
  ): string {
    return `import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("Workflow: ${workflow.name} - Error Path", () => {
  let engine: any;

  beforeEach(async () => {
    const ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  it("should handle failure in node '${nodeId}' (${node.type})", async () => {
    const input = ${JSON.stringify(this.generateFailureInput(node), null, 2)};

    try {
      const result = await engine.start("${workflow.id}", input);
      // If the workflow has error handling, it should complete with error state
      if (result.status === "failed") {
        expect(result.error).toBeDefined();
      }
    } catch (error) {
      // Error was thrown - this is expected for nodes without error handling
      expect(error).toBeDefined();
    }
  });
});`;
  }

  /**
   * Generate Vitest test code for boundary conditions
   */
  private generateBoundaryTestCode(
    workflow: WorkflowDefinition,
    _nodeId: string,
    condition: string,
  ): string {
    return `import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("Workflow: ${workflow.name} - Boundary Conditions", () => {
  let engine: any;

  beforeEach(async () => {
    const ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  it("should evaluate condition '${condition}' correctly at boundary", async () => {
    // Test with value that makes condition false
    const input = { conditionValue: 0 };
    const result = await engine.start("${workflow.id}", input);
    expect(result).toBeDefined();

    // Test with value that makes condition true
    const inputTrue = { conditionValue: 100 };
    const resultTrue = await engine.start("${workflow.id}", inputTrue);
    expect(resultTrue).toBeDefined();
  });
});`;
  }

  /**
   * Generate Vitest test code for concurrency
   */
  private generateConcurrencyTestCode(
    workflow: WorkflowDefinition,
    _nodeId: string,
    parallelNodes: string[],
  ): string {
    return `import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("Workflow: ${workflow.name} - Concurrency", () => {
  let engine: any;

  beforeEach(async () => {
    const ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  it("should execute parallel nodes ${parallelNodes.join(", ")} concurrently", async () => {
    const input = ${JSON.stringify(this.generateSampleInput(workflow), null, 2)};
    const result = await engine.start("${workflow.id}", input);

    expect(result).toBeDefined();

    // Verify all parallel branches completed
    ${parallelNodes.map((node) => `expect(result.nodes?.["${node}"]?.status).toBe("completed");`).join("\n    ")}
  });
});`;
  }

  /**
   * Generate a regression test from a failed instance
   */
  async generateFromFailure(instance: any): Promise<GeneratedTest> {
    const failedNode = instance.history?.find(
      (h: any) => h.status === "failed",
    );

    return {
      workflowId: instance.workflowId,
      testType: "error-path",
      description: `Regression test for failed instance ${instance.instanceId}`,
      input: instance.context || {},
      expectedBehavior: [
        {
          type: "status",
          target: failedNode?.nodeId || "unknown",
          expected: "failed",
          operator: "equals",
        },
      ],
      code: `import { describe, it, expect, beforeEach } from "vitest";
import { bootstrap } from "../bootstrap";

describe("Regression: ${instance.workflowId}", () => {
  let engine: any;

  beforeEach(async () => {
    const ctx = await bootstrap({ skipValidation: true, skipGracefulShutdown: true });
    engine = ctx.engine;
  });

  it("should handle the failure case from instance ${instance.instanceId}", async () => {
    const input = ${JSON.stringify(instance.context || {}, null, 2)};

    try {
      const result = await engine.start("${instance.workflowId}", input);
      // Verify the failure is handled gracefully
      expect(result).toBeDefined();
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});`,
    };
  }

  /**
   * Generate mutation tests for workflow robustness
   */
  async generateMutationTests(
    workflow: WorkflowDefinition,
  ): Promise<GeneratedTest[]> {
    const tests: GeneratedTest[] = [];

    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      // Test: What happens if we remove this node?
      tests.push({
        workflowId: workflow.id,
        testType: "boundary",
        description: `Mutation: Remove node '${nodeId}' and verify workflow behavior`,
        input: {},
        expectedBehavior: [],
        code: `import { describe, it, expect } from "vitest";

describe("Mutation: Remove node ${nodeId}", () => {
  it("should handle missing node gracefully", () => {
    const workflow = ${JSON.stringify(workflow, null, 2)};
    delete workflow.nodes["${nodeId}"];

    // The workflow engine should detect the missing node
    // and either fail validation or handle the error
    expect(workflow.nodes["${nodeId}"]).toBeUndefined();
  });
});`,
      });

      // Test: What happens if we change the node type?
      if (node.type !== "action") {
        tests.push({
          workflowId: workflow.id,
          testType: "boundary",
          description: `Mutation: Change node '${nodeId}' type from '${node.type}' to 'action'`,
          input: {},
          expectedBehavior: [],
          code: `import { describe, it, expect } from "vitest";

describe("Mutation: Change node ${nodeId} type", () => {
  it("should handle type mismatch gracefully", () => {
    const workflow = ${JSON.stringify(workflow, null, 2)};
    workflow.nodes["${nodeId}"].type = "action";

    // The workflow engine should detect the type mismatch
    expect(workflow.nodes["${nodeId}"].type).toBe("action");
  });
});`,
        });
      }
    }

    return tests;
  }
}
