// oxlint-disable no-explicit-any -- test/example file uses dynamic types
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../../model/Workflow";
import { SchemaValidator } from "../../engine/SchemaValidator";

describe("SchemaValidator", () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    validator = new SchemaValidator();
  });

  describe("Schema Validation", () => {
    it("should validate a valid workflow definition", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            next: ["node2"],
          },
          node2: {
            id: "node2",
            type: "wait",
            timeout: 1000,
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject workflow without id", () => {
      const workflow = {
        name: "Test Workflow",
        startNode: "node1",
        nodes: {},
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "id",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should reject workflow without name", () => {
      const workflow = {
        id: "test-workflow",
        startNode: "node1",
        nodes: {},
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "name",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should reject workflow without nodes", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should reject workflow without startNode", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        nodes: {},
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "startNode",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should validate optional fields with correct types", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        version: "1.0.0",
        description: "A test workflow",
        startNode: "node1",
        cron: "0 0 * * *",
        triggerEvents: ["event1", "event2"],
        nodes: {
          node1: {
            id: "node1",
            type: "action",
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject invalid version type", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        version: 123,
        startNode: "node1",
        nodes: {},
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "version",
          code: "INVALID_TYPE",
        }),
      );
    });

    it("should reject invalid triggerEvents type", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        triggerEvents: "not-an-array",
        nodes: {},
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "triggerEvents",
          code: "INVALID_TYPE",
        }),
      );
    });

    it("should validate node structure", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            next: ["node2"],
            failureNext: ["node3"],
            conditionalNext: [
              { condition: "context.value > 10", target: "node2" },
            ],
            defaultNext: "node3",
          },
          node2: {
            id: "node2",
            type: "wait",
            timeout: 1000,
          },
          node3: {
            id: "node3",
            type: "action",
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });

    it("should reject node without id", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            type: "action",
          },
        },
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.id",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should reject node without type", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
          },
        },
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.type",
          code: "MISSING_REQUIRED_FIELD",
        }),
      );
    });

    it("should validate notification nodes with required config", () => {
      const workflow: WorkflowDefinition = {
        id: "notify-workflow",
        name: "Notify Workflow",
        startNode: "notify",
        nodes: {
          notify: {
            id: "notify",
            type: "notification",
            config: {
              channel: "slack",
              target: "#ops",
              template: "订单 {{context.orderId}} 已完成",
            },
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });

    it("should reject notification nodes without required fields", () => {
      const workflow: WorkflowDefinition = {
        id: "notify-workflow",
        name: "Notify Workflow",
        startNode: "notify",
        nodes: {
          notify: {
            id: "notify",
            type: "notification",
            config: {},
          },
        },
      } as unknown as WorkflowDefinition;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "nodes.notify.config.channel",
            code: "MISSING_REQUIRED_FIELD",
          }),
          expect.objectContaining({
            path: "nodes.notify.config.target",
            code: "MISSING_REQUIRED_FIELD",
          }),
          expect.objectContaining({
            path: "nodes.notify.config.template",
            code: "MISSING_REQUIRED_FIELD",
          }),
        ]),
      );
    });
  });

  describe("Node Type Validation", () => {
    it("should accept registered node types", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action" },
          node2: { id: "node2", type: "wait", timeout: 1000 },
          node3: { id: "node3", type: "event", onEvent: "test-event" },
          node4: { id: "node4", type: "rollback" },
          node5: { id: "node5", type: "subworkflow", subworkflowId: "sub1" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });

    it("should reject unknown node type", () => {
      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "unknown-type",
          },
        },
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.type",
          code: "UNKNOWN_NODE_TYPE",
        }),
      );
    });

    it("should allow registering custom node types", () => {
      validator.registerNodeType("custom" as any);

      const workflow = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "custom",
          },
        },
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });
  });

  describe("Node ID Uniqueness", () => {
    it("should detect duplicate node IDs", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "duplicate", type: "action" },
          node2: { id: "duplicate", type: "wait", timeout: 1000 },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "DUPLICATE_NODE_ID",
          message: expect.stringContaining("duplicate"),
        }),
      );
    });

    it("should accept unique node IDs", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action" },
          node2: { id: "node2", type: "wait", timeout: 1000 },
          node3: { id: "node3", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });
  });

  describe("Node Reference Validation", () => {
    it("should validate startNode reference", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "non-existent",
        nodes: {
          node1: { id: "node1", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "startNode",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });

    it("should validate next references", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            next: ["non-existent"],
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.next[0]",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });

    it("should validate failureNext references", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            failureNext: ["non-existent"],
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.failureNext[0]",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });

    it("should validate conditionalNext target references", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            conditionalNext: [
              { condition: "context.value > 10", target: "non-existent" },
            ],
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.conditionalNext[0].target",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });

    it("should validate defaultNext references", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            defaultNext: "non-existent",
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.defaultNext",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });

    it("should validate rollbackTo references", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            rollbackTo: "non-existent",
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.rollbackTo",
          code: "INVALID_NODE_REFERENCE",
        }),
      );
    });
  });

  describe("Expression Validation", () => {
    it("should validate valid expressions", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            conditionalNext: [
              { condition: "context.value > 10", target: "node2" },
              { condition: "context.status == 'active'", target: "node3" },
            ],
            next: ["node2"],
          },
          node2: { id: "node2", type: "action" },
          node3: { id: "node3", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid expression syntax", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            conditionalNext: [
              { condition: "eval('malicious code')", target: "node2" },
            ],
            next: ["node2"],
          },
          node2: { id: "node2", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: "nodes.node1.conditionalNext[0].condition",
          code: "INVALID_EXPRESSION",
        }),
      );
    });

    it("should reject expressions with forbidden patterns", () => {
      const forbiddenExpressions = [
        "Function('return 1')",
        "import('module')",
        "require('module')",
        "process.exit()",
        "global.something",
      ];

      forbiddenExpressions.forEach((expr) => {
        const workflow: WorkflowDefinition = {
          id: "test-workflow",
          name: "Test Workflow",
          startNode: "node1",
          nodes: {
            node1: {
              id: "node1",
              type: "action",
              conditionalNext: [{ condition: expr, target: "node2" }],
              next: ["node2"],
            },
            node2: { id: "node2", type: "action" },
          },
        };

        const result = validator.validate(workflow);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            code: "INVALID_EXPRESSION",
          }),
        );
      });
    });
  });

  describe("Circular Dependency Detection", () => {
    it("should detect simple circular dependency", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node2"] },
          node2: { id: "node2", type: "action", next: ["node1"] },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "CIRCULAR_DEPENDENCY",
        }),
      );
    });

    it("should detect complex circular dependency", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node2"] },
          node2: { id: "node2", type: "action", next: ["node3"] },
          node3: { id: "node3", type: "action", next: ["node4"] },
          node4: { id: "node4", type: "action", next: ["node2"] },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "CIRCULAR_DEPENDENCY",
        }),
      );
    });

    it("should accept workflow without circular dependencies", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node2", "node3"] },
          node2: { id: "node2", type: "action", next: ["node4"] },
          node3: { id: "node3", type: "action", next: ["node4"] },
          node4: { id: "node4", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
    });

    it("should handle self-referencing node", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node1"] },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "CIRCULAR_DEPENDENCY",
        }),
      );
    });
  });

  describe("Unreachable Node Detection", () => {
    it("should detect unreachable nodes", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node2"] },
          node2: { id: "node2", type: "action" },
          node3: { id: "node3", type: "action" }, // Unreachable
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true); // Warnings don't make it invalid
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: "nodes.node3",
          code: "UNREACHABLE_NODE",
        }),
      );
    });

    it("should not warn about reachable nodes", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action", next: ["node2", "node3"] },
          node2: { id: "node2", type: "action", next: ["node4"] },
          node3: { id: "node3", type: "action", next: ["node4"] },
          node4: { id: "node4", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should detect multiple unreachable nodes", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: { id: "node1", type: "action" },
          node2: { id: "node2", type: "action" }, // Unreachable
          node3: { id: "node3", type: "action" }, // Unreachable
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: "nodes.node2",
          code: "UNREACHABLE_NODE",
        }),
      );
      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          path: "nodes.node3",
          code: "UNREACHABLE_NODE",
        }),
      );
    });

    it("should consider conditionalNext and failureNext branches", () => {
      const workflow: WorkflowDefinition = {
        id: "test-workflow",
        name: "Test Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            conditionalNext: [
              { condition: "context.value > 10", target: "node2" },
            ],
            failureNext: ["node3"],
            defaultNext: "node4",
          },
          node2: { id: "node2", type: "action" },
          node3: { id: "node3", type: "action" },
          node4: { id: "node4", type: "action" },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("Integration Tests", () => {
    it("should validate complex workflow with multiple issues", () => {
      const workflow = {
        id: "complex-workflow",
        name: "Complex Workflow",
        startNode: "node1",
        nodes: {
          node1: {
            id: "node1",
            type: "action",
            next: ["node2"],
            conditionalNext: [
              { condition: "eval('bad')", target: "node3" }, // Invalid expression
            ],
          },
          node2: {
            id: "node2",
            type: "unknown", // Unknown type
            next: ["node1"], // Circular dependency
          },
          node3: {
            id: "node3",
            type: "action",
            next: ["non-existent"], // Invalid reference
          },
          node4: {
            id: "node4",
            type: "action", // Unreachable
          },
        },
      } as any;

      const result = validator.validate(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.warnings.length).toBeGreaterThan(0);

      // Check for specific error types
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "INVALID_EXPRESSION" }),
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "UNKNOWN_NODE_TYPE" }),
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "CIRCULAR_DEPENDENCY" }),
      );
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: "INVALID_NODE_REFERENCE" }),
      );
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ code: "UNREACHABLE_NODE" }),
      );
    });

    it("should validate production-ready workflow", () => {
      const workflow: WorkflowDefinition = {
        id: "production-workflow",
        name: "Production Workflow",
        version: "1.0.0",
        description: "A production-ready workflow",
        startNode: "start",
        cron: "0 0 * * *",
        triggerEvents: ["user.created", "user.updated"],
        nodes: {
          start: {
            id: "start",
            type: "action",
            conditionalNext: [
              { condition: "context.type == 'premium'", target: "premium" },
              { condition: "context.type == 'basic'", target: "basic" },
            ],
            defaultNext: "basic",
          },
          premium: {
            id: "premium",
            type: "action",
            next: ["notify"],
            failureNext: ["error"],
          },
          basic: {
            id: "basic",
            type: "action",
            next: ["notify"],
            failureNext: ["error"],
          },
          notify: {
            id: "notify",
            type: "action",
            next: ["end"],
          },
          error: {
            id: "error",
            type: "rollback",
            rollbackTo: "start",
          },
          end: {
            id: "end",
            type: "action",
          },
        },
      };

      const result = validator.validate(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
