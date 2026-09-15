import { randomUUID } from "node:crypto";
import type { WorkflowInstance } from "../model/Instance";
import type { TaskNode, WorkflowDefinition } from "../model/Workflow";
import {
  evaluate,
  getExpressionTraces,
  withExpressionTrace,
} from "./ExpressionEvaluator";

export interface DryRunOptions {
  context: Record<string, unknown>;
  mockResponses?: Record<string, unknown>;
  skipNodes?: string[];
  stopAfterNode?: string;
  recordExpressions?: boolean;
}

export interface DryRunNodeResult {
  nodeId: string;
  input?: unknown;
  output?: unknown;
  duration: number;
  mocked: boolean;
  skipped: boolean;
}

export interface ExpressionTraceEntry {
  expression: string;
  result: unknown;
  context: Record<string, unknown>;
  duration: number;
}

export interface DryRunResult {
  success: boolean;
  valid: boolean;
  executionPath: string[];
  nodeResults: Record<string, DryRunNodeResult>;
  expressionTrace: ExpressionTraceEntry[];
  warnings: string[];
  totalDuration: number;
  duration: number;
  simulatedOutputs: Record<string, unknown>;
  errors: Array<{ nodeId: string; error: string }>;
}

interface DryRunState {
  warnings: string[];
  errors: Array<{ nodeId: string; error: string }>;
  executionPath: string[];
  nodeResults: Record<string, DryRunNodeResult>;
  simulatedOutputs: Record<string, unknown>;
  visited: Set<string>;
}

export class DryRunExecutor {
  constructor(
    private resolveWorkflow?: (
      workflowId: string,
    ) =>
      | WorkflowDefinition
      | undefined
      | Promise<WorkflowDefinition | undefined>,
  ) {}

  async execute(
    workflow: WorkflowDefinition,
    options: DryRunOptions,
  ): Promise<DryRunResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    const errors: Array<{ nodeId: string; error: string }> = [];
    const executionPath: string[] = [];
    const nodeResults: Record<string, DryRunNodeResult> = {};
    const simulatedOutputs: Record<string, unknown> = {};
    const visited = new Set<string>();
    const instance: WorkflowInstance = {
      instanceId: `dry-run-${randomUUID()}`,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      currentNodes: [workflow.startNode],
      status: "running",
      context: { ...(options.context as Record<string, unknown>) },
      history: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      state: { nodes: {} },
    };

    const runner = async (): Promise<void> => {
      await this.walk(workflow, instance, workflow.startNode, options, {
        warnings,
        errors,
        executionPath,
        nodeResults,
        simulatedOutputs,
        visited,
      });
    };

    if (options.recordExpressions) {
      await withExpressionTrace(runner);
    } else {
      await runner();
    }

