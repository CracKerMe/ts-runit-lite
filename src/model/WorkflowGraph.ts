import type { TaskNode, TaskType, WorkflowDefinition } from "./Workflow";

/**
 * Bidirectional adapter between WorkflowDefinition (TaskNode map, where
 * outgoing connections are scattered across next/failureNext/
 * conditionalNext/defaultNext/rollbackTo and several type-specific config
 * fields — trueBranch/falseBranch, routes[].target, body, approvedTarget/
 * rejectedTarget) and a flat graph shape (`nodes[] + edges[]`) that maps
 * directly onto React Flow and similar canvas libraries.
 *
 * This is the ONE place that understands where each node type hides its
 * edges, so a frontend never has to reverse-engineer the native format.
 *
 * Known limitation: `action` nodes carry a live JS closure (TaskNode.action)
 * that cannot be represented in JSON at all — it is dropped on toGraph and
 * left unset on fromGraph. This mirrors the API layer, which already can't
 * accept functions over a JSON request body.
 */

export type GraphEdgeKind =
  | "next"
  | "failure"
  | "conditional"
  | "default"
  | "rollback"
  | "condition-true"
  | "condition-false"
  | "router-route"
  | "router-default"
  | "loop-body"
  | "approval-approved"
  | "approval-rejected";

/** Edge kinds every node type can originate, regardless of type. */
const COMMON_EDGE_KINDS: GraphEdgeKind[] = [
  "next",
  "failure",
  "conditional",
  "default",
  "rollback",
];

/** Additional edge kinds specific to a handful of control-flow node types. */
const TYPE_SPECIFIC_EDGE_KINDS: Partial<Record<TaskType, GraphEdgeKind[]>> = {
  condition: ["condition-true", "condition-false"],
  router: ["router-route", "router-default"],
  loop: ["loop-body"],
  approval: ["approval-approved", "approval-rejected"],
};

/** The edge kinds a node of `type` can originate — the common set plus any
 * type-specific ones. Used to tell a frontend which output "ports" to draw
 * for a given node type (see GET /workflows/node-templates). */
export function getSupportedEdgeKinds(type: TaskType): GraphEdgeKind[] {
  return [...COMMON_EDGE_KINDS, ...(TYPE_SPECIFIC_EDGE_KINDS[type] ?? [])];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: GraphEdgeKind;
  /** Branch condition expression, when this edge represents a conditional
   * branch (conditional / condition-true.. wait no — only conditional and
   * router-route carry a condition; condition-true/false carry none since
   * the single `condition` expression lives on the node itself). */
  label?: string;
  /** Router route priority, when this edge is a router-route. */
  priority?: number;
}

export interface GraphNode {
  id: string;
  type: TaskType;
  /** Every non-edge TaskNode field (timeout, config with edge-target
   * sub-fields stripped, retryPolicy, heartbeat, subworkflowId, schemas,
   * ...), ready for a property-panel form. */
  data: Record<string, unknown>;
}

export interface WorkflowGraph {
  id: string;
  name: string;
  version?: string;
  description?: string;
  startNode: string;
  cron?: string;
  triggerEvents?: string[];
  metadata?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

type ConfigRecord = Record<string, unknown>;

function asConfig(config: unknown): ConfigRecord {
  return config && typeof config === "object"
    ? { ...(config as ConfigRecord) }
    : {};
}

/** Converts a native WorkflowDefinition into a flat nodes[]/edges[] graph.
 * Does not mutate the input definition or its nodes. */
export function toGraph(definition: WorkflowDefinition): WorkflowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let edgeCounter = 0;
  const nextEdgeId = (source: string, target: string, kind: GraphEdgeKind) => {
    edgeCounter += 1;
    return `${source}->${target}#${kind}#${edgeCounter}`;
  };

