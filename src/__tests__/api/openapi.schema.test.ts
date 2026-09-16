import { describe, expect, it } from "vitest";
import { openApiSpec } from "../../api/openapi";

describe("openapi WorkflowDefinition schema", () => {
  it("is no longer the untyped `nodes: object` stub", () => {
    const schemas = openApiSpec.components.schemas as Record<
      string,
      Record<string, unknown>
    >;

    const nodes = schemas.WorkflowDefinition.properties as Record<
      string,
      unknown
    >;
    expect(nodes.nodes).not.toEqual({ type: "object" });
  });

  it("exposes a TaskNode component referenced from WorkflowDefinition.nodes", () => {
    const schemas = openApiSpec.components.schemas as Record<
      string,
      Record<string, unknown>
    >;
    expect(schemas).toHaveProperty("TaskNode");

    const nodesProp = (
      schemas.WorkflowDefinition.properties as Record<
        string,
        { additionalProperties?: { $ref?: string } }
      >
    ).nodes;
    expect(nodesProp.additionalProperties?.$ref).toBe(
      "#/components/schemas/TaskNode",
    );
  });

  it("exposes typed per-node-type config schemas, e.g. HttpNodeConfig", () => {
    const schemas = openApiSpec.components.schemas as Record<
      string,
      { required?: string[] }
    >;
    expect(schemas.HttpNodeConfig?.required).toEqual(
      expect.arrayContaining(["method", "url"]),
    );
    expect(schemas.LoopNodeConfig?.required).toEqual(
      expect.arrayContaining(["collection", "itemVariable", "body"]),
    );
  });
});
