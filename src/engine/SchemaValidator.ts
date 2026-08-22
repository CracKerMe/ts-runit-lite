import type {
  ApprovalNodeConfig,
  TaskType,
  WorkflowDefinition,
} from "../model/Workflow";
import { validateExpression } from "./ExpressionEvaluator";

/**
 * Validation error details
 */
export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

/**
 * Validation warning details
 */
export interface ValidationWarning {
  path: string;
  message: string;
  code: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Schema Validator for workflow definitions
 * Validates workflow structure, node types, references, and expressions
 */
export class SchemaValidator {
  private registeredNodeTypes: Set<TaskType>;

  constructor(registeredNodeTypes?: TaskType[]) {
    // Default registered node types from the existing system
    this.registeredNodeTypes = new Set(
      registeredNodeTypes || [
        "action",
        "wait",
        "event",
        "rollback",
        "subworkflow",
        "http",
        "sql",
        "queue",
        "condition",
        "router",
        "loop",
        "approval",
        "notification",
      ],
    );
  }

  /**
   * Register a new node type
   */
  registerNodeType(nodeType: TaskType): void {
    this.registeredNodeTypes.add(nodeType);
  }

  /**
   * Validate a workflow definition
   */
  validate(definition: WorkflowDefinition): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Validate schema structure
    errors.push(...this.validateSchema(definition));

    // Validate node types
    errors.push(...this.validateNodeTypes(definition));

    // Validate node ID uniqueness
    errors.push(...this.validateNodeIdUniqueness(definition));

    // Validate node references
    errors.push(...this.validateNodeReferences(definition));

    // Validate expressions
    errors.push(...this.validateExpressions(definition));

    // Detect circular dependencies
    errors.push(...this.detectCircularDependencies(definition));

    // Detect unreachable nodes
    warnings.push(...this.detectUnreachableNodes(definition));

    // Validate node-specific configurations
    errors.push(...this.validateNodeConfigs(definition));

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate node-specific configurations based on node type
   */
  private validateNodeConfigs(
    definition: WorkflowDefinition,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors;
    }

    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      const config = node.config;
      const pathPrefix = `nodes.${nodeId}`;

