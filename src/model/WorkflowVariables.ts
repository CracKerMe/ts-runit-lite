import type { WorkflowDefinition } from "./Workflow";
import { toGraph } from "./WorkflowGraph";

/**
 * Autocomplete candidates for the `${...}` expression syntax used in
 * conditionalNext/router/loop/condition expressions (see
 * ExpressionEvaluator.interpolateExpressions). Complements GET /functions
 * (the built-in function catalog) with the other half of what an
 * expression editor needs: which variables exist.
 *
 * Node-output candidates are necessarily best-effort: `outputSchema` is an
 * optional, hand-declared JSON Schema subset (see DataValidator) — when a
 * node doesn't declare one we can only suggest the untyped `${id.output}`
 * root, not its fields.
 */
export interface VariableSuggestion {
  /** Ready to paste into a `${...}` template, e.g. "${order.output.amount}". */
  expression: string;
  path: string;
  source: "context" | "node-output";
  nodeId?: string;
  /** Best-effort JSON Schema `type`, when known from inputSchema/outputSchema. */
  type?: string;
}

function schemaProperties(
  schema: Record<string, unknown> | undefined,
): Array<{ key: string; type?: string }> {
  const properties = schema?.properties;
  if (!properties || typeof properties !== "object") {
    return [];
  }
  return Object.entries(properties as Record<string, unknown>).map(
    ([key, propSchema]) => ({
      key,
      type:
        propSchema && typeof propSchema === "object" && "type" in propSchema
          ? String((propSchema as { type: unknown }).type)
          : undefined,
    }),
  );
}

/** `${context}` / `${context.<field>}` candidates from the workflow's
 * declared inputSchema (the workflow start input, i.e. the runtime
 * "context" object expressions resolve against). */
export function getContextVariableSuggestions(
  definition: Pick<WorkflowDefinition, "inputSchema">,
): VariableSuggestion[] {
  const props = schemaProperties(definition.inputSchema);
  if (props.length === 0) {
    return [{ expression: "${context}", path: "context", source: "context" }];
  }
  return props.map(({ key, type }) => ({
    expression: `\${context.${key}}`,
    path: `context.${key}`,
    source: "context" as const,
    type,
  }));
}

/** Nodes that can reach `targetId` via any edge kind (next/failure/
 * conditional/default/rollback/type-specific), used to scope suggestions to
 * nodes actually reachable before the node being edited. */
function findAncestors(
  definition: WorkflowDefinition,
  targetId: string,
): Set<string> {
  const { edges } = toGraph(definition);
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    const list = predecessors.get(edge.target) ?? [];
    list.push(edge.source);
    predecessors.set(edge.target, list);
  }

  const ancestors = new Set<string>();
  const queue = [...(predecessors.get(targetId) ?? [])];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (ancestors.has(nodeId)) continue;
    ancestors.add(nodeId);
    queue.push(...(predecessors.get(nodeId) ?? []));
  }
  return ancestors;
}

/** `${nodeId.output}` / `${nodeId.output.<field>}` candidates for every
 * node in the workflow, or only for ancestors of `options.before` when
 * given (so the editor for a specific node doesn't suggest nodes that
 * can't have run yet). */
export function getNodeOutputVariableSuggestions(
  definition: WorkflowDefinition,
  options?: { before?: string },
): VariableSuggestion[] {
  const nodeIds = Object.keys(definition.nodes ?? {});
  const scoped =
    options?.before && nodeIds.includes(options.before)
      ? nodeIds.filter((id) =>
          findAncestors(definition, options.before!).has(id),
        )
      : nodeIds.filter((id) => id !== options?.before);

  const suggestions: VariableSuggestion[] = [];
  for (const nodeId of scoped) {
    suggestions.push({
      expression: `\${${nodeId}.output}`,
      path: `${nodeId}.output`,
      source: "node-output",
      nodeId,
    });
    const node = definition.nodes[nodeId];
    for (const { key, type } of schemaProperties(node.outputSchema)) {
      suggestions.push({
        expression: `\${${nodeId}.output.${key}}`,
        path: `${nodeId}.output.${key}`,
        source: "node-output",
        nodeId,
        type,
      });
    }
  }
  return suggestions;
}

/** Combined context + node-output suggestions for a workflow, optionally
 * scoped to what's reachable before a given node. */
export function getVariableSuggestions(
  definition: WorkflowDefinition,
  options?: { before?: string },
): VariableSuggestion[] {
  return [
    ...getContextVariableSuggestions(definition),
    ...getNodeOutputVariableSuggestions(definition, options),
  ];
}
