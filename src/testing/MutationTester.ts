import type { WorkflowDefinition } from "../model/Workflow";
import { Logger } from "../utils/Logger";

/**
 * Mutation types for testing workflow robustness
 */
export type MutationType =
  | "delete-node"
  | "change-type"
  | "negate-condition"
  | "swap-next"
  | "set-zero-timeout"
  | "corrupt-config";

/**
 * A single mutation to apply to a workflow
 */
export interface Mutation {
  type: MutationType;
  nodeId: string;
  description: string;
  newType?: string;
}

/**
 * Result of testing a mutation
 */
export interface MutationResult {
  mutation: Mutation;
  killed: boolean;
  reason: string;
}

/**
 * Report summarizing mutation test results
 */
export interface MutationReport {
  totalMutations: number;
  killed: number;
  survived: number;
  killRate: number;
  details: MutationResult[];
}

/**
 * Mutation tester for workflow definitions.
 * Tests workflow robustness by applying mutations and checking if they would be caught.
 */
export class MutationTester {
  /**
   * Run all mutations against a workflow definition
   */
  async runMutations(workflow: WorkflowDefinition): Promise<MutationReport> {
    const mutations = this.generateMutations(workflow);
    const results: MutationResult[] = [];

    for (const mutation of mutations) {
      const result = this.testMutation(mutation, workflow);
      results.push(result);
    }

    const killed = results.filter((r) => r.killed).length;
    const survived = results.filter((r) => !r.killed).length;

    const report: MutationReport = {
      totalMutations: mutations.length,
      killed,
      survived,
      killRate: mutations.length > 0 ? killed / mutations.length : 0,
      details: results,
    };

    Logger.info("system", "mutation-tester", "Mutation test completed", {
      workflowId: workflow.id,
      totalMutations: report.totalMutations,
      killed: report.killed,
      survived: report.survived,
      killRate: `${(report.killRate * 100).toFixed(1)}%`,
    });

    return report;
  }

  /**
   * Generate all possible mutations for a workflow
   */
  generateMutations(workflow: WorkflowDefinition): Mutation[] {
    const mutations: Mutation[] = [];

    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      // Mutation 1: Delete node
      mutations.push({
        type: "delete-node",
        nodeId,
        description: `Delete node '${nodeId}' (${node.type})`,
      });

      // Mutation 2: Change node type
      if (node.type !== "action") {
        mutations.push({
          type: "change-type",
          nodeId,
          description: `Change node '${nodeId}' type from '${node.type}' to 'action'`,
          newType: "action",
        });
      }

      // Mutation 3: Negate condition (for condition nodes)
      if (node.type === "condition" && node.config?.condition) {
        mutations.push({
          type: "negate-condition",
          nodeId,
          description: `Negate condition in node '${nodeId}'`,
        });
      }

      // Mutation 4: Swap next targets
      if (node.next && node.next.length >= 2) {
        mutations.push({
          type: "swap-next",
          nodeId,
          description: `Swap next targets in node '${nodeId}'`,
        });
      }

      // Mutation 5: Set zero timeout
      if (node.timeout && node.timeout > 0) {
        mutations.push({
          type: "set-zero-timeout",
          nodeId,
          description: `Set zero timeout for node '${nodeId}'`,
        });
      }

      // Mutation 6: Corrupt config
      if (node.config) {
        mutations.push({
          type: "corrupt-config",
          nodeId,
          description: `Corrupt config of node '${nodeId}'`,
        });
      }
    }

    return mutations;
  }

  /**
   * Test if a mutation would be caught by validation
   */
  testMutation(
    mutation: Mutation,
    workflow: WorkflowDefinition,
  ): MutationResult {
    const mutatedWorkflow = this.applyMutation(workflow, mutation);

    // Check if the mutation would be caught by structural validation
    const validationIssues = this.validateWorkflow(mutatedWorkflow);

    const killed = validationIssues.length > 0;

    return {
      mutation,
      killed,
      reason: killed
        ? `Mutation caught: ${validationIssues.join(", ")}`
        : "Mutation not caught by validation",
    };
  }

  /**
   * Apply a mutation to a workflow (returns a new copy)
   */
  private applyMutation(
    workflow: WorkflowDefinition,
    mutation: Mutation,
  ): WorkflowDefinition {
    const mutated = JSON.parse(JSON.stringify(workflow));

    switch (mutation.type) {
      case "delete-node":
        delete mutated.nodes[mutation.nodeId];
        break;

      case "change-type":
        if (mutated.nodes[mutation.nodeId]) {
          mutated.nodes[mutation.nodeId].type = mutation.newType || "action";
          // Remove type-specific config
          delete mutated.nodes[mutation.nodeId].config;
        }
        break;

      case "negate-condition":
        if (mutated.nodes[mutation.nodeId]?.config?.condition) {
          mutated.nodes[mutation.nodeId].config.condition =
            `!(${mutated.nodes[mutation.nodeId].config.condition})`;
        }
        break;

      case "swap-next":
        if (mutated.nodes[mutation.nodeId]?.next?.length >= 2) {
          const next = mutated.nodes[mutation.nodeId].next;
          [next[0], next[1]] = [next[1], next[0]];
        }
        break;

      case "set-zero-timeout":
        if (mutated.nodes[mutation.nodeId]) {
          mutated.nodes[mutation.nodeId].timeout = 0;
        }
        break;

      case "corrupt-config":
        if (mutated.nodes[mutation.nodeId]?.config) {
          mutated.nodes[mutation.nodeId].config = { corrupted: true };
        }
        break;
    }

    return mutated;
  }

  /**
   * Validate a workflow definition and return issues
   */
  private validateWorkflow(workflow: WorkflowDefinition): string[] {
    const issues: string[] = [];

    // Check 1: Start node exists
    if (!workflow.nodes[workflow.startNode]) {
      issues.push("Start node does not exist");
    }

    // Check 2: All referenced nodes exist
    for (const [nodeId, node] of Object.entries(workflow.nodes)) {
      if (node.next) {
        for (const nextNode of node.next) {
          if (!workflow.nodes[nextNode]) {
            issues.push(
              `Node '${nodeId}' references non-existent node '${nextNode}'`,
            );
          }
        }
      }
    }

    // Check 3: No orphan nodes (except start node)
    const referencedNodes = new Set<string>([workflow.startNode]);
    for (const node of Object.values(workflow.nodes)) {
      if (node.next) {
        for (const next of node.next) {
          referencedNodes.add(next);
        }
      }
    }

    for (const nodeId of Object.keys(workflow.nodes)) {
      if (!referencedNodes.has(nodeId) && nodeId !== workflow.startNode) {
        issues.push(`Orphan node '${nodeId}' is not referenced`);
      }
    }

    // Check 4: No empty workflows
    if (Object.keys(workflow.nodes).length === 0) {
      issues.push("Workflow has no nodes");
    }

    return issues;
  }
}