    const totalDuration = Date.now() - startTime;
    return {
      success: errors.length === 0,
      valid: errors.length === 0,
      executionPath,
      nodeResults,
      expressionTrace: options.recordExpressions ? getExpressionTraces() : [],
      warnings,
      totalDuration,
      duration: totalDuration,
      simulatedOutputs,
      errors,
    };
  }

  private async walk(
    workflow: WorkflowDefinition,
    instance: WorkflowInstance,
    nodeId: string,
    options: DryRunOptions,
    state: DryRunState,
  ): Promise<void> {
    if (state.visited.has(nodeId)) {
      state.errors.push({ nodeId, error: "Circular dependency detected" });
      return;
    }
    state.visited.add(nodeId);
    const node = workflow.nodes[nodeId];
    if (!node) {
      state.errors.push({ nodeId, error: `Node ${nodeId} not found` });
      return;
    }
    state.executionPath.push(nodeId);
    const startedAt = Date.now();

    if (options.skipNodes?.includes(nodeId)) {
      state.warnings.push(`Node '${nodeId}' was skipped`);
      state.nodeResults[nodeId] = {
        nodeId,
        duration: Date.now() - startedAt,
        mocked: false,
        skipped: true,
      };
      return;
    }

    const mocked = Object.hasOwn(options.mockResponses ?? {}, nodeId);
    const output = mocked
      ? options.mockResponses?.[nodeId]
      : await this.simulateNode(
          workflow,
          instance,
          node,
          options,
          state.warnings,
        );
    state.simulatedOutputs[nodeId] = output;
    instance.state ??= { nodes: {} };
    instance.state.nodes ??= {};
    instance.state.nodes[nodeId] = { output };
    state.nodeResults[nodeId] = {
      nodeId,
      output,
      duration: Date.now() - startedAt,
      mocked,
      skipped: false,
    };

    if (options.stopAfterNode === nodeId) {
      state.warnings.push(`Stopped at node '${nodeId}' as requested`);
      return;
    }

    for (const nextNode of this.resolveNextNodes(node, output)) {
      await this.walk(workflow, instance, nextNode, options, state);
    }
  }

  private resolveNextNodes(node: TaskNode, output: unknown): string[] {
    if (node.type === "condition") {
      const result = output as { result?: boolean };
      const config = (node.config ?? {}) as {
        trueBranch?: string;
        falseBranch?: string;
      };
      return result.result
        ? [config.trueBranch ?? ""].filter(Boolean)
        : [config.falseBranch ?? ""].filter(Boolean);
    }
    if (node.type === "router") {
      const target = (output as { target?: string }).target;
      return target ? [target] : [];
    }
    if (node.type === "approval") {
      const config = (node.config ?? {}) as { approvedTarget?: string };
      return config.approvedTarget ? [config.approvedTarget] : [];
    }
    return node.next ?? [];
  }

  private async simulateNode(
    workflow: WorkflowDefinition,
    instance: WorkflowInstance,
    node: TaskNode,
    options: DryRunOptions,
    warnings: string[],
  ): Promise<unknown> {
    switch (node.type) {
      case "http":
        return { status: 200, body: {}, mocked: true };
      case "sql":
        return [];
      case "queue":
        return { ok: true, mocked: true };
      case "approval":
        return { approved: true, mocked: true };
      case "notification":
        warnings.push(`Node '${node.id}' notification skipped in dry-run`);
        return { ok: true, mocked: true };
      case "join": {
        // Dry-run walks the graph depth-first from a single start node, so
        // (unlike the real engine's batched fan-out) a join is typically
        // reached via only one of its waitFor branches — the others may not
        // have been visited yet. Report which are already known and flag
        // the rest as unverified rather than failing the simulation.
        const config = (node.config ?? {}) as { waitFor?: string[] };
        const waitFor = config.waitFor ?? [];
        const known = waitFor.filter(
          (id) => instance.state?.nodes?.[id]?.output !== undefined,
        );
        const unverified = waitFor.filter((id) => !known.includes(id));
        if (unverified.length > 0) {
          warnings.push(
            `Node '${node.id}' join: branch(es) not reached by this dry-run path yet: ${unverified.join(", ")}`,
          );
        }
        return {
          results: Object.fromEntries(
            known.map((id) => [id, instance.state?.nodes?.[id]?.output]),
          ),
          missing: unverified,
          mocked: true,
        };
      }
      case "transform": {
        const config = (node.config ?? {}) as {
          output?: Record<string, string>;
        };
        const fields = config.output ?? {};
        const result: Record<string, unknown> = {};
        const evalContext = this.buildExpressionContext(instance);
        for (const [field, rawExpr] of Object.entries(fields)) {
          const trimmed = rawExpr.trim();
          const expr =
            trimmed.startsWith("${") && trimmed.endsWith("}")
              ? trimmed.slice(2, -1)
              : trimmed;
          try {
            result[field] = evaluate(expr, evalContext);
          } catch (error: unknown) {
            warnings.push(
              `Node '${node.id}' transform field '${field}' failed to evaluate: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
        return result;
      }
      case "subworkflow": {
        warnings.push(
          `Subworkflow '${node.subworkflowId}' executed in nested dry-run`,
        );
        if (!node.subworkflowId) {
          return { subworkflowId: undefined, mocked: true };
        }
        if (workflow.id === node.subworkflowId) {
          return { subworkflowId: node.subworkflowId, mocked: true };
        }
        const childWorkflow = this.resolveWorkflow
          ? await this.resolveWorkflow(node.subworkflowId)
          : undefined;
        if (!childWorkflow) {
          warnings.push(
            `Subworkflow '${node.subworkflowId}' could not be resolved during dry-run`,
          );
          return { subworkflowId: node.subworkflowId, mocked: true };
        }

        const nestedContext = this.buildSubworkflowContext(
          node.subworkflowInput ?? {},
          instance.context,
        );
        const nestedResult = await this.execute(childWorkflow, {
          context: nestedContext,
          recordExpressions: options.recordExpressions,
        });
        return {
          subworkflowId: node.subworkflowId,
          mocked: true,
          nested: nestedResult,
        };
      }
      case "condition": {
        const config = (node.config ?? {}) as { condition?: string };
        return {
          result: Boolean(
            config.condition
              ? evaluate(
                  config.condition,
                  this.buildExpressionContext(instance),
                )
              : false,
          ),
        };
      }
      case "router": {
        const config = (node.config ?? {}) as {
          routes?: Array<{ condition: string; target: string }>;
          defaultTarget?: string;
        };
        for (const route of config.routes ?? []) {
          if (
            evaluate(route.condition, this.buildExpressionContext(instance))
          ) {
            return { target: route.target };
          }
        }
        return { target: config.defaultTarget };
      }
      case "action":
        if (typeof node.action === "function") {
          return node.action(instance);
        }
        return { ok: true };
      default:
        return { mocked: true };
    }
  }

  private buildExpressionContext(
    instance: WorkflowInstance,
  ): Record<string, unknown> {
    return {
      ...instance.context,
      context: instance.context,
      state: instance.state ?? {},
    };
  }

  private buildSubworkflowContext(
    inputMapping: Record<string, string>,
    parentContext: Record<string, unknown>,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    for (const [targetKey, sourcePath] of Object.entries(inputMapping)) {
      if (sourcePath.startsWith("$")) {
        const value = sourcePath.substring(1);
        context[targetKey] = value.startsWith("literal:")
          ? value.substring(8)
          : value;
        continue;
      }

      const resolvedPath = sourcePath.startsWith("parent.")
        ? sourcePath.substring(7)
        : sourcePath;
      context[targetKey] = this.getNestedValue(parentContext, resolvedPath);
    }
    return context;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, part) => {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      return (current as Record<string, unknown>)[part];
    }, obj);
  }
}