      switch (node.type) {
        case "wait":
          if (node.timeout === undefined) {
            errors.push({
              path: `${pathPrefix}.timeout`,
              message: "Wait node requires a timeout",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          break;

        case "event":
          if (!node.onEvent) {
            errors.push({
              path: `${pathPrefix}.onEvent`,
              message: "Event node requires an onEvent",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          break;

        case "http":
          if (config) {
            if (!config.url) {
              errors.push({
                path: `${pathPrefix}.config.url`,
                message: "HTTP node requires a url",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
            if (!config.method) {
              errors.push({
                path: `${pathPrefix}.config.method`,
                message: "HTTP node requires a method",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
          }
          break;

        case "sql":
          if (config && !config.query) {
            errors.push({
              path: `${pathPrefix}.config.query`,
              message: "SQL node requires a query",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          break;

        case "notification":
          if (!config) {
            errors.push({
              path: `${pathPrefix}.config`,
              message: "Notification node requires config",
              code: "MISSING_REQUIRED_FIELD",
            });
            break;
          }
          if (!config.channel) {
            errors.push({
              path: `${pathPrefix}.config.channel`,
              message: "Notification node requires a channel",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          if (!config.target) {
            errors.push({
              path: `${pathPrefix}.config.target`,
              message: "Notification node requires a target",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          if (!config.template) {
            errors.push({
              path: `${pathPrefix}.config.template`,
              message: "Notification node requires a template",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          break;

        case "loop":
          if (config) {
            if (!config.collection) {
              errors.push({
                path: `${pathPrefix}.config.collection`,
                message: "Loop node requires a collection expression",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
            if (!config.itemVariable) {
              errors.push({
                path: `${pathPrefix}.config.itemVariable`,
                message: "Loop node requires an itemVariable",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
            if (!config.body) {
              errors.push({
                path: `${pathPrefix}.config.body`,
                message: "Loop node requires a body node ID",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
          }
          break;

        case "subworkflow":
          if (!node.subworkflowId) {
            errors.push({
              path: `${pathPrefix}.subworkflowId`,
              message: "Subworkflow node requires a subworkflowId",
              code: "MISSING_REQUIRED_FIELD",
            });
          }
          break;
      }
    });

    return errors;
  }

  /**
   * Validate workflow definition against JSON schema
   */
  private validateSchema(definition: WorkflowDefinition): ValidationError[] {
    const errors: ValidationError[] = [];

    // Required fields
    if (!definition.id || typeof definition.id !== "string") {
      errors.push({
        path: "id",
        message: "Workflow ID is required and must be a string",
        code: "MISSING_REQUIRED_FIELD",
      });
    }

    if (!definition.name || typeof definition.name !== "string") {
      errors.push({
        path: "name",
        message: "Workflow name is required and must be a string",
        code: "MISSING_REQUIRED_FIELD",
      });
    }

    if (!definition.nodes || typeof definition.nodes !== "object") {
      errors.push({
        path: "nodes",
        message: "Workflow nodes are required and must be an object",
        code: "MISSING_REQUIRED_FIELD",
      });
      return errors; // Cannot continue validation without nodes
    }

    if (!definition.startNode || typeof definition.startNode !== "string") {
      errors.push({
        path: "startNode",
        message: "Start node is required and must be a string",
        code: "MISSING_REQUIRED_FIELD",
      });
    }

    // Validate optional fields
    if (
      definition.version !== undefined &&
      typeof definition.version !== "string"
    ) {
      errors.push({
        path: "version",
        message: "Version must be a string",
        code: "INVALID_TYPE",
      });
    }

    if (
      definition.description !== undefined &&
      typeof definition.description !== "string"
    ) {
      errors.push({
        path: "description",
        message: "Description must be a string",
        code: "INVALID_TYPE",
      });
    }

    if (definition.cron !== undefined && typeof definition.cron !== "string") {
      errors.push({
        path: "cron",
        message: "Cron expression must be a string",
        code: "INVALID_TYPE",
      });
    }

    if (definition.triggerEvents !== undefined) {
      if (!Array.isArray(definition.triggerEvents)) {
        errors.push({
          path: "triggerEvents",
          message: "Trigger events must be an array",
          code: "INVALID_TYPE",
        });
      } else {
        definition.triggerEvents.forEach((event, index) => {
          if (typeof event !== "string") {
            errors.push({
              path: `triggerEvents[${index}]`,
              message: "Trigger event must be a string",
              code: "INVALID_TYPE",
            });
          }
        });
      }
    }

    // Validate node structure
    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      if (!node.id || typeof node.id !== "string") {
        errors.push({
          path: `nodes.${nodeId}.id`,
          message: "Node ID is required and must be a string",
          code: "MISSING_REQUIRED_FIELD",
        });
      }

      if (!node.type || typeof node.type !== "string") {
        errors.push({
          path: `nodes.${nodeId}.type`,
          message: "Node type is required and must be a string",
          code: "MISSING_REQUIRED_FIELD",
        });
      }

      // Validate optional arrays
      if (node.next !== undefined && !Array.isArray(node.next)) {
        errors.push({
          path: `nodes.${nodeId}.next`,
          message: "Node next must be an array",
          code: "INVALID_TYPE",
        });
      }

      if (node.failureNext !== undefined && !Array.isArray(node.failureNext)) {
        errors.push({
          path: `nodes.${nodeId}.failureNext`,
          message: "Node failureNext must be an array",
          code: "INVALID_TYPE",
        });
      }

      if (node.conditionalNext !== undefined) {
        if (!Array.isArray(node.conditionalNext)) {
          errors.push({
            path: `nodes.${nodeId}.conditionalNext`,
            message: "Node conditionalNext must be an array",
            code: "INVALID_TYPE",
          });
        } else {
          node.conditionalNext.forEach((branch, index) => {
            if (!branch.condition || typeof branch.condition !== "string") {
              errors.push({
                path: `nodes.${nodeId}.conditionalNext[${index}].condition`,
                message:
                  "Conditional branch condition is required and must be a string",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
            if (!branch.target || typeof branch.target !== "string") {
              errors.push({
                path: `nodes.${nodeId}.conditionalNext[${index}].target`,
                message:
                  "Conditional branch target is required and must be a string",
                code: "MISSING_REQUIRED_FIELD",
              });
            }
          });
        }
      }
    });

    return errors;
  }

  /**
   * Validate node types against registered types
   */
  private validateNodeTypes(definition: WorkflowDefinition): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors; // Already caught by validateSchema
    }

    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      if (node.type && !this.registeredNodeTypes.has(node.type)) {
        errors.push({
          path: `nodes.${nodeId}.type`,
          message: `Unknown node type: ${node.type}. Registered types: ${Array.from(this.registeredNodeTypes).join(", ")}`,
          code: "UNKNOWN_NODE_TYPE",
        });
      }
    });

    return errors;
  }

  /**
   * Validate node ID uniqueness
   */
  private validateNodeIdUniqueness(
    definition: WorkflowDefinition,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors; // Already caught by validateSchema
    }

    const nodeIds = new Set<string>();
    const duplicates = new Set<string>();

    Object.entries(definition.nodes).forEach(([_nodeId, node]) => {
      if (nodeIds.has(node.id)) {
        duplicates.add(node.id);
      }
      nodeIds.add(node.id);
    });

    duplicates.forEach((nodeId) => {
      errors.push({
        path: `nodes.${nodeId}`,
        message: `Duplicate node ID: ${nodeId}`,
        code: "DUPLICATE_NODE_ID",
      });
    });

    return errors;
  }

  /**
   * Validate node references (next, failureNext, conditionalNext, defaultNext, startNode)
   */
  private validateNodeReferences(
    definition: WorkflowDefinition,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors; // Already caught by validateSchema
    }

    const nodeIds = new Set(Object.keys(definition.nodes));

    // Validate startNode reference
    if (definition.startNode && !nodeIds.has(definition.startNode)) {
      errors.push({
        path: "startNode",
        message: `Start node references non-existent node: ${definition.startNode}`,
        code: "INVALID_NODE_REFERENCE",
      });
    }

    // Validate node references
    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      // Validate next references
      if (node.next) {
        node.next.forEach((nextId, index) => {
          if (!nodeIds.has(nextId)) {
            errors.push({
              path: `nodes.${nodeId}.next[${index}]`,
              message: `Node references non-existent node: ${nextId}`,
              code: "INVALID_NODE_REFERENCE",
            });
          }
        });
      }

      // Validate failureNext references
      if (node.failureNext) {
        node.failureNext.forEach((nextId, index) => {
          if (!nodeIds.has(nextId)) {
            errors.push({
              path: `nodes.${nodeId}.failureNext[${index}]`,
              message: `Node references non-existent node: ${nextId}`,
              code: "INVALID_NODE_REFERENCE",
            });
          }
        });
      }

      // Validate conditionalNext references
      if (node.conditionalNext) {
        node.conditionalNext.forEach((branch, index) => {
          if (branch.target && !nodeIds.has(branch.target)) {
            errors.push({
              path: `nodes.${nodeId}.conditionalNext[${index}].target`,
              message: `Conditional branch references non-existent node: ${branch.target}`,
              code: "INVALID_NODE_REFERENCE",
            });
          }
        });
      }

      // Validate defaultNext reference
      if (node.defaultNext && !nodeIds.has(node.defaultNext)) {
        errors.push({
          path: `nodes.${nodeId}.defaultNext`,
          message: `Default branch references non-existent node: ${node.defaultNext}`,
          code: "INVALID_NODE_REFERENCE",
        });
      }

      // Validate rollbackTo reference
      if (node.rollbackTo && !nodeIds.has(node.rollbackTo)) {
        errors.push({
          path: `nodes.${nodeId}.rollbackTo`,
          message: `Rollback references non-existent node: ${node.rollbackTo}`,
          code: "INVALID_NODE_REFERENCE",
        });
      }

      const approvalConfig = node.config as ApprovalNodeConfig | undefined;
      if (
        node.type === "approval" &&
        approvalConfig?.approvedTarget &&
        !nodeIds.has(approvalConfig.approvedTarget)
      ) {
        errors.push({
          path: `nodes.${nodeId}.config.approvedTarget`,
          message: `Approval approvedTarget references non-existent node: ${approvalConfig.approvedTarget}`,
          code: "INVALID_NODE_REFERENCE",
        });
      }
      if (
        node.type === "approval" &&
        approvalConfig?.rejectedTarget &&
        !nodeIds.has(approvalConfig.rejectedTarget)
      ) {
        errors.push({
          path: `nodes.${nodeId}.config.rejectedTarget`,
          message: `Approval rejectedTarget references non-existent node: ${approvalConfig.rejectedTarget}`,
          code: "INVALID_NODE_REFERENCE",
        });
      }
    });

    return errors;
  }

  /**
   * Validate expression syntax in conditional branches
   */
  private validateExpressions(
    definition: WorkflowDefinition,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors; // Already caught by validateSchema
    }

    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      if (node.conditionalNext) {
        node.conditionalNext.forEach((branch, index) => {
          if (branch.condition) {
            const result = validateExpression(branch.condition);
            if (!result.valid) {
              errors.push({
                path: `nodes.${nodeId}.conditionalNext[${index}].condition`,
                message: `Invalid expression syntax: ${result.error}`,
                code: "INVALID_EXPRESSION",
              });
            }
          }
        });
      }
    });

    return errors;
  }

  /**
   * Detect circular dependencies using topological sort (Kahn's algorithm)
   */
  private detectCircularDependencies(
    definition: WorkflowDefinition,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return errors; // Already caught by validateSchema
    }

    const nodeIds = Object.keys(definition.nodes);
    const inDegree = new Map<string, number>();
    const adjacencyList = new Map<string, string[]>();

    // Initialize graph
    nodeIds.forEach((nodeId) => {
      inDegree.set(nodeId, 0);
      adjacencyList.set(nodeId, []);
    });

    // Build adjacency list and calculate in-degrees
    Object.entries(definition.nodes).forEach(([nodeId, node]) => {
      const edges: string[] = [];

      if (node.next) {
        edges.push(...node.next);
      }
      if (node.failureNext) {
        edges.push(...node.failureNext);
      }
      if (node.conditionalNext) {
        edges.push(...node.conditionalNext.map((b) => b.target));
      }
      if (node.defaultNext) {
        edges.push(node.defaultNext);
      }
      if (node.type === "approval") {
        const approvalConfig = node.config as ApprovalNodeConfig | undefined;
        if (approvalConfig?.approvedTarget) {
          edges.push(approvalConfig.approvedTarget);
        }
        if (approvalConfig?.rejectedTarget) {
          edges.push(approvalConfig.rejectedTarget);
        }
      }

      edges.forEach((targetId) => {
        if (inDegree.has(targetId)) {
          adjacencyList.get(nodeId)?.push(targetId);
          inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
        }
      });
    });

    // Topological sort using Kahn's algorithm
    const queue: string[] = [];
    const visited = new Set<string>();

    // Start with nodes that have no incoming edges
    inDegree.forEach((degree, nodeId) => {
      if (degree === 0) {
        queue.push(nodeId);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      visited.add(current);

      const neighbors = adjacencyList.get(current) || [];
      neighbors.forEach((neighbor) => {
        const newDegree = (inDegree.get(neighbor) || 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      });
    }

    // If not all nodes were visited, there's a cycle
    if (visited.size < nodeIds.length) {
      const unvisited = nodeIds.filter((id) => !visited.has(id));
      errors.push({
        path: "nodes",
        message: `Circular dependency detected involving nodes: ${unvisited.join(", ")}`,
        code: "CIRCULAR_DEPENDENCY",
      });
    }

    return errors;
  }

  /**
   * Detect unreachable nodes using graph traversal
   */
  private detectUnreachableNodes(
    definition: WorkflowDefinition,
  ): ValidationWarning[] {
    const warnings: ValidationWarning[] = [];

    if (!definition.nodes || typeof definition.nodes !== "object") {
      return warnings; // Already caught by validateSchema
    }

    const reachable = new Set<string>();
    const queue: string[] = [definition.startNode];

    // BFS to find all reachable nodes
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) {
        continue;
      }
      reachable.add(current);

      const node = definition.nodes[current];
      if (!node) {
        continue;
      }

      // Add all possible next nodes to queue
      if (node.next) {
        queue.push(...node.next);
      }
      if (node.failureNext) {
        queue.push(...node.failureNext);
      }
      if (node.conditionalNext) {
        queue.push(...node.conditionalNext.map((b) => b.target));
      }
      if (node.defaultNext) {
        queue.push(node.defaultNext);
      }
    }

    // Find unreachable nodes
    const allNodeIds = Object.keys(definition.nodes);
    const unreachable = allNodeIds.filter((id) => !reachable.has(id));

    unreachable.forEach((nodeId) => {
      warnings.push({
        path: `nodes.${nodeId}`,
        message: `Node is unreachable from start node: ${nodeId}`,
        code: "UNREACHABLE_NODE",
      });
    });

    return warnings;
  }
}
