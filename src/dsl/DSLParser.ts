import type { RetryPolicy } from "../model/RetryPolicy";
import type { TaskNode, TaskType, WorkflowDefinition } from "../model/Workflow";
import type {
  DSLConditionalBranch,
  DSLNode,
  DSLRetryPolicy,
  DSLWorkflow,
} from "./WorkflowDSL";

const WORKFLOW_KEYS = new Set([
  "id",
  "name",
  "version",
  "description",
  "startNode",
  "cron",
  "triggerEvents",
]);

const NODE_KEYS = new Set([
  "type",
  "config",
  "next",
  "failureNext",
  "conditionalNext",
  "defaultNext",
  "retryPolicy",
  "maxRetries",
]);

export class DSLParseError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} at ${line}:${column}`);
    this.name = "DSLParseError";
    this.line = line;
    this.column = column;
  }
}

interface ParsedLine {
  lineNumber: number;
  indent: number;
  key: string;
  value: string;
}

export function parseDSL(input: string): WorkflowDefinition {
  const parsedLines = parseLines(input);
  const workflow: Partial<DSLWorkflow> & {
    cron?: string;
    triggerEvents?: string[];
  } = {
    nodes: [],
  };
  let currentNode: Partial<DSLNode> | undefined;

  for (const line of parsedLines) {
    if (line.indent === 0) {
      if (WORKFLOW_KEYS.has(line.key)) {
        applyWorkflowProperty(workflow, line);
        currentNode = undefined;
        continue;
      }

      if (line.value.length > 0) {
        throw new DSLParseError(
          `Unknown top-level property or invalid node declaration '${line.key}'`,
          line.lineNumber,
          1,
        );
      }

      currentNode = { id: line.key };
      workflow.nodes?.push(currentNode as DSLNode);
      continue;
    }

    if (line.indent !== 2) {
      throw new DSLParseError(
        "Only two-space indentation is supported for node properties",
        line.lineNumber,
        line.indent + 1,
      );
    }

    if (!currentNode) {
      throw new DSLParseError(
        `Node property '${line.key}' must follow a node declaration`,
        line.lineNumber,
        line.indent + 1,
      );
    }

    applyNodeProperty(currentNode, line);
  }

  return convertToWorkflowDefinition(validateWorkflow(workflow));
}

function parseLines(input: string): ParsedLine[] {
  return input
    .split("\n")
    .map((rawLine, index) => ({ rawLine, lineNumber: index + 1 }))
    .filter(({ rawLine }) => {
      const trimmed = rawLine.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    })
    .map(({ rawLine, lineNumber }) => {
      const indent = rawLine.search(/\S/);
      const trimmed = rawLine.trim();
      const separatorIndex = trimmed.indexOf(":");
      if (separatorIndex < 0) {
        throw new DSLParseError(
          "Expected key-value pair separated by ':'",
          lineNumber,
          indent + 1,
        );
      }

      return {
        lineNumber,
        indent,
        key: trimmed.slice(0, separatorIndex).trim(),
        value: trimmed.slice(separatorIndex + 1).trim(),
      };
    });
}

function applyWorkflowProperty(
  workflow: Partial<DSLWorkflow> & {
    cron?: string;
    triggerEvents?: string[];
  },
  line: ParsedLine,
): void {
  switch (line.key) {
    case "id":
      workflow.id = parseScalar(line.value);
      break;
    case "name":
      workflow.name = parseScalar(line.value);
      break;
    case "version":
      workflow.version = parseScalar(line.value);
      break;
    case "description":
      workflow.description = parseScalar(line.value);
      break;
    case "startNode":
      workflow.startNode = parseScalar(line.value);
      break;
    case "cron":
      workflow.cron = parseScalar(line.value);
      break;
    case "triggerEvents":
      workflow.triggerEvents = parseStringArray(line.value, line);
      break;
    default:
      throw new DSLParseError(
        `Unsupported workflow property '${line.key}'`,
        line.lineNumber,
        line.indent + 1,
      );
  }
}

function applyNodeProperty(node: Partial<DSLNode>, line: ParsedLine): void {
  if (!NODE_KEYS.has(line.key)) {
    throw new DSLParseError(
      `Unsupported node property '${line.key}'`,
      line.lineNumber,
      line.indent + 1,
    );
  }

  switch (line.key) {
    case "type":
      node.type = parseScalar(line.value);
      break;
    case "config":
      node.config = parseJsonObject(line.value, line);
      break;
    case "next":
      node.next = parseStringArray(line.value, line);
      break;
    case "failureNext":
      node.failureNext = parseStringArray(line.value, line);
      break;
    case "conditionalNext":
      node.conditionalNext = parseJsonArray<DSLConditionalBranch>(
        line.value,
        line,
      );
      break;
    case "defaultNext":
      node.defaultNext = parseScalar(line.value);
      break;
    case "retryPolicy":
      node.retryPolicy = parseJsonObject(line.value, line) as DSLRetryPolicy;
      break;
    case "maxRetries":
      node.retryPolicy = {
        ...node.retryPolicy,
        maxRetries: parseNumber(line.value, line),
      };
      break;
  }
}

function validateWorkflow(
  workflow: Partial<DSLWorkflow> & {
    cron?: string;
    triggerEvents?: string[];
  },
): DSLWorkflow & { cron?: string; triggerEvents?: string[] } {
  if (!workflow.id) {
    throw new DSLParseError("Workflow id is required", 1, 1);
  }
  if (!workflow.name) {
    throw new DSLParseError("Workflow name is required", 1, 1);
  }
  if (!workflow.startNode) {
    throw new DSLParseError("Workflow startNode is required", 1, 1);
  }
  if (!workflow.nodes || workflow.nodes.length === 0) {
    throw new DSLParseError("Workflow must define at least one node", 1, 1);
  }

  const nodeIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (!node.id) {
      throw new DSLParseError("Node id is required", 1, 1);
    }
    if (!node.type) {
      throw new DSLParseError(`Node '${node.id}' type is required`, 1, 1);
    }
    if (nodeIds.has(node.id)) {
      throw new DSLParseError(`Duplicate node id '${node.id}'`, 1, 1);
    }
    nodeIds.add(node.id);
  }

  if (!nodeIds.has(workflow.startNode)) {
    throw new DSLParseError(
      `startNode '${workflow.startNode}' does not match any node`,
      1,
      1,
    );
  }

  return workflow as DSLWorkflow & {
    cron?: string;
    triggerEvents?: string[];
  };
}

function convertToWorkflowDefinition(
  dsl: DSLWorkflow & { cron?: string; triggerEvents?: string[] },
): WorkflowDefinition {
  const nodes: Record<string, TaskNode> = {};

  for (const node of dsl.nodes) {
    nodes[node.id] = {
      id: node.id,
      type: node.type as TaskType,
      config: node.config,
      next: node.next,
      failureNext: node.failureNext,
      conditionalNext: node.conditionalNext,
      defaultNext: node.defaultNext,
      retryPolicy: mapRetryPolicy(node.retryPolicy),
      maxRetries: node.retryPolicy?.maxRetries,
    };
  }

  return {
    id: dsl.id,
    name: dsl.name,
    version: dsl.version,
    description: dsl.description,
    startNode: dsl.startNode,
    nodes,
    cron: dsl.cron,
    triggerEvents: dsl.triggerEvents,
  };
}

function parseScalar(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function parseStringArray(value: string, line: ParsedLine): string[] {
  if (value.startsWith("[") && value.endsWith("]")) {
    return parseJsonArray<string>(value, line);
  }

  return [parseScalar(value)];
}

function parseJsonObject(
  value: string,
  line: ParsedLine,
): Record<string, unknown> {
  const parsed = parseJson(value, line);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DSLParseError(
      `Expected object value for '${line.key}'`,
      line.lineNumber,
      line.indent + 1,
    );
  }
  return parsed as Record<string, unknown>;
}

function parseJsonArray<T>(value: string, line: ParsedLine): T[] {
  const parsed = parseJson(value, line);
  if (!Array.isArray(parsed)) {
    throw new DSLParseError(
      `Expected array value for '${line.key}'`,
      line.lineNumber,
      line.indent + 1,
    );
  }
  return parsed as T[];
}

function parseJson(value: string, line: ParsedLine): unknown {
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new DSLParseError(
      `Invalid JSON value for '${line.key}': ${message}`,
      line.lineNumber,
      line.indent + 1,
    );
  }
}

function parseNumber(value: string, line: ParsedLine): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DSLParseError(
      `Expected numeric value for '${line.key}'`,
      line.lineNumber,
      line.indent + 1,
    );
  }
  return parsed;
}

function mapRetryPolicy(
  retryPolicy: DSLRetryPolicy | undefined,
): RetryPolicy | undefined {
  if (!retryPolicy) {
    return undefined;
  }

  return {
    maximumAttempts: retryPolicy.maximumAttempts ?? retryPolicy.maxRetries,
    initialInterval: retryPolicy.initialInterval ?? retryPolicy.backoffMs,
    backoffCoefficient:
      retryPolicy.backoffCoefficient ?? retryPolicy.backoffMultiplier,
    maximumInterval: retryPolicy.maximumInterval,
    nonRetryableErrors: retryPolicy.nonRetryableErrors,
  };
}
