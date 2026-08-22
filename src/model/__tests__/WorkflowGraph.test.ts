import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../Workflow";
import { fromGraph, toGraph } from "../WorkflowGraph";

function roundTrip(definition: WorkflowDefinition) {
  const graph = toGraph(definition);
  return { graph, restored: fromGraph(graph) };
}

describe("WorkflowGraph adapter", () => {
  it("does not mutate the input definition", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "a",
      nodes: {
        a: {
          id: "a",
          type: "router",
          config: {
            routes: [{ condition: "${x}", target: "b" }],
            defaultTarget: "c",
          },
        },
        b: { id: "b", type: "action" },
        c: { id: "c", type: "action" },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(definition));

    toGraph(definition);

    expect(definition).toEqual(snapshot);
  });

  it("round-trips next/failureNext/conditionalNext/defaultNext/rollbackTo", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "a",
      nodes: {
        a: {
          id: "a",
          type: "action",
          next: ["b", "c"],
          failureNext: ["d"],
          conditionalNext: [{ condition: "${x > 1}", target: "b" }],
          defaultNext: "c",
          rollbackTo: "d",
        },
        b: { id: "b", type: "action" },
        c: { id: "c", type: "action" },
        d: { id: "d", type: "action" },
      },
    };

    const { restored } = roundTrip(definition);
    expect(restored).toEqual(definition);
  });

  it("round-trips a condition node's trueBranch/falseBranch via edges", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "c",
      nodes: {
        c: {
          id: "c",
          type: "condition",
          config: {
            condition: "${amount > 1000}",
            trueBranch: "vip",
            falseBranch: "std",
          },
        },
        vip: { id: "vip", type: "action" },
        std: { id: "std", type: "action" },
      },
    };

    const { graph, restored } = roundTrip(definition);
    const conditionNode = graph.nodes.find((n) => n.id === "c")!;
    expect(conditionNode.data.config).toEqual({
      condition: "${amount > 1000}",
    });
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "c",
        target: "vip",
        kind: "condition-true",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        source: "c",
        target: "std",
        kind: "condition-false",
      }),
    );
    expect(restored).toEqual(definition);
  });

  it("round-trips a router node's routes[] and defaultTarget via edges", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "r",
      nodes: {
        r: {
          id: "r",
          type: "router",
          config: {
            routes: [
              { condition: "${type === 'vip'}", target: "vip", priority: 1 },
              { condition: "${type === 'std'}", target: "std" },
            ],
            defaultTarget: "fallback",
          },
        },
        vip: { id: "vip", type: "action" },
        std: { id: "std", type: "action" },
        fallback: { id: "fallback", type: "action" },
      },
    };

    const { graph, restored } = roundTrip(definition);
    expect(graph.nodes.find((n) => n.id === "r")!.data.config).toEqual({});
    expect(restored).toEqual(definition);
  });

  it("round-trips a loop node's body via edges", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "l",
      nodes: {
        l: {
          id: "l",
          type: "loop",
          config: {
            collection: "${items}",
            itemVariable: "item",
            body: "process",
          },
        },
        process: { id: "process", type: "action" },
      },
    };

    const { graph, restored } = roundTrip(definition);
    expect(graph.nodes.find((n) => n.id === "l")!.data.config).toEqual({
      collection: "${items}",
      itemVariable: "item",
    });
    expect(restored).toEqual(definition);
  });

  it("round-trips an approval node's approvedTarget/rejectedTarget via edges", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "ap",
      nodes: {
        ap: {
          id: "ap",
          type: "approval",
          config: {
            prompt: "Approve?",
            approvedTarget: "yes",
            rejectedTarget: "no",
          },
        },
        yes: { id: "yes", type: "action" },
        no: { id: "no", type: "action" },
      },
    };

    const { graph, restored } = roundTrip(definition);
    expect(graph.nodes.find((n) => n.id === "ap")!.data.config).toEqual({
      prompt: "Approve?",
    });
    expect(restored).toEqual(definition);
  });

  it("round-trips an approval node missing rejectedTarget (optional edge omitted)", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "ap",
      nodes: {
        ap: {
          id: "ap",
          type: "approval",
          config: { approvedTarget: "yes" },
        },
        yes: { id: "yes", type: "action" },
      },
    };

    const { graph, restored } = roundTrip(definition);
    expect(graph.edges.some((e) => e.kind === "approval-rejected")).toBe(false);
    expect(restored).toEqual(definition);
  });

  it("round-trips http/sql/queue declarative configs untouched (no edges)", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "h",
      nodes: {
        h: {
          id: "h",
          type: "http",
          config: { method: "GET", url: "https://example.com" },
          next: ["s"],
        },
        s: {
          id: "s",
          type: "sql",
          config: { connection: "default", query: "SELECT 1" },
          next: ["q"],
        },
        q: {
          id: "q",
          type: "queue",
          config: {
            operation: "publish",
            queue: "default",
            message: { ok: true },
          },
        },
      },
    };

    const { restored } = roundTrip(definition);
    expect(restored).toEqual(definition);
  });

  it("round-trips a workflow with no config on a node (action/wait/event)", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "a",
      nodes: {
        a: { id: "a", type: "action", next: ["w"] },
        w: { id: "w", type: "wait", timeout: 5000, next: ["e"] },
        e: { id: "e", type: "event", onEvent: "order.paid" },
      },
    };

    const { restored } = roundTrip(definition);
    expect(restored).toEqual(definition);
  });

  it("drops the unserializable action closure without throwing", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      startNode: "a",
      nodes: {
        a: { id: "a", type: "action", action: async () => ({}) },
      },
    };

    const graph = toGraph(definition);
    expect(graph.nodes[0].data.action).toBeUndefined();
    const restored = fromGraph(graph);
    expect(restored.nodes.a.action).toBeUndefined();
  });

  it("preserves workflow-level metadata (cron, triggerEvents, schemas)", () => {
    const definition: WorkflowDefinition = {
      id: "wf",
      name: "wf",
      version: "2",
      description: "desc",
      startNode: "a",
      cron: "0 * * * *",
      triggerEvents: ["order.created"],
      metadata: { owner: "team-a" },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      nodes: { a: { id: "a", type: "action" } },
    };

    const { restored } = roundTrip(definition);
    expect(restored).toEqual(definition);
  });
});
