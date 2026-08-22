import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../Workflow";
import {
  getContextVariableSuggestions,
  getNodeOutputVariableSuggestions,
  getVariableSuggestions,
} from "../WorkflowVariables";

const definition: WorkflowDefinition = {
  id: "wf",
  name: "wf",
  startNode: "fetch",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string" },
      amount: { type: "number" },
    },
  },
  nodes: {
    fetch: {
      id: "fetch",
      type: "http",
      config: { method: "GET", url: "https://example.com" },
      next: ["route"],
      outputSchema: {
        type: "object",
        properties: { status: { type: "number" }, body: { type: "object" } },
      },
    },
    route: {
      id: "route",
      type: "condition",
      config: {
        condition: "${fetch.output.status == 200}",
        trueBranch: "ok",
        falseBranch: "fail",
      },
    },
    ok: { id: "ok", type: "action" },
    fail: { id: "fail", type: "action" },
  },
};

describe("WorkflowVariables", () => {
  it("suggests context.* fields from the declared inputSchema", () => {
    const suggestions = getContextVariableSuggestions(definition);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        {
          expression: "${context.orderId}",
          path: "context.orderId",
          source: "context",
          type: "string",
        },
        {
          expression: "${context.amount}",
          path: "context.amount",
          source: "context",
          type: "number",
        },
      ]),
    );
  });

  it("falls back to bare ${context} when no inputSchema is declared", () => {
    const suggestions = getContextVariableSuggestions({
      inputSchema: undefined,
    });
    expect(suggestions).toEqual([
      { expression: "${context}", path: "context", source: "context" },
    ]);
  });

  it("suggests ${nodeId.output} for every node by default", () => {
    const suggestions = getNodeOutputVariableSuggestions(definition);
    const nodeIds = suggestions.map((s) => s.nodeId);
    expect(nodeIds).toEqual(
      expect.arrayContaining(["fetch", "route", "ok", "fail"]),
    );
  });

  it("expands outputSchema properties into ${nodeId.output.field}", () => {
    const suggestions = getNodeOutputVariableSuggestions(definition);
    expect(suggestions).toContainEqual({
      expression: "${fetch.output.status}",
      path: "fetch.output.status",
      source: "node-output",
      nodeId: "fetch",
      type: "number",
    });
  });

  it("scopes suggestions to ancestors when `before` is given", () => {
    const suggestions = getNodeOutputVariableSuggestions(definition, {
      before: "route",
    });
    const nodeIds = new Set(suggestions.map((s) => s.nodeId));
    expect(nodeIds.has("fetch")).toBe(true);
    expect(nodeIds.has("route")).toBe(false);
    expect(nodeIds.has("ok")).toBe(false);
    expect(nodeIds.has("fail")).toBe(false);
  });

  it("combines context and node-output suggestions", () => {
    const suggestions = getVariableSuggestions(definition, { before: "route" });
    expect(suggestions.some((s) => s.source === "context")).toBe(true);
    expect(
      suggestions.some(
        (s) => s.source === "node-output" && s.nodeId === "fetch",
      ),
    ).toBe(true);
  });
});