  for (const [nodeId, node] of Object.entries(definition.nodes ?? {})) {
    const id = node.id ?? nodeId;
    const config = asConfig(node.config);

    (node.next ?? []).forEach((target) => {
      edges.push({
        id: nextEdgeId(id, target, "next"),
        source: id,
        target,
        kind: "next",
      });
    });
    (node.failureNext ?? []).forEach((target) => {
      edges.push({
        id: nextEdgeId(id, target, "failure"),
        source: id,
        target,
        kind: "failure",
      });
    });
    (node.conditionalNext ?? []).forEach(({ condition, target }) => {
      edges.push({
        id: nextEdgeId(id, target, "conditional"),
        source: id,
        target,
        kind: "conditional",
        label: condition,
      });
    });
    if (node.defaultNext) {
      edges.push({
        id: nextEdgeId(id, node.defaultNext, "default"),
        source: id,
        target: node.defaultNext,
        kind: "default",
      });
    }
    if (node.rollbackTo) {
      edges.push({
        id: nextEdgeId(id, node.rollbackTo, "rollback"),
        source: id,
        target: node.rollbackTo,
        kind: "rollback",
      });
    }

    // Per-type config fields that are edge targets get pulled out into
    // `edges` above and excluded from `strippedConfig` below, so the same
    // information isn't duplicated in both `data.config` and `edges`.
    let strippedConfig: ConfigRecord = config;

    if (node.type === "condition") {
      const { trueBranch, falseBranch, ...rest } = config as ConfigRecord & {
        trueBranch?: string;
        falseBranch?: string;
      };
      if (typeof trueBranch === "string" && trueBranch) {
        edges.push({
          id: nextEdgeId(id, trueBranch, "condition-true"),
          source: id,
          target: trueBranch,
          kind: "condition-true",
        });
      }
      if (typeof falseBranch === "string" && falseBranch) {
        edges.push({
          id: nextEdgeId(id, falseBranch, "condition-false"),
          source: id,
          target: falseBranch,
          kind: "condition-false",
        });
      }
      strippedConfig = rest;
    } else if (node.type === "router") {
      const { routes, defaultTarget, ...rest } = config as ConfigRecord & {
        routes?: Array<{
          condition: string;
          target: string;
          priority?: number;
        }>;
        defaultTarget?: string;
      };
      (routes ?? []).forEach((route) => {
        edges.push({
          id: nextEdgeId(id, route.target, "router-route"),
          source: id,
          target: route.target,
          kind: "router-route",
          label: route.condition,
          ...(route.priority !== undefined ? { priority: route.priority } : {}),
        });
      });
      if (typeof defaultTarget === "string" && defaultTarget) {
        edges.push({
          id: nextEdgeId(id, defaultTarget, "router-default"),
          source: id,
          target: defaultTarget,
          kind: "router-default",
        });
      }
      strippedConfig = rest;
    } else if (node.type === "loop") {
      const { body, ...rest } = config as ConfigRecord & { body?: string };
      if (typeof body === "string" && body) {
        edges.push({
          id: nextEdgeId(id, body, "loop-body"),
          source: id,
          target: body,
          kind: "loop-body",
        });
      }
      strippedConfig = rest;
    } else if (node.type === "approval") {
      const { approvedTarget, rejectedTarget, ...rest } =
        config as ConfigRecord & {
          approvedTarget?: string;
          rejectedTarget?: string;
        };
      if (typeof approvedTarget === "string" && approvedTarget) {
        edges.push({
          id: nextEdgeId(id, approvedTarget, "approval-approved"),
          source: id,
          target: approvedTarget,
          kind: "approval-approved",
        });
      }
      if (typeof rejectedTarget === "string" && rejectedTarget) {
        edges.push({
          id: nextEdgeId(id, rejectedTarget, "approval-rejected"),
          source: id,
          target: rejectedTarget,
          kind: "approval-rejected",
        });
      }
      strippedConfig = rest;
    }

    const {
      id: _id,
      type: _type,
      action: _action,
      next: _next,
      failureNext: _failureNext,
      conditionalNext: _conditionalNext,
      defaultNext: _defaultNext,
      rollbackTo: _rollbackTo,
      config: _config,
      ...rest
    } = node;

    const data: Record<string, unknown> = { ...rest };
    if (node.config !== undefined) {
      data.config = strippedConfig;
    }

    nodes.push({ id, type: node.type, data });
  }

  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    startNode: definition.startNode,
    cron: definition.cron,
    triggerEvents: definition.triggerEvents,
    metadata: definition.metadata,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    nodes,
    edges,
  };
}

/** Converts a flat nodes[]/edges[] graph back into a native
 * WorkflowDefinition, writing edges back into next/failureNext/
 * conditionalNext/defaultNext/rollbackTo or the appropriate type-specific
 * config field. */
export function fromGraph(graph: WorkflowGraph): WorkflowDefinition {
  const edgesBySource = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges ?? []) {
    const list = edgesBySource.get(edge.source) ?? [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  const nodes: Record<string, TaskNode> = {};

  for (const graphNode of graph.nodes ?? []) {
    const outgoing = edgesBySource.get(graphNode.id) ?? [];
    const byKind = (kind: GraphEdgeKind) =>
      outgoing.filter((e) => e.kind === kind);

    const node: TaskNode = {
      id: graphNode.id,
      type: graphNode.type,
      ...graphNode.data,
    };

    const nextTargets = byKind("next").map((e) => e.target);
    if (nextTargets.length > 0) node.next = nextTargets;

    const failureTargets = byKind("failure").map((e) => e.target);
    if (failureTargets.length > 0) node.failureNext = failureTargets;

    const conditionalEdges = byKind("conditional");
    if (conditionalEdges.length > 0) {
      node.conditionalNext = conditionalEdges.map((e) => ({
        condition: e.label ?? "",
        target: e.target,
      }));
    }

    const defaultEdge = byKind("default")[0];
    if (defaultEdge) node.defaultNext = defaultEdge.target;

    const rollbackEdge = byKind("rollback")[0];
    if (rollbackEdge) node.rollbackTo = rollbackEdge.target;

    const config = asConfig(node.config);

    if (graphNode.type === "condition") {
      const trueBranch = byKind("condition-true")[0]?.target;
      const falseBranch = byKind("condition-false")[0]?.target;
      if (trueBranch) config.trueBranch = trueBranch;
      if (falseBranch) config.falseBranch = falseBranch;
      node.config = config;
    } else if (graphNode.type === "router") {
      const routes = byKind("router-route").map((e) => ({
        condition: e.label ?? "",
        target: e.target,
        ...(e.priority !== undefined ? { priority: e.priority } : {}),
      }));
      if (routes.length > 0) config.routes = routes;
      const defaultTarget = byKind("router-default")[0]?.target;
      if (defaultTarget) config.defaultTarget = defaultTarget;
      node.config = config;
    } else if (graphNode.type === "loop") {
      const body = byKind("loop-body")[0]?.target;
      if (body) config.body = body;
      node.config = config;
    } else if (graphNode.type === "approval") {
      const approvedTarget = byKind("approval-approved")[0]?.target;
      const rejectedTarget = byKind("approval-rejected")[0]?.target;
      if (approvedTarget) config.approvedTarget = approvedTarget;
      if (rejectedTarget) config.rejectedTarget = rejectedTarget;
      node.config = config;
    } else if (Object.keys(config).length > 0) {
      node.config = config;
    } else if (
      "config" in graphNode.data &&
      graphNode.data.config === undefined
    ) {
      delete node.config;
    }

    nodes[graphNode.id] = node;
  }

  return {
    id: graph.id,
    name: graph.name,
    version: graph.version,
    description: graph.description,
    nodes,
    startNode: graph.startNode,
    cron: graph.cron,
    triggerEvents: graph.triggerEvents,
    metadata: graph.metadata,
    inputSchema: graph.inputSchema,
    outputSchema: graph.outputSchema,
  };
}
